# Owner Guide — Personal Assistant

**Preview Link:** `https://general-purpose-agent-quickstart-git-feat-9b1f26-csahingoz-3779.vercel.app`  
**Account:** Single-owner Google sign-in (`Europe/London`)

---

## 1. Install on iPhone Home Screen (Recommended)

1. Open the Preview link in **Safari** on your iPhone and sign in with your owner Google account.
2. Tap **Share → Add to Home Screen**.
3. Launching from your Home Screen gives a full-screen app experience with full top/bottom iPhone safe-area spacing and no browser bars.

---

## 2. What Works Out of the Box (Zero API Keys Needed)

- **Default Model Floor & Real Model Picker:** Defaults to **GPT-6.1 Terra** (medium reasoning effort; automatically falls back to **Gemini 4 Hydrogen** if Terra is ever unavailable on the Gateway). The composer pill shows the exact model name (`GPT-6.1 Terra`, `Gemini 4 Hydrogen`, or manual-only `GPT-6 Luna`), and research or multi-search questions automatically escalate to `GPT-6.1 Terra` / `Gemini 4 Hydrogen` with medium-or-higher effort. Replies match the language you use (English or Turkish).
- **Hands-Free Live Voice (Right-Hand Waveform Button):**
  - When the message box is empty, tap the **waveform button** on the right side of the composer to start a live, hands-free phone-style conversation (`Gemini 3.8 Live`, routed automatically through Vercel AI Gateway).
  - Speak naturally in English or Turkish. Just talk over the assistant (or tap the mascot orb) to interrupt immediately.
  - Tap the **microphone** button to mute/unmute, or **×** to finish — every spoken turn and tool card is saved cleanly into your chat history.
  - **Live Voice & Chat Tools:** Ask by voice or text about the weather (`Open-Meteo`, zero API key), web search, your memories, routines, Gmail/Calendar/Drive (shows a 1-tap **Connect Google** card if not linked yet), tasks (`TaskCard`), your Linux **Cloud Computer** (`assistant-computer-01`), or your **Mac mini Bridge**. Voice speaks a brief status (`"Checking the weather…"`) while tools run, and any draft or send waits on an **Approve** card.
- **Cloud Computer (Built-in Linux VM):** Ask the assistant to run shell commands, Python scripts, `git` clones, headless browser checks, or generate files in `/workspace` and export them straight into chat — it wakes your private GCP Ubuntu VM automatically and stops it after 20 minutes idle (£0 net on your $40/mo Google AI Ultra credit).
- **Mac mini Bridge (Optional One-Time Tailscale Pairing):** Once standalone Tailscale is installed on the Mac mini, run `zsh ops/mac-bridge/setup-mac-bridge.sh`, apply `ops/mac-bridge/tailscale-acl.hujson` in Tailscale Admin, and link the cloud VM (`tailscale up --ssh --authkey=<tag:bot-key>`). Commands run as non-admin `botrunner` inside named `tmux` sessions (`tmux attach -t task-<id>`) with full session logs, no `sudo`, and an instant kill-switch (`zsh ops/mac-bridge/revoke-mac-bridge.sh`).
- **Quick Dictation (Left Microphone Button):** Tap the small microphone next to `+` to dictate text into the message box before editing and sending.
- **File & Image Attachments (`+`):** Attach images, PDFs (up to 10 MB), or CSV spreadsheets (up to 5 MB). CSV columns are totalled deterministically on the server.
- **Image Studio:** Ask in chat to create an image; it generates inline via Vercel AI Gateway (`Imagen 4`) with spend caps enforced automatically.
- **Teammates, Memory, Routines & Skills:** Open the top-left menu (or `⋯ → Usage & settings`) and use the sticky top bar to switch between **Teammates** (*Chief of Staff*, *Finance Controller*, *Vibecoder*), **Memory** (facts & journal), **Routines** (scheduled briefs & background tasks), **Skills**, and **Setup**.

---

## 3. Connecting Personal Apps (`/setup`)

You never need to copy or paste API keys into the app:

1. Open **Setup** from the workspace bar (`/setup`).
2. Every capability shows a **green**, **amber**, or **optional** status dot in one plain-English line.
3. Tap **Connect** next to **Google Gmail, Calendar & Drive** (or **GitHub**) to link your personal account with one-tap OAuth.
4. **Safety by design:** Connected apps can **read** and prepare **unsent drafts only** (unsent Gmail drafts, tentative `[DRAFT]` Calendar entries with zero invites sent, unpublished GitHub PR review drafts). Every draft or state-changing action requires your explicit **Approve** tap.

---

## 4. Upgrading Live Voice to Gemini 4 Live

Live Voice uses Google's latest speech-to-speech model (`gemini-3.8-live`, approved exclusively for the Live Voice lane while `3.x` text models remain blocked). As soon as Google releases **Gemini 4 Live**, switch it in **one place**:

- Either set `GEMINI_LIVE_MODEL=gemini-4-live` in Vercel Environment Variables, **or**
- Change the single `DEFAULT_LIVE_MODEL` value in `lib/voice/live-protocol.ts`.

---

## 5. Strict Privacy & Work-Data Rule

This is your **personal** assistant. Employer / Korn Ferry confidential material is automatically blocked from personal Google services, voice endpoints, and share links. Published snapshots (`/share/...`) strip personal identifiers and can be revoked in one tap from **Results in this chat**.
