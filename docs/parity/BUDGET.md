# Assistant Feature Parity — Infrastructure & Cost Budget (`£/month`)

**Owner:** Çağlar (`Europe/London`)  
**Baseline Date:** November 2026 *(budgeted against December 2026 steady-state: **Google AI Ultra 5x**)*  
**Rule:** Cheapest-first, grounded in verified billing mechanics, hard spending caps, and strict work/personal data boundaries.  
*(FX conversion used below: `US$1.00 ≈ £0.79`, rounded conservatively.)*

---

## 0. Mandatory Governance, Model & Hardware Constraints

1. **Korn Ferry / Work Data Boundary (Hard Rule):** Korn Ferry or any employer/client material **must NEVER be sent** to:
   - The **personal Google project** (Cloud Run, Colab, AI Studio, Gemini Developer API, Antigravity / `agy`, or personal Drive),
   - **DeepSeek** (including AI Gateway search/routing paths backed by DeepSeek),
   - **Free OpenRouter or `opencode` models** (prompt logging / model-training exposure).
   Keep work material strictly local/deterministic or on employer-approved enterprise tenants.
2. **Model Floor (Hard Rule):** **Never use or recommend `Gemini 3.8 Flash` (or any `3.x Flash` / `3.8` model)** for chat, voice, or subagents. Minimum light/subagent model is **`gemini-4-hydrogen`**, with **`GPT-6.1 Terra`** or **`Claude Haiku 5.5`** as acceptable alternatives (`gemini-4-carbon` for synthesis/coding).
3. **8 GB RAM Mac mini Ceiling:** The always-on Mac mini has **8 GB RAM** and is already loaded — **no rendering, no Docker Desktop, and no heavy containers** on it (~40 MB RSS cap for the local `launchd` queue poller). Heavy container/browser/batch jobs go to **Cloud Run (scale-to-zero)**, **Google Colab** (personal data only), or **RunPod**.
4. **GitHub Copilot Excluded from Agent Stack:** Avoid GitHub Copilot for autonomous/subagent work due to rapid premium-request credit burn; keep it out of the Default Stack.

---

## 1. Existing Baseline & Verified Credits

| Asset / Subscription | Verified Entitlements | Role & Constraints |
|---|---|---|
| **Google Cloud Billing (`0140A2-72DEB2-62EDCD`) + Google AI Ultra** *(£79.99/mo Ultra 5x sunk from Dec)* | **Confirmed to cover all of Google Cloud** (Cloud Run, Firebase Hosting, Gemini API via Cloud Billing, Compute Engine, etc.): **US$100 credit in Nov 2026**, **US$40/mo (~£31.60/mo) from Dec 2026** *(rolls 12 months)*, **plus GCP Free Trial credit until 11 Feb 2027**; **1,000 Colab units/mo**; **10,000 Flow credits/mo**; **5x Antigravity quota**. **No separate included Gemini Live/voice allowance** (voice draws from the Cloud credit). | Covers **Cloud Run (scale-to-zero)** workers, existing **Firebase Hosting**, **`gemini-4-hydrogen`**, and **Gemini Live API (current model)** at **£0 net out-of-pocket** within the US$40/mo credit. **Personal/non-KF data only.** |
| **Existing Personal GCP Baseline** *(active)* | **Cloud Run + Firebase Hosting** protected by a **~£5/mo budget alert**. | Fully covered (**£0 net**) by the confirmed US$40/mo Google Cloud credit (and Free Trial credit through 11 Feb 2027); keep the £5/mo budget alert active as a guardrail. |
| **Always-On Mac mini (8 GB RAM, loaded)** *(owned)* | Apple Silicon, residential UK IP, 24/7 uptime (~10–15W idle ≈ **~£3.50/mo** UK electricity). | **Lightweight native `launchd` worker (~40 MB RSS cap)** for cron/task queue polling, health check, log rotation, and light local tasks only — **zero heavy jobs or containers**. |
| **Vercel** *(configured)* | Next.js hosting, Vercel Blob, AI Gateway OIDC routing. | **Web/Mobile PWA Chat Shell** + private signed file proxy & API ingress. |
| **Claude Pro / ChatGPT Plus / Lovable Pro** *(sunk)* | Interactive web seats *(GitHub Copilot excluded from agent stack)*. | Interactive development & UI prototyping. |

---

## 2. Category-by-Category Comparison (`£/month` & Trade-Offs)

### A. Execution "Box", Containers & Heavy Offload

