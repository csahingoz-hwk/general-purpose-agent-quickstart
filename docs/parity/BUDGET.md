# Grok Bot Parity — Infrastructure & Cost Budget (`£/month`)

**Owner:** Çağlar (`Europe/London`)  
**Rule:** Cheapest-first, leveraging subscriptions and hardware **already paid for**, with hard spending caps and zero surprise usage bills.  
*(FX conversion used below: `$1.00 ≈ £0.79`, rounded conservatively.)*

---

## 1. Sunk Assets Already Owned (Marginal Cost = £0/mo)

Before buying any new SaaS infrastructure, inventory what Çağlar already pays for and owns:

| Existing Asset | Relevant Included Entitlements | Best Role in Grok Bot Architecture |
|---|---|---|
| **Always-On Mac mini** *(owned)* | Apple Silicon CPU/Neural Engine, macOS Keychain, local SSD, residential UK IP, 24/7 uptime (~10–15W idle ≈ **£3–£4/mo** UK electricity) | **Primary "Box"**: persistent shell, local Playwright browser, background task worker, sub-minute cron runner, optional iMessage/local file bridge |
| **Google AI Ultra** *(already paid)* | **1,000–2,000 Colab compute units/mo** + background GPU execution; **$40–$100/mo (~£31–£79/mo) Google Cloud / Developer API credits**; Gemini 3.8 Live voice/multimodal API; 20–30 TB Drive | **Zero-extra-cost Cloud VM failover, Gemini Live voice, Imagen/Veo media, and heavy GPU/OCR/Python batch jobs on Colab** |
| **Vercel** *(already configured)* | Next.js hosting, Vercel Blob, AI Gateway OIDC routing ($5/mo free Gateway credits) | **Web/Mobile PWA Chat Shell** + webhook/API edge ingress |
| **Claude Pro / ChatGPT Plus / Copilot Pro / Gemini Pro / Lovable Pro** | Interactive coding & research seats | Development & vibecoding acceleration *(note: consumer web seats do not grant programmatic API keys, so runtime bot calls use AI Gateway / OpenAI `$10` cap + Google AI Ultra API credits)* |

---

## 2. Category-by-Category Comparison (`£/month` & Trade-Offs)

### A. Always-On "Box" / Code & Agent Execution Environment

| Option | Est. Extra Cost (`£/mo`) | Persistence & OS | Pros | Cons / Trade-Offs |
|---|---|---|---|---|
| **1. Always-On Mac mini + Tailscale + Docker** *(Recommended Default)* | **£0 SaaS** *(~£3.50/mo electricity)* | Full persistent macOS + Linux containers | Zero SaaS fee; residential IP (rarely blocked); native access to local folders/iMessage; unlimited runtime (no 60s timeout); outbound-only WSS/Tailscale needs zero open router ports. | Depends on home broadband & power (mitigated by Postgres queue retry when offline). |
| **2. Google Cloud VM (`e2-small` / `e2-medium`) via Ultra Credits** | **£0 net** *(~£11–£22/mo covered by $40–$100 Ultra credit)* | Persistent Debian/Ubuntu Linux VM | Public static IP; 99.9% cloud uptime; great secondary webhook relay or remote Linux box without touching home network. | Datacenter IP gets more CAPTCHAs than home Mac; requires basic Linux patching. |
| **3. Fly Machines (Firecracker micro-VMs)** | **£2–£6/mo** *(1 GB RAM ~$6.70/mo always-on, or ~$0.15/GB-mo stopped)* | Fast-boot Linux micro-VM + persistent volume | Sub-second wake-on-request; true hardware-level micro-VM isolation for untrusted code; pay-per-second. | Extra vendor to manage when Mac mini + GCP Ultra credits already cover 100% of need. |
| **4. Vercel Sandbox** | **£0** *(Hobby: 5 CPU-hr/mo)* or **£0–£16+** *(Pro credit + $0.128/CPU-hr)* | Ephemeral container (45m Hobby / 24h Pro cap) | Native TypeScript SDK inside Vercel routes; zero infra ops. | Ephemeral (not a true persistent "box"); Hobby non-commercial limits & 45-min cap. |
| **5. Daytona** | **£0 start** *($200 credit)*, then **~£4–£12/mo** usage ($0.05/vCPU-hr) | Persistent isolated dev workspaces | Fast workspace snapshots; tailored for coding subagents; cheap per-second billing. | Overkill for personal finance/assistant tasks unless running parallel cloud repo bots. |
| **6. E2B** | **£0 Hobby** *(100h/mo, 1h max session)* · **£118/mo ($150)** Pro | Ephemeral micro-VM sandboxes | Purpose-built AI code/desktop sandbox SDK. | 1-hour session cap on Free tier; **£118/mo** jump to Pro breaks budget immediately. |
| **7. Google Colab (Ultra Background GPUs)** | **£0 extra** *(included in Google AI Ultra)* | Batch GPU notebooks (up to 24h background) | Free A100/L4/T4 GPU bursts via Ultra for heavy PDF OCR, Whisper batch transcription, Python data science, or video processing. | Not a 24/7 low-latency daemon; use strictly as an **on-demand heavy batch offload**, not the primary box. |

