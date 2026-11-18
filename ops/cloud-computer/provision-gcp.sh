#!/usr/bin/env bash
set -euo pipefail

PROJECT="${GCP_PROJECT:-project-cd0bc64c-0025-446c-b41}"
REGION="${GCP_REGION:-europe-west1}"
ZONE="${GCP_ZONE:-europe-west1-b}"
VM_NAME="${VM_NAME:-assistant-computer-01}"
RELAY_NAME="${RELAY_NAME:-assistant-computer-relay}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[1/5] Ensuring CLOUD_COMPUTER_HMAC_SECRET in Secret Manager..."
if ! gcloud secrets describe cloud-computer-hmac-secret --project="$PROJECT" >/dev/null 2>&1; then
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets create cloud-computer-hmac-secret \
    --project="$PROJECT" \
    --replication-policy="automatic" \
    --data-file=-
fi
HMAC_SECRET="$(gcloud secrets versions access latest --secret=cloud-computer-hmac-secret --project="$PROJECT")"
COPILOT_TOKEN=""
if gcloud secrets describe copilot-github-token --project="$PROJECT" >/dev/null 2>&1; then
  COPILOT_TOKEN="$(gcloud secrets versions access latest --secret=copilot-github-token --project="$PROJECT")"
fi

echo "[2/5] Configuring internal-VPC-only firewall rule (zero public ingress)..."
if ! gcloud compute networks describe default --project="$PROJECT" >/dev/null 2>&1; then
  gcloud compute networks create default --subnet-mode=auto --project="$PROJECT"
fi
if ! gcloud compute firewall-rules describe allow-internal-sandboxd --project="$PROJECT" >/dev/null 2>&1; then
  gcloud compute firewall-rules create allow-internal-sandboxd \
    --project="$PROJECT" \
    --network=default \
    --direction=INGRESS \
    --action=ALLOW \
    --rules=tcp:8787 \
    --source-ranges=10.128.0.0/9 \
    --target-tags=assistant-sandbox
fi

echo "[3/5] Provisioning GCE e2-medium Linux VM ($VM_NAME in $ZONE)..."
STARTUP_TMP="$(mktemp)"
trap 'rm -f "$STARTUP_TMP"' EXIT

cat > "$STARTUP_TMP" <<EOF
#!/usr/bin/env bash
set -euo pipefail

if ! id -u operator >/dev/null 2>&1; then
  useradd -m -u 1001 -s /bin/bash operator
fi
mkdir -p /workspace /opt/sandboxd
chown -R operator:operator /workspace

# Block GCE metadata server (169.254.169.254) for unprivileged operator UID 1001
if ! iptables -C OUTPUT -d 169.254.169.254/32 -m owner --uid-owner operator -j REJECT 2>/dev/null; then
  iptables -I OUTPUT 1 -d 169.254.169.254/32 -m owner --uid-owner operator -j REJECT
fi

if ! command -v node >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git jq openssh-client python3 python3-pip python3-venv unzip
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi

if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

mkdir -p /opt/playwright-browsers
cd /opt/sandboxd
[ -f package.json ] || npm init -y >/dev/null
if [ ! -f /opt/sandboxd/node_modules/playwright-core/index.mjs ]; then
  PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers npm install --silent playwright-core@1.52.0
  PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers /opt/sandboxd/node_modules/.bin/playwright-core install --with-deps chromium
fi
if [ ! -f /opt/sandboxd/node_modules/@github/copilot-sdk/dist/index.js ]; then
  npm install --silent @github/copilot-sdk@1.0.34
fi
chmod -R a+rX /opt/playwright-browsers /opt/sandboxd/node_modules

cat > /opt/sandboxd/sandboxd.mjs <<'SANDBOX_EOF'
$(cat "$SCRIPT_DIR/sandboxd.mjs")
SANDBOX_EOF

