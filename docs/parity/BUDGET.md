# Assistant Feature Parity — Infrastructure & Cost Budget (`£/month`)

**Owner:** Çağlar (`Europe/London`)  
**Baseline Date:** November 2026 *(budgeted against December 2026 steady-state: **Google AI Ultra 5x**)*  
**Rule:** Cheapest-first, grounded in verified billing mechanics, hard spending caps, and strict work/personal data boundaries.  
*(FX conversion used below: `US$1.00 ≈ £0.79`, rounded conservatively.)*

---

## 0. Mandatory Governance, Model & Hardware Constraints

1. **Korn Ferry / Work Data Boundary (Hard Rule):** Korn Ferry or any employer/client material **must NEVER be sent** to:
   - The **personal Google project** (Colab, AI Studio, Gemini Developer API, Antigravity / `agy`, personal Cloud Run, or personal Drive),
   - **DeepSeek** (including AI Gateway search/routing paths backed by DeepSeek),
   - **Free OpenRouter or `opencode` models** (prompt logging / model-training exposure).
   Keep work material strictly local/deterministic or on employer-approved enterprise tenants.
2. **Model Floor (Hard Rule):** **Never use or recommend `Gemini 3.8 Flash` (or any `3.x Flash` / `3.8` model)** for chat, voice, or subagents. Minimum light/subagent model is **`gemini-4-hydrogen`**, with **`GPT-6.1 Terra`** or **`Claude Haiku 5.5`** as acceptable alternatives (`gemini-4-carbon` for synthesis/coding).
3. **8 GB RAM Mac mini Ceiling:** The always-on Mac mini has **8 GB RAM** and is already loaded — **no rendering, no Docker Desktop, and no heavy containers** on it. Heavy batch/GPU/container jobs go to **Google Colab** (personal data only) or **RunPod**.
4. **GitHub Copilot Excluded from Agent Stack:** Avoid GitHub Copilot for autonomous/subagent work due to rapid premium-request credit burn; keep it out of the Default Stack.

---

## 1. Existing Baseline & Sunk Subscriptions

| Asset / Subscription | Verified Entitlements (Dec 2026 Steady-State) | Role & Constraints |
|---|---|---|
| **Google AI Ultra 5x** *(£79.99/mo sunk from Dec; currently on 20x for Nov)* | **US$40/mo (~£31.60/mo) Google Cloud / Developer Program credit** *(must be manually claimed in AI Studio, requires a **US$5 ≈ £4 one-off prepay**, rolls over 12 months)*; **1,000 Colab compute units/mo**; **10,000 Flow credits/mo**; **5x Antigravity quota**. **No included Gemini Live/voice API allowance.** | Offsets per-use **Gemini API** calls (`gemini-4-hydrogen`, **Gemini Live API (current model)**) and **Colab** personal GPU bursts. **Never use for Korn Ferry/work data.** |
| **Existing Personal Google Cloud Project** *(active)* | Runs **Cloud Run + Firebase Hosting** under a **~£5/mo budget alert**. | Baseline personal cloud footprint (**~£0–£5/mo**, depending on how much of Cloud Run/Firebase the claimed US$40 credit offsets). Keep the £5/mo alert in place. |
| **Always-On Mac mini (8 GB RAM, loaded)** *(owned)* | Apple Silicon, residential UK IP, 24/7 uptime (~10–15W idle ≈ **~£3.50/mo** UK electricity). | **Lightweight native `launchd` worker (~40 MB RSS)** for cron/task polling and single-tab ephemeral Playwright reads only — **zero rendering or Docker/containers**. |
| **Vercel** *(configured)* | Next.js hosting, Vercel Blob, AI Gateway OIDC routing. | **Web/Mobile PWA Chat Shell** + authenticated API ingress. |
| **Claude Pro / ChatGPT Plus / Lovable Pro** *(sunk)* | Interactive web seats *(GitHub Copilot intentionally excluded from agent stack due to high credit burn)*. | Human-driven research & UI prototyping *(consumer seats do not grant runtime bot API keys)*. |