| Option | Est. Net Cost (`£/mo`) | Persistence & Scaling | Pros | Trade-Offs |
|---|---|---|---|---|
| **1. Hybrid: 8 GB Mac mini `launchd` (~40 MB) + Cloud Run (Scale-to-Zero) + Colab** *(Recommended Default)* | **~£3.50/mo** Mac electricity + **£0 net** Cloud Run *(covered by $40/mo GCP credit)* + **£0** Colab *(1,000 units/mo)* | Always-on lightweight macOS poller + **scale-to-zero** Linux containers on Cloud Run Services/Jobs | **Preferred over always-on VMs:** Cloud Run scales to `min-instances=0` so idle container cost is **£0**, preserving the US$40/mo credit for active runs and Gemini API calls while keeping 100% of container RAM off the 8 GB Mac mini. | Personal Google Cloud & Colab are strictly **non-KF / personal data only**; use RunPod (~£0–£4/mo) if non-Google GPU bursts are needed. |
| **2. Google Cloud Compute Engine VM (`e2-medium` / `e2-standard-2`)** | **£0 net within $40/mo credit** *(raw ~$24–$49/mo burns 60–100%+ of the $40 Dec credit even when idle)* | Always-on Ubuntu Linux VM | Confirmed covered by billing account credits if ever needed for stateful daemons. | **Inferior to Cloud Run scale-to-zero:** an always-on VM wastes $24–$49/mo of the $40/mo credit while sitting idle, and new-project GPU quota is often `0`. |
| **3. RunPod (Serverless / On-Demand Pods)** | **£0 idle** · **~£0–£4/mo** occasional bursts | Per-second GPU/CPU containers | Non-Google GPU rendering/media burst option when Colab isn't suitable; zero monthly floor. | Cold-start of a few seconds on serverless workers. |
| **4. Fly Machines / Vercel Sandbox / Daytona / E2B** | **£0–£12/mo** *(E2B Pro: £118/mo)* | Micro-VMs / ephemeral sandboxes | Fast isolation. | Redundant now that Cloud Run scale-to-zero is confirmed covered by the $40/mo GCP credit. |

---

### B. Browser Automation (Computer-Use & Web Workflows)

| Option | Est. Net Cost (`£/mo`) | Anti-Bot / Auth Profile | Trade-Offs |
|---|---|---|---|
| **1. Cloud Run Scale-to-Zero Playwright / Steel Container** *(Recommended for Multi-Tab/Heavy)* | **£0 net** *(covered by $40/mo GCP credit)* | Isolated Linux Chromium container spinning up per job and scaling to zero immediately | Zero RAM impact on the 8 GB Mac mini and zero idle VM burn. Personal/non-KF browsing only. |
| **2. Single-Tab Ephemeral Read on 8 GB Mac mini** *(Light Residential UK Only)* | **£0** | Residential UK IP, closed immediately after run | Useful only when a residential UK IP is required; must pause on `ApprovalCard` before any submit/purchase. |
| **3. Steel.dev Cloud (~£0.07/hr) / Browserbase (£16/mo Dev)** | **£0–£16/mo** | Managed cloud Chromium + session replay | Optional Upgrade Stack fallback. |

*(Never automate CAPTCHA solving or bypass access controls; pause and hand back to the owner if challenged.)*

---

### C. Voice (Voice Memos & Live Speech-to-Speech)

| Option | Billing & Unit Cost | Est. Net Monthly (`£/mo` for ~60 mins/mo) | Trade-Offs |
|---|---|---|---|
| **1. Gemini Live API (current model)** *(Recommended Personal Voice)* | **Paid per-use Gemini API** via Cloud Billing *(~£1.50–£3.00/mo raw; no separate Live allowance)* | **£0 net** *(drawn from confirmed US$40/mo GCP credit)* | Low-latency bilingual EN/TR streaming & tool calling. **Personal/non-KF use only.** |
| **2. Async Voice Memos (`gemini-4-hydrogen` audio or OpenAI STT)** | Paid per-use API (<£0.01/min) | **£0–£0.50/mo** *(offset by US$40 GCP credit on `gemini-4-hydrogen`)* | Dictate EN/TR notes into editable composer text; respects the **`gemini-4-hydrogen` minimum model floor** (never `3.x Flash`). |
| **3. OpenAI Realtime (`gpt-realtime-2.1-mini` / `2.1`)** | Mini: $10/$20 per 1M audio · Flagship: $32/$64 per 1M | **£2–£11/mo** *(draws against OpenAI `$10/mo` ledger cap)* | Reserve for Upgrade Stack so chat allowance stays intact. |

---

### D. Long-Term Memory, Subagent Models & Queues