---

### B. Browser Automation (Computer-Use & Web Workflows)

| Option | Est. Extra Cost (`£/mo`) | Anti-Bot / Auth Profile | Trade-Offs |
|---|---|---|---|
| **1. Playwright on Mac mini** *(Recommended Default)* | **£0** | Uses residential UK IP + persistent local Chromium profile | Fastest, £0, keeps logged-in read sessions locally on Çağlar's hardware, supports headed visual inspection via screen share. Must still pause on `ApprovalCard` before any submit/purchase. |
| **2. Self-Hosted Steel.dev (Docker on Mac mini / GCP VM)** | **£0** | Open-source browser API + session viewer | Gives a clean REST/CDP browser session API + live debug viewer URL for OpenUI cards at £0 SaaS cost. |
| **3. Steel.dev Cloud (Launch Plan)** | **£0 start** *($30 free credit)*, then **~£0.07/hr** ($0.08–$0.10/hr) | Cloud Chromium + optional proxies (~£5–£8/GB) | Great serverless burst fallback when Mac mini is asleep; usage-based without a $20/mo floor. |
| **4. Browserbase** | **£0 Free** *(1 hr/mo)* · **£16/mo ($20)** Developer (100 hrs + 1 GB proxy) | Managed cloud stealth + session replay | Best turnkey cloud DX & Stagehand integration, but £16/mo fixed cost is unnecessary until cloud-only operation is required. |

*(Note: Never automate CAPTCHA solving or bypass access controls; if a target site gates access with an anti-bot challenge, pause the task and surface a local handoff link for the owner.)*

---

### C. Voice (Voice Memos & Live Speech-to-Speech)

| Option | Unit Cost | Est. Monthly (`£/mo` for ~60 mins/mo) | Trade-Offs |
|---|---|---|---|
| **1. Gemini 3.8 Live API** *(Recommended Default)* | $3/1M audio in · $12/1M audio out (~£0.03/min; ~£0.15 per 5-min multi-turn call) | **£0 net** *(~£1.80/mo raw, offset 100% by Google AI Ultra API credits)* | Native low-latency bilingual EN/TR audio streaming, interruption support, tool calling, and ~5–8× cheaper than flagship OpenAI Realtime. |
| **2. Async Voice Memos (Gemini Flash / Whisper STT)** | <$0.006/min | **<£0.30/mo** *(£0 net on Ultra credits)* | Highest accuracy for dictating finance notes or Turkish/English prompts in noisy environments; creates editable text before sending. |
| **3. OpenAI Realtime (`gpt-realtime-2.1-mini` / `2.1`)** | Mini: $10/$20 per 1M audio (~£0.03–£0.06/min) · Flagship: $32/$64 per 1M (~£0.15–£0.18/min) | **£2–£11/mo** *(draws against OpenAI API balance)* | Excellent natural prosody, but flagship uncached multi-turn sessions burn through the `$10/mo` OpenAI allowance rapidly (~45–55 mins max). Reserve for Upgrade stack. |

---

### D. Long-Term Memory & Vector Store

| Option | Est. Extra Cost (`£/mo`) | Architecture Fit & Trade-Offs |
|---|---|---|
| **1. Existing Neon Postgres + `pgvector` + FTS** *(Recommended Default)* | **£0** *(Neon Free: 100 CU-hrs, 1 GB)* to **~£4–£10/mo** *(Neon Launch pay-as-you-go, no minimum)* | **Zero extra vendor.** Stores `MemoryProfileFact` + `MemoryJournalEntry` + optional `vector(1536)` embeddings (via Gemini `text-embedding-004` free/Ultra credits) in the exact same ACID database as `Chat` and `User`, with strict owner row isolation and zero third-party data sharing. |
| **2. Supermemory** | **£0 Free** *($5/mo credit)* · **£15/mo ($19)** Pro | Fast turnkey `getProfile` + `searchMemories` tools, **but** sends personal/finance facts to an external SaaS memory vendor and jumps to £15/mo past free credits. |
| **3. Upstash Vector** | **£0 Free** / pay-as-you-go (~£1/mo) | Good serverless vector index, but splits relational metadata (Postgres) from vectors (Upstash) unnecessarily at single-user scale. |

---

### E. Queues, Cron & Durable Background Workflows

