# Deploying Movie Monitor to Oracle Cloud (Always Free)

Goal: run the poller 24/7 on a free Oracle Cloud VM so your Mac
can be off. The poller reads the Google Sheet watch-list, scrapes
BookMyShow with Playwright Firefox, and sends Telegram alerts on a
FALSE→TRUE booking/language change.

There are two things only **you** can do (they need your logins):
Part A (create the VM) and Part B (create the Google key). The rest
is copy-paste.

> ⚠️ Gating risk: BookMyShow sits behind Cloudflare. It worked from
> your Mac; a datacenter IP *may* get blocked. **Do Part D (smoke
> test) before trusting the poller.** If it 403s, see "If Cloudflare
> blocks the VM" at the bottom.

---

## Part A — Create the Oracle Cloud VM (you)

1. Sign up at https://www.oracle.com/cloud/free/ (needs a card for
   identity; Always Free resources cost nothing).
2. Console → **Compute → Instances → Create instance**.
   - Image: **Ubuntu 22.04**.
   - Shape: **VM.Standard.A1.Flex** (Ampere/ARM, Always Free) — give
     it **2 OCPU / 8 GB** (well within the free 4 OCPU / 24 GB).
     Firefox needs ~1 GB per scrape; 8 GB is comfortable.
   - Add your SSH public key (or let it generate one — download it).
3. Create, wait for **Running**, note the **public IP**.
4. SSH in: `ssh ubuntu@<PUBLIC_IP>`

(No inbound ports need opening — the poller only makes *outbound*
calls. You do not need the Express server for this.)

## Part B — Google service account + share the sheet (you)

The server can't use your Google login; it uses a service account.

1. https://console.cloud.google.com → create/pick a project.
2. **APIs & Services → Enable APIs → enable "Google Sheets API".**
3. **IAM & Admin → Service Accounts → Create service account**
   (any name, e.g. `movie-monitor`). No roles needed.
4. Open it → **Keys → Add key → Create new key → JSON**. A JSON file
   downloads. Note the service account **email** (ends
   `@…iam.gserviceaccount.com`).
5. Open your watch-list sheet → **Share** → paste that email →
   **Editor** → Send. (This is how the server gets write access.)

---

## Part C — Put the code on the VM

The project isn't in git. Easiest: copy it from your Mac.

```bash
# On your Mac, from /Users/rmanche/Desktop/bms-booking:
rsync -av --exclude node_modules --exclude .cache \
  movie-monitor/ ubuntu@<PUBLIC_IP>:/tmp/movie-monitor/
# Copy the Google key you downloaded in Part B:
scp ~/Downloads/<your-key>.json ubuntu@<PUBLIC_IP>:/tmp/service-account.json
```

Then on the VM:

```bash
sudo useradd -r -m -d /opt/movie-monitor movie   # service user
sudo mv /tmp/movie-monitor/* /opt/movie-monitor/
sudo mv /tmp/service-account.json /opt/movie-monitor/service-account.json
sudo chown -R movie:movie /opt/movie-monitor
```

Install Node 22 + the app + Firefox:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
cd /opt/movie-monitor
sudo -u movie npm install --omit=dev
sudo -u movie npx playwright install firefox
sudo npx playwright install-deps firefox   # system libs for Firefox
```

## Part D — Smoke test (do this before anything else)

Confirm BookMyShow actually loads from this IP:

```bash
cd /opt/movie-monitor
sudo -u movie node -e '
  const { scrapeMovie } = require("./scraper");
  scrapeMovie("https://in.bookmyshow.com/movies/hyderabad/bethlehem-kudumba-unit/ET00502829","Malayalam")
    .then(r => { console.log(JSON.stringify(r,null,2)); process.exit(0); })
    .catch(e => { console.error("SCRAPE FAILED:", e.message); process.exit(1); });'
```

- If you get JSON with a real movie title and `booking` info → **the
  IP is fine, continue.**
- If it errors with Cloudflare / 403 / a challenge page → jump to
  "If Cloudflare blocks the VM".

## Part E — Configure and enable the poller

```bash
cd /opt/movie-monitor
sudo -u movie cp .env.example .env
sudo -u movie nano .env
```

Fill in `.env`:
- `SHEET_ID` = your sheet id (already prefilled).
- `GOOGLE_KEY_FILE=/opt/movie-monitor/service-account.json`
- `TELEGRAM_BOT_TOKEN` = your bot token.
- `TELEGRAM_CHAT_ID` = `YOUR_TELEGRAM_CHAT_ID` (your group).
- Leave `POLL_INTERVAL_MINUTES=10`.

Install the systemd service (ships in `systemd/`):

```bash
sudo cp /opt/movie-monitor/systemd/movie-monitor-poller.service \
   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now movie-monitor-poller
```

## Part F — Verify

```bash
journalctl -u movie-monitor-poller -f
```

You should see `Poll start`, one line per movie, `Poll done`, every
10 minutes. The sheet's L..W columns update each poll; a real
booking-open change fires a Telegram message to your group. It
auto-starts on reboot and restarts on crash.

To stop: `sudo systemctl disable --now movie-monitor-poller`.

---

## If Cloudflare blocks the VM

The scraper has no proxy support today. Options, cheapest first:
1. **Different region/shape** — try recreating the VM in another
   Oracle region; some IP ranges are treated differently.
2. **Residential proxy** — sign up for one (e.g. a pay-as-you-go
   residential proxy), then add proxy support to `browser.js`
   (`firefox.launch({ proxy: { server, username, password } })`).
   Ask me and I'll wire it in + add a `PROXY_URL` env var.
3. **Run on a home device instead** — a Raspberry Pi / the original
   Debian LXC uses your residential IP (which already worked). Same
   code, same systemd unit.