| Layer | Recommended Choice | Est. Net Cost (`£/mo`) | Why |
|---|---|---|---|
| **Chat & Subagent Models** | App chat: **`gpt-6-luna`** + selective **`gpt-6.1-terra`** (`$10/mo` hard ledger cap). Light subagents: **`gemini-4-hydrogen`** minimum (drawn from US$40 GCP credit) or **`GPT-6.1 Terra` / `Claude Haiku 5.5`**. | **£3.00 – £7.90/mo** *(OpenAI cap)* + **£0 net** *(Gemini API within $40 credit)* | Obeys the strict model floor (**zero `Gemini 3.8 Flash` / `3.x Flash`**) and avoids GitHub Copilot credit burn and free OpenRouter/DeepSeek data leaks. |
| **Memory & Vector Store** | **Existing Neon Postgres** (`MemoryProfileFact`, `MemoryJournalEntry` + `pgvector`/FTS) | **£0 – £2.00/mo** | Owner-isolated ACID DB with zero external SaaS memory vendor. |
| **Queues & Cron** | **Postgres Queue** (`BackgroundTask` + `CronJob` `FOR UPDATE SKIP LOCKED`) polled by the **8 GB Mac mini ~40 MB `launchd` worker** (dispatching heavy jobs to Cloud Run Jobs) | **£0** | Sub-minute precision, automatic restart & log rotation on macOS, and scale-to-zero cloud offload. |

---

## 3. Recommended Stacks

### Stack 1: Recommended Default Stack — **~£6.50 to £13.40/month out-of-pocket** *(Well under £30/month target)*

Grounded in confirmed billing account `0140A2-72DEB2-62EDCD` (**US$100 Nov → US$40/mo Dec Ultra 5x credit + Free Trial to 11 Feb 2027**, covering Cloud Run, Firebase Hosting, and Gemini API), **scale-to-zero Cloud Run** instead of always-on VMs, and strict **no-KF-data on personal Google / DeepSeek / free OpenRouter**:

| Layer | Default Choice | Monthly Out-of-Pocket (`£/mo`) |
|---|---|---|
| **Personal GCP Cloud Run + Firebase + Gemini API** | Existing Cloud Run + Firebase Hosting (~£5/mo alert) + **scale-to-zero Cloud Run worker containers** + **`gemini-4-hydrogen`** & **Gemini Live API (current model)** | **£0 net** *(covered by confirmed US$40/mo GCP credit + Free Trial to 11 Feb 2027)* |
| **Web / Mobile PWA Shell & Vault** | Existing **Vercel** plan (`Next.js 16` + private file proxy + AES-256-GCM `SecretVault`) | **£0** |
| **App Chat LLM Routing** | OpenAI **`gpt-6-luna` / `gpt-6.1-terra`** (`AI_MONTHLY_ALLOWANCE_USD=10` hard ledger cap; no Copilot; no 3.x Flash) | **£3.00 – £7.90/mo** |
| **Always-On Local Queue Poller** | **8 GB RAM Mac mini** native `launchd` worker (~40 MB RSS cap, health check, log rotation; **no heavy jobs locally**) + Tailscale Free | **~£3.50/mo** *(UK electricity)* |
| **Optional Non-Google GPU Bursts** | **Google Colab** (1,000 Ultra 5x units/mo = **£0**, personal data only) + optional **RunPod** per-second bursts | **£0 – £2.00/mo** |
| **Database, Memory & Queue** | **Neon Postgres** (`CronJob`, `BackgroundTask`, `VaultSecret`, `Memory*` + `pgvector`) + **Upstash Redis Free** | **£0 – £2.00/mo** *(capped conservatively)* |
| **Total Monthly Out-of-Pocket** | | **~£6.50 – £15.40 / month** *(typical steady-state **~£6.50 – £11.50/mo**)* |

---

### Stack 2: Zero-Home-Hardware "Cloud Upgrade" Stack — **~£30 to £48/month**

Use only when travelling long-term with the Mac mini powered off (replacing the local `launchd` poller with **Cloud Scheduler + scale-to-zero Cloud Run Jobs** covered by the $40/mo GCP credit, plus Vercel Pro + higher OpenAI allowance):

| Layer | Upgrade Choice | Monthly Out-of-Pocket (`£/mo`) | What It Adds |
|---|---|---|---|
| **Cloud Queue, Cron & Containers** | **GCP Cloud Scheduler + Cloud Run Jobs (scale-to-zero)** + Firebase Hosting | **£0 net** *(within $40/mo GCP credit)* | 24/7 sub-minute cloud scheduling & isolated Chromium/worker containers with Mac mini off |
| **App Platform** | **Vercel Pro** ($20/mo) | **~£16/mo** | 800s Fluid Compute & commercial team controls |
| **Database Scale** | **Neon Launch** PAYG | **~£4 – £6/mo** | Faster warm starts & point-in-time branch restore |
| **LLM + Non-Google Bursts** | Raise OpenAI cap to **$20/mo** + optional **RunPod / Browserbase** bursts | **~£10 – £26/mo** | Higher daily Terra reasoning & non-Google browser/GPU sessions |
| **Total Cloud Upgrade Spend** | | **~£30 – £48 / month** | 100% cloud-autonomous operation leveraging Cloud Run scale-to-zero |