| Option | Est. Extra Cost (`£/mo`) | Precision & Timeout Limits | Trade-Offs |
|---|---|---|---|
| **1. Postgres Queue (`BackgroundTask` + `CronJob`) + Mac mini Worker** *(Recommended Default)* | **£0** | **1-second precision**, unlimited task duration | Uses `SELECT ... FOR UPDATE SKIP LOCKED` on existing Neon Postgres. Bypasses Vercel Hobby's once-per-day cron restriction and 60s function timeout with zero new SaaS services. |
| **2. Upstash QStash + Existing Upstash Redis** | **£0 Free tier** *(~£1/mo PAYG)* | Per-minute cron + HTTP retries | Great lightweight HTTP wakeup trigger for serverless endpoints if Mac mini is off, though target Vercel route still faces the 60s/300s function ceiling. |
| **3. Trigger.dev** | **£0 Free** *($5 credit)* · **£8/mo ($10)** Hobby | Long-running cloud TypeScript containers | Best cloud upgrade if retiring the Mac mini worker: runs multi-minute Playwright/agent tasks in managed cloud containers for £8/mo. |
| **4. Inngest** | **£0 Free** *(50k step runs/mo)* · **£78/mo ($99)** Pro | Durable step functions (`step.run`) | Generous free tier for webhook→step orchestration, but steep £78/mo cliff past free tier and still executes inside Vercel's HTTP runtime unless paired with a worker. |

---

## 3. Recommended Stacks

### Stack 1: Recommended Default Stack — **~£6 to £11/month extra** *(Well under £30/month cap)*

Maximizes Çağlar's **Mac mini** + **Google AI Ultra** benefits while keeping all sensitive data inside his own Neon DB and hardware:

| Layer | Choice | Monthly Extra Out-of-Pocket (`£/mo`) |
|---|---|---|
| **Web / Mobile PWA Shell** | Existing Vercel Hobby/current plan (`Next.js 16` + `OpenUI`) | **£0** |
| **Chat LLM Routing** | Existing OpenAI `gpt-6-luna` + selective `gpt-6.1-terra` + AI Gateway `webSearch` (`AI_MONTHLY_ALLOWANCE_USD=10` hard ledger cap) | **£3 – £8/mo** *(hard-capped at ~$10 ≈ £7.90)* |
| **Always-On "Box" & Browser** | **Mac mini** running local worker daemon + **Playwright** + **Tailscale** (Free personal plan) | **~£3.50/mo** *(electricity only; £0 SaaS)* |
| **Cloud Backup VM & Live Voice** | **GCP `e2-small` relay + Gemini 3.8 Live + Embeddings + Colab GPU bursts** | **£0 net** *(covered by Google AI Ultra $40–$100/mo credits & Colab units)* |
| **Database, Memory & Queue** | **Neon Postgres** (`CronJob`, `BackgroundTask`, `VaultSecret`, `MemoryProfileFact`, `MemoryJournalEntry` + `pgvector`) + **Upstash Redis Free** | **£0 – £2/mo** *(Free tier covers single-owner light usage)* |
| **Secrets Encryption** | In-app AES-256-GCM `SecretVault` (`node:crypto` + server `SECRET_VAULT_KEY`) | **£0** |
| **Total Incremental Spend** | | **~£6.50 – £11.50 / month** |

---

### Stack 2: Zero-Home-Hardware "Cloud Upgrade" Stack — **~£46 to £64/month extra**

Choose this stack **only if** you want 100% cloud execution when travelling with the Mac mini powered off, sub-minute cloud crons on Vercel, managed stealth cloud browsers, and higher LLM/voice ceilings:

| Layer | Upgrade Choice | Monthly Extra (`£/mo`) | What It Buys Over Default |
|---|---|---|---|
| **App Platform & Minute Crons** | **Vercel Pro** ($20/mo incl. $20 usage credit + Vercel Sandbox access) | **~£16/mo** | Native `* * * * *` per-minute Vercel Crons, 800s Fluid Compute timeouts, commercial Sandbox sessions |
| **Durable Cloud Workers** | **Trigger.dev Hobby** ($10/mo incl. $10 compute credits) | **~£8/mo** | Managed long-running TypeScript subagents in the cloud with zero home hardware dependency |
| **Managed Cloud Browser** | **Browserbase Developer** ($20/mo, 100 hrs + 1 GB residential proxy) *or* **Fly Machines** (~£5/mo) | **~£5 – £16/mo** | Cloud Chromium sessions with session-replay inspector when off the Mac mini |
| **Database & Vector Scale** | **Neon Launch** (pay-as-you-go, larger warm CU window + point-in-time branch restore) | **~£5 – £8/mo** | Faster cold-starts and longer history retention |
| **LLM + Realtime Voice Allowance** | Raise `AI_MONTHLY_ALLOWANCE_USD` to **$25/mo** + Gemini Live / OpenAI Realtime Mini | **~£12 – £16/mo** | Heavy daily Terra deep-reasoning + multi-step subagent & voice runs |
| **Total Upgrade Spend** | | **~£46 – £64 / month** | Fully cloud-autonomous Grok Bot equivalent |
