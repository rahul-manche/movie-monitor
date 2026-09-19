# Deploy Movie Monitor on GitHub Actions (no card, no server)

A scheduled GitHub Action runs the poller every ~10 minutes: it
scrapes BookMyShow, updates the Google Sheet, and sends Telegram
alerts on a FALSE→TRUE change. State lives in the sheet, so nothing
needs to be stored in the repo.

Two hands-on parts: **Phase A** (Google key) and **Phase B–D**
(GitHub). The workflow file `.github/workflows/poll.yml` is already
in the repo.

> ⚠️ Same Cloudflare caveat as any datacenter host: GitHub's runners
> use datacenter IPs, so BookMyShow *might* 403. **Phase E is a
> manual test run** — check its log before relying on it. Also,
> GitHub's scheduler is best-effort: alerts can land 5–15 min late.

---

## Phase A — Google service account key (you)

The Action authenticates to your sheet with a service account.

1. https://console.cloud.google.com/ → top bar → project dropdown →
   **New Project** → name `movie-monitor` → **Create** → select it.
2. Enable the API: https://console.cloud.google.com/apis/library/sheets.googleapis.com
   → confirm project selected → **Enable**.
3. https://console.cloud.google.com/iam-admin/serviceaccounts →
   **Create service account** → name `movie-monitor` →
   **Create and continue** → **Continue** → **Done**.
4. Click the account → **Keys** → **Add key → Create new key → JSON
   → Create**. A `.json` file downloads. **Open it in a text editor
   and copy the entire contents** — you'll paste it as a secret.
5. Copy the account **email** (`…@….iam.gserviceaccount.com`).
6. Open the sheet:
   https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit
   → **Share** → paste that email → **Editor** → untick "Notify" →
   **Share**.

## Phase B — GitHub account + public repo (you)

1. https://github.com/signup — create a free account (no card).
2. https://github.com/new
   - **Repository name:** `movie-monitor`
   - **Public** (required — public repos get unlimited free Actions
     minutes; polling every 10 min would blow the private-repo quota).
   - Do **not** add a README/gitignore (we push our own).
   - **Create repository.** Leave the page open — copy the repo URL
     it shows, e.g. `https://github.com/<you>/movie-monitor.git`.

## Phase C — Push the code (on your Mac)

The `.gitignore` already excludes `node_modules`, `.env`, and any
service-account JSON, so secrets can't be pushed by accident.

```bash
cd /Users/rmanche/Desktop/bms-booking/movie-monitor
git init
git add .
git commit -m "Movie Monitor poller + GitHub Actions"
git branch -M main
git remote add origin https://github.com/<you>/movie-monitor.git
git push -u origin main
```
If prompted to log in, use a **Personal Access Token** as the
password: https://github.com/settings/tokens → **Generate new token
(classic)** → tick **repo** → generate → copy → paste as password.

## Phase D — Add the 4 secrets (you)

On the repo page: **Settings → Secrets and variables → Actions →
New repository secret.** Add each:

| Name | Value |
|---|---|
| `SHEET_ID` | `YOUR_SHEET_ID` |
| `GOOGLE_CREDENTIALS_JSON` | paste the **entire** JSON file contents from Phase A step 4 |
| `TELEGRAM_BOT_TOKEN` | your bot token |
| `TELEGRAM_CHAT_ID` | `YOUR_TELEGRAM_CHAT_ID` |

Direct link: `https://github.com/<you>/movie-monitor/settings/secrets/actions`

## Phase E — Enable Actions & test (you)

1. Open the **Actions** tab. If prompted, click **"I understand… enable
   workflows."**
2. Left sidebar → **Movie Monitor poll** → **Run workflow** →
   **Run workflow** (this is the manual trigger).
3. Click the run → the **poll** job → expand **"Run one poll"**.
   - Log shows `Poll start`, a line per movie, `Poll done` → 🎉 it
     works. Any real booking-open change sends a Telegram message.
   - If it shows a Cloudflare **403 / "you have been blocked"** →
     stop; ping me and we switch to a residential proxy or a home
     device (the datacenter IP got blocked).

## Phase F — Let the schedule run

Once the manual run is green, the `schedule:` trigger fires it every
~10 min automatically. Nothing else to do.

- **Change movies:** just edit the Google Sheet — no redeploy.
- **Pause:** Actions tab → ⋯ → **Disable workflow**.
- **Watch runs:** the Actions tab lists every run + logs.

> Note: GitHub disables scheduled workflows in a repo with **60 days
> of no activity**. A manual **Run workflow** click (or any push)
> resets that clock.