---

## 2. Category-by-Category Comparison (`£/month` & Verified Trade-Offs)

### A. Execution "Box", Containers & Heavy Offload

| Option | Est. Cost (`£/mo`) | Persistence & OS | Pros | Cons / Verified Caveats |
|---|---|---|---|---|
| **1. Hybrid: Native `launchd` on 8 GB Mac mini + Colab / RunPod Bursts** *(Recommended Default)* | **~£3.50/mo** Mac electricity + **£0** Colab *(1,000 units/mo)* + **£0–£4/mo** RunPod bursts | Native macOS (`launchd`, no Docker) + ephemeral GPU/container workers | Zero swap pressure on the **8 GB RAM Mac mini**; Colab covers personal Python/OCR/media bursts at £0 marginal cost; **RunPod** (~$0.0002–$0.0004/s serverless or ~$0.20–$0.40/hr pod) handles heavy container/rendering jobs on demand without a fixed monthly VM bill. | Colab is strictly **non-KF / personal only**; RunPod requires explicit container image hygiene. |
| **2. Google Cloud Compute Engine VM (`e2-medium` / `e2-standard-2`)** | **Possibly covered by US$40 credit (*unverified*); otherwise ~£19–£38/mo** | Persistent Ubuntu Linux VM (4–8 GB RAM) | Clean 24/7 Linux Docker host off the Mac mini if credits apply. | **Credit eligibility for Compute Engine VMs is UNVERIFIED**, and **GPU quota on new GCP projects is often `0`**. Do not rely on this being £0 until verified on a billing invoice; personal GCP is also off-limits for KF data. |
| **3. RunPod (Serverless / On-Demand Pods)** *(Recommended Heavy Container/Render Fallback)* | **£0 idle** · **~£1–£6/mo** light burst usage | Per-second Linux containers + optional network volume | Instant GPU/CPU container offload (rendering, OCR, Playwright/ffmpeg batches) keeping the 8 GB Mac mini cool; true pay-per-second billing with zero monthly floor. | Cold-start of a few seconds on serverless endpoints; network volume costs ~$0.07/GB-mo if persisted. |
| **4. Fly Machines (Firecracker micro-VMs)** | **£2–£6/mo** *(~$0.15/GB-mo stopped + per-second CPU)* | Fast-boot Linux micro-VM + volume | Cheap non-Google Linux container host if an always-on/wake-on-demand box is needed without paying £19–£38/mo for GCE. | Separate vendor billing to manage. |
| **5. Vercel Sandbox / Daytona / E2B** | **Vercel/Daytona: £0–£12/mo** · **E2B Pro: £118/mo ($150)** | Ephemeral / dev sandboxes | Good SDK ergonomics for short code runs. | Vercel Hobby has 45m/non-commercial limits; E2B jumps from 1h Hobby cap straight to £118/mo. |

---

### B. Browser Automation (Computer-Use & Web Workflows)

| Option | Est. Extra Cost (`£/mo`) | Anti-Bot / Auth Profile | Trade-Offs |
|---|---|---|---|
| **1. Ephemeral Single-Tab Playwright on 8 GB Mac mini** *(Recommended for Light Residential Reads)* | **£0** | Residential UK IP + local Chromium profile (max 1 tab, closed immediately after run) | £0 SaaS, avoids datacenter IP blocks, protects the 8 GB Mac mini's memory. Must pause on `ApprovalCard` before any submit/purchase. |
| **2. Containerized Steel.dev / Playwright on RunPod or Fly Machine** *(Recommended for Multi-Tab)* | **~£1–£4/mo** *(pay-per-use)* | Isolated Linux container browser + live session viewer | Keeps Docker and multi-tab Chromium completely off the 8 GB Mac mini without assuming unverified GCP VM credit coverage. |
| **3. Steel.dev Cloud ($0 start, ~£0.07/hr) / Browserbase (£16/mo Dev)** | **£0–£16/mo** | Managed cloud Chromium + session replay | Zero ops, best for the Cloud Upgrade Stack when travelling with the Mac mini off. |