cat > /usr/local/bin/assistant-idle-stop <<'IDLE_EOF'
#!/usr/bin/env bash
/sbin/poweroff
IDLE_EOF
chmod 755 /usr/local/bin/assistant-idle-stop
echo "operator ALL=(root) NOPASSWD: /usr/local/bin/assistant-idle-stop" > /etc/sudoers.d/operator-idle-only
chmod 440 /etc/sudoers.d/operator-idle-only

cat > /etc/opt-sandboxd.env <<ENV_EOF
CLOUD_COMPUTER_HMAC_SECRET=${HMAC_SECRET}
COPILOT_GITHUB_TOKEN=${COPILOT_TOKEN}
COPILOT_TELEMETRY_DISABLED=true
SANDBOX_PORT=8787
SANDBOX_WORKSPACE=/workspace
PLAYWRIGHT_BROWSERS_PATH=/opt/playwright-browsers
ENV_EOF
chown root:root /etc/opt-sandboxd.env
chmod 600 /etc/opt-sandboxd.env

cat > /etc/systemd/system/sandboxd.service <<'UNIT_EOF'
[Unit]
Description=Assistant Sandboxed Cloud Computer Daemon
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=operator
Group=operator
EnvironmentFile=/etc/opt-sandboxd.env
WorkingDirectory=/workspace
ExecStart=/usr/bin/node /opt/sandboxd/sandboxd.mjs
Restart=always
RestartSec=2
NoNewPrivileges=yes
ProtectSystem=full
PrivateTmp=yes
MemoryMax=3200M

[Install]
WantedBy=multi-user.target
UNIT_EOF

systemctl daemon-reload
systemctl enable sandboxd.service
systemctl restart sandboxd.service
EOF

if ! gcloud compute instances describe "$VM_NAME" --zone="$ZONE" --project="$PROJECT" >/dev/null 2>&1; then
  gcloud compute instances create "$VM_NAME" \
    --project="$PROJECT" \
    --zone="$ZONE" \
    --machine-type=e2-medium \
    --image-family=ubuntu-2404-lts-amd64 \
    --image-project=ubuntu-os-cloud \
    --boot-disk-size=30GB \
    --boot-disk-type=pd-balanced \
    --tags=assistant-sandbox \
    --scopes=cloud-platform \
    --metadata-from-file=startup-script="$STARTUP_TMP"
else
  gcloud compute instances add-metadata "$VM_NAME" \
    --project="$PROJECT" \
    --zone="$ZONE" \
    --metadata-from-file=startup-script="$STARTUP_TMP"
fi

echo "[4/5] Granting Cloud Run default SA Compute Instance Admin + Secret Accessor..."
PROJECT_NUM="$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')"
COMPUTE_SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/compute.instanceAdmin.v1" \
  --quiet >/dev/null
gcloud secrets add-iam-policy-binding cloud-computer-hmac-secret \
  --project="$PROJECT" \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

echo "[5/5] Deploying scale-to-zero Cloud Run Wake/Relay ($RELAY_NAME in $REGION)..."
gcloud run deploy "$RELAY_NAME" \
  --project="$PROJECT" \
  --region="$REGION" \
  --source="$SCRIPT_DIR/relay" \
  --allow-unauthenticated \
  --min-instances=0 \
  --max-instances=3 \
  --memory=256Mi \
  --timeout=120 \
  --network=default \
  --subnet=default \
  --vpc-egress=private-ranges-only \
  --set-env-vars="GCP_PROJECT=${PROJECT},GCP_ZONE=${ZONE},VM_NAME=${VM_NAME},SANDBOX_PORT=8787" \
  --set-secrets="CLOUD_COMPUTER_HMAC_SECRET=cloud-computer-hmac-secret:latest" \
  --quiet

RELAY_URL="$(gcloud run services describe "$RELAY_NAME" --project="$PROJECT" --region="$REGION" --format='value(status.url)')"
echo "READY_RELAY_URL=${RELAY_URL}"