*(Never automate CAPTCHA solving or bypass access controls; pause and hand back to the owner if challenged.)*

---

### C. Voice (Voice Memos & Live Speech-to-Speech)

| Option | Billing & Unit Cost | Est. Monthly (`£/mo` for ~60 mins/mo) | Trade-Offs |
|---|---|---|---|
| **1. Gemini Live API (current model)** *(Recommended Personal Voice)* | **Paid per-use Gemini API** via Cloud Billing *(no Live allowance included in Ultra)*; ~£1.50–£3.00/mo raw for ~60 mins | **£0 net while within claimed US$40/mo credit** *(otherwise **~£1.50–£3.00/mo**)* | Low-latency bilingual EN/TR streaming & tool calling. Draws down the US$40/mo AI Studio credit; **personal/non-KF use only**. |
| **2. Async Voice Memos (`gemini-4-hydrogen` audio or OpenAI STT)** | Paid per-use API (<£0.01/min) | **<£0.50/mo** *(offset by US$40 credit on `gemini-4-hydrogen`, or pennies on OpenAI)* | Dictate EN/TR notes into editable composer text before sending; respects the **`gemini-4-hydrogen` minimum model floor** (never `3.x Flash`). |
| **3. OpenAI Realtime (`gpt-realtime-2.1-mini` / `2.1`)** | Mini: $10/$20 per 1M audio · Flagship: $32/$64 per 1M | **£2–£11/mo** *(draws against OpenAI `$10/mo` ledger cap)* | Strong natural prosody, but flagship voice rapidly consumes the `$10/mo` OpenAI chat allowance. |

---

### D. Long-Term Memory, Subagent Models & Queues

| Layer | Recommended Choice | Est. Cost (`£/mo`) | Why |
|---|---|---|---|
| **Chat & Subagent Models** | App chat: **`gpt-6-luna`** + selective **`gpt-6.1-terra`** (`$10/mo` hard ledger cap). Light subagents: **`gemini-4-hydrogen`** minimum (drawn from US$40 credit) or **`GPT-6.1 Terra` / `Claude Haiku 5.5`**. | **£3.00 – £7.90/mo** *(OpenAI cap)* + **£0 net** Gemini API within US$40 credit | Obeys the strict model floor (**zero `Gemini 3.8 Flash` / `3.x Flash`**) and avoids GitHub Copilot credit burn and free OpenRouter/DeepSeek data leaks. |
| **Memory & Vector Store** | **Existing Neon Postgres** (`MemoryProfileFact`, `MemoryJournalEntry` + `pgvector`/FTS) | **£0** *(Free tier)* to **~£4–£8/mo** *(Launch PAYG)* | Keeps all personal profile/journal data in one owner-isolated ACID DB rather than shipping facts to Supermemory (£15/mo Pro). |
| **Queues & Cron** | **Postgres Queue** (`BackgroundTask` + `CronJob` `FOR UPDATE SKIP LOCKED`) polled by the **8 GB Mac mini `launchd` worker** | **£0** | 1-second precision and multi-minute task tracking with zero extra SaaS vendor (Trigger.dev £8/mo reserved for Cloud Upgrade). |

---

## 3. Recommended Stacks

### Stack 1: Recommended Default Stack — **~£8.50 to £22.40/month total** *(Well under £30/month target)*

Assumes **Google AI Ultra 5x** (£79.99/mo sunk from Dec: **US$40/mo claimed AI Studio credit** after **one-off US$5 ≈ £4 prepay**, 1,000 Colab units), existing personal GCP baseline, and strict **no-KF-data on personal Google / DeepSeek / free OpenRouter**:

| Layer | Default Choice | Monthly Out-of-Pocket (`£/mo`) |
|---|---|---|
| **Existing Personal GCP Baseline** | **Cloud Run + Firebase Hosting** on personal project (existing **~£5/mo budget alert**) | **~£2.00 – £5.00/mo** *(£0 if offset by US$40 credit; budgeted conservatively up to alert)* |
| **Web / Mobile PWA Shell** | Existing **Vercel** plan (`Next.js 16` + `OpenUI` + AES-256-GCM `SecretVault`) | **£0** |
| **Chat, Subagents & Voice APIs** | OpenAI **`gpt-6-luna` / `gpt-6.1-terra`** (`AI_MONTHLY_ALLOWANCE_USD=10` cap) + **`gemini-4-hydrogen`** & **Gemini Live API (current model)** billed per-use against claimed **US$40/mo (~£31.60) credit** *(no Copilot; no 3.x Flash)* | **£3.00 – £7.90/mo** *(OpenAI)* + **£0 net** *(Gemini API within $40 credit)* |
| **Always-On Local Poller** | **8 GB RAM Mac mini** native `launchd` worker (~40 MB RSS, single-tab ephemeral Playwright; **no rendering / no Docker**) + Tailscale Free | **~£3.50/mo** *(UK electricity)* |
| **Heavy / Container / Render Offload** | **Google Colab** (1,000 Ultra 5x units/mo = **£0**, personal data only) + **RunPod** pay-per-second bursts for containers/rendering | **£0 – £4.00/mo** |
| **Database, Memory & Queue** | **Neon Postgres** (`CronJob`, `BackgroundTask`, `VaultSecret`, `Memory*` + `pgvector`) + **Upstash Redis Free** | **£0 – £2.00/mo** |
| **Total Monthly Out-of-Pocket** | *(Incremental assistant add-on is **~£6.50–£17.40/mo**; plus **~£2–£5/mo** existing GCP baseline; plus **one-off ~£4 / US$5** AI Studio credit prepay)* | **~£8.50 – £22.40 / month** |

*(Note: If you later add an always-on GCP Compute Engine VM and the US$40 Developer Program credit does **not** cover GCE [currently unverified], that VM would add **~£19/mo** for `e2-medium` or **~£38/mo** for `e2-standard-2` — hence keeping heavy bursts on Colab + RunPod by default.)*

---

### Stack 2: Zero-Home-Hardware "Cloud Upgrade" Stack — **~£48 to £68/month**

Use only when travelling long-term with the Mac mini powered off and needing 100% cloud crons, durable cloud workers, and managed cloud browsers:

| Layer | Upgrade Choice | Monthly (`£/mo`) | What It Adds |
|---|---|---|---|
| **Baseline GCP + App Hosting** | Personal GCP (~£2–£5/mo) + **Vercel Pro** ($20/mo) | **~£18 – £21/mo** | Native per-minute Vercel Crons & 800s Fluid Compute |
| **Durable Cloud Workers & Heavy Bursts** | **Trigger.dev Hobby** ($10/mo) + **RunPod** bursts | **~£8 – £12/mo** | Managed cloud subagent containers without the Mac mini |
| **Managed Cloud Browser** | **Fly Machines** Steel container (~£5/mo) or **Browserbase Dev** ($20/mo) | **~£5 – £16/mo** | Remote multi-tab Chromium + live session replay |
| **Database Scale** | **Neon Launch** PAYG | **~£5 – £7/mo** | Always-warm Postgres compute + point-in-time branch restore |
| **LLM + Voice Allowance** | Raise OpenAI cap to **$20/mo** (`gpt-6-luna` / `gpt-6.1-terra` / `Claude Haiku 5.5`) + Gemini API within US$40 Ultra 5x credit | **~£12 – £16/mo** | Higher daily reasoning & voice volume |
| **Total Cloud Upgrade Spend** | | **~£48 – £68 / month** | Full 24/7 cloud operation with Mac mini switched off |
