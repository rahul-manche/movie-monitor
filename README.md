## n8n flow

<img width="1465" height="589" alt="image" src="https://github.com/user-attachments/assets/c0ef299d-847b-48bf-a288-6b716dd97649" />


# BookMyShow Movie Monitor

A self-hosted monitoring service that watches BookMyShow movie pages for booking opening and language availability changes.

## What it does

- Accepts a BookMyShow movie URL dynamically.
- Accepts a desired language dynamically, such as Hindi, English, Telugu, Tamil, Malayalam, or Kannada.
- Uses Playwright with Firefox in a Debian LXC to load the page like a real browser.
- Detects whether the Book tickets button exists.
- Handles multiple BookMyShow flows, including the 18+ age dialog and language popup.
- Returns structured JSON for n8n or any other caller.
- Runs automatically when the LXC boots by using a systemd service.

## Architecture

```text
n8n (or any client)
    │
    │ POST /check
    ▼
Movie Monitor API (Node.js + Express)
    │
    │ calls
    ▼
scraper.js (BookMyShow parser)
    │
    │ uses
    ▼
browser.js (shared Firefox browser)
    │
    ▼
BookMyShow page in Firefox
```

## What we discovered

- curl and wget from the VPS were blocked by Cloudflare with HTTP 403.
- Plain Node.js HTTP requests from n8n were also blocked.
- Playwright Chromium was blocked by Cloudflare.
- Playwright Firefox in a Debian LXC successfully loaded the BookMyShow page.
- The Book tickets dialog is rendered in the DOM after clicking the button.
- The dialog contains language rows and format buttons that can be scraped directly.
- The page also contains release-language metadata that is NOT the same as booking availability.
- Some movies do not yet have a Book tickets button; that means booking is not open yet.

## Problems we hit and how we solved them

### Cloudflare blocked HTTP clients
The resolution was to use Firefox via Playwright in a normal browser context inside a Debian LXC.

### Playwright Chromium failed
Chromium was blocked by Cloudflare in the server environment, so we switched to Firefox.

### networkidle timed out
Use domcontentloaded and a small extra wait instead.

### HTML parsing guesswork failed
Click Book tickets and parse the rendered language dialog instead of relying on internal JSON paths.

### Headed Firefox failed in CLI-only LXC
Headless Firefox worked, so we kept the setup headless and avoided Xvfb.

## Current project files
- `browser.js` - launches and reuses a shared Firefox browser.
- `scraper.js` - exports `scrapeMovie(url, wantedLanguage)`.
- `server.js` - exposes `/health` and `/check` endpoints.
- `lib/navigation.js` - detects booking flow.
- `lib/popup.js` - dismisses the 18+ popup when present.
- `lib/parser.js` - parses language and formats.
- `lib/retry.js` - retry helper for transient failures.
- `lib/logger.js` - tiny logger helper.
- `package.json` - project manifest.
- `systemd` service file - starts the service automatically at boot.

## Installation prerequisites
- Debian 12 LXC created in Proxmox.
- Node.js 22 installed inside the LXC.
- Playwright installed with Firefox support.
- Firefox browser dependencies installed.
- Express installed.
- Optional: Tailscale if you want to reach the service from the VPS.

## Setup steps
1. Create a Debian 12 LXC in Proxmox. Unprivileged is fine. Nesting was not required for the working headless Firefox setup.
2. Enter the LXC and install Node.js 22.
3. Create `/opt/movie-monitor` and initialize npm.
4. Install dependencies: `express` and `playwright`.
5. Install Firefox via Playwright and the Firefox system dependencies.
6. Create `browser.js`, `scraper.js`, and `server.js`.
7. Test the scraper locally with `node server.js`.
8. Test `/health` and `/check` using `curl` from inside the LXC.
9. Create a systemd service so the app starts automatically when the LXC boots.

## Exact commands used
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v
npm -v
```

```bash
mkdir -p /opt/movie-monitor
cd /opt/movie-monitor
npm init -y
npm install express playwright
npx playwright install firefox
npx playwright install-deps firefox
```

```bash
node server.js
```

```bash
curl http://localhost:3000/health

curl -X POST http://localhost:3000/check \
  -H "Content-Type: application/json" \
  -d '{
    "url":"https://in.bookmyshow.com/movies/hyderabad/spider-man-brand-new-day/ET00447840",
    "wantedLanguage":"Hindi"
  }'
```

## API usage

### Health

```http
GET /health
```

Example response:

```json
{
  "success": true,
  "status": "Healthy",
  "timestamp": "2026-07-18T10:25:58.400Z"
}
```

### Check a movie

```http
POST /check
Content-Type: application/json

{
  "url": "https://in.bookmyshow.com/movies/hyderabad/spider-man-brand-new-day/ET00447840",
  "wantedLanguage": "Hindi"
}
```

Example response:

```json
{
  "success": true,
  "movie": {
    "title": "Spider-Man: Brand New Day",
    "movieId": "ET00447840",
    "city": "hyderabad",
    "url": "https://in.bookmyshow.com/movies/hyderabad/spider-man-brand-new-day/ET00447840"
  },
  "booking": {
    "open": true,
    "checkedAt": "2026-07-18T10:26:18.037Z"
  },
  "languages": [
    {
      "language": "English",
      "formats": [
        "HDR By Barco",
        "EPIQ 3D",
        "4DX 3D",
        "2D",
        "3D",
        "DOLBY CINEMA 3D"
      ]
    }
  ],
  "wantedLanguage": {
    "name": "Hindi",
    "available": false
  }
}
```

## Interpreting the response
- `booking.open = false` means the movie is still upcoming or tickets are not on sale yet.
- `booking.open = true` means the Book tickets dialog exists and the movie is now bookable.
- `languages` is an array of language objects, each with the available formats.
- `wantedLanguage.available = false` means the target language is not yet bookable.
- `wantedLanguage.available = true` means the target language is now available.

## n8n workflow integration
The final API is designed to be called from n8n. A typical n8n flow is Cron -> HTTP Request -> Merge -> Code -> Google Sheets Update -> IF -> Telegram.

## Suggested Google Sheet schema

| Column | Purpose | Manual or automatic |
|---|---|---|
| `enabled` | Turn monitoring on or off | Manual |
| `movie` | Friendly movie name | Manual / scraped |
| `city` | Display only | Manual / scraped |
| `url` | BookMyShow movie URL | Manual |
| `wantedLanguage` | Language to watch for | Manual |
| `notifyBookingOpen` | Notify when booking opens | Manual |
| `notifyLanguage` | Notify when wanted language appears | Manual |
| `notifyCount` | Maximum meaningful notifications before auto-disable | Manual |
| `autoDisable` | Disable row after reaching notifyCount | Manual |
| `priority` | Display / sorting only | Manual |
| `remarks` | Free-form notes | Manual |
| `bookingOpen` | Current booking state | Automatic |
| `available` | Current wanted-language availability | Automatic |
| `stateHash` | Current monitored state snapshot | Automatic |
| `event` | Current event name | Automatic |
| `runCount` | How many times this row has been checked | Automatic |
| `notified` | How many notifications were sent | Automatic |
| `lastChecked` | Last check ISO timestamp | Automatic |
| `lastCheckedDisplay` | Last check human-readable timestamp | Automatic |
| `lastChanged` | Last time the state changed | Automatic |
| `lastNotification` | Last time Telegram was sent | Automatic |
| `lastMessage` | Last event label | Automatic |
| `lastError` | Last scrape error | Automatic |

## Example rows

```tsv
enabled	movie	city	url	wantedLanguage	notifyBookingOpen	notifyLanguage	notifyCount	autoDisable	priority	remarks
TRUE	Spider-Man: Brand New Day	Hyderabad	https://in.bookmyshow.com/movies/hyderabad/spider-man-brand-new-day/ET00447840	Hindi	TRUE	TRUE	3	TRUE	HIGH	Waiting for Hindi
TRUE	Awarapan 2	Hyderabad	https://in.bookmyshow.com/movies/hyderabad/awarapan-2/ET00439318	Hindi	TRUE	FALSE	2	TRUE	MEDIUM	Only booking alert
TRUE	The Odyssey	Hyderabad	https://in.bookmyshow.com/movies/hyderabad/the-odyssey/ET00452034	Hindi	TRUE	FALSE	50	TRUE	LOW	Testing...
```

## What to alert on
- Alert when `booking.open` changes from `false` to `true`.
- Alert when `wantedLanguage.available` changes from `false` to `true`.
- Optionally alert when new formats like IMAX, 4DX, or Dolby Cinema appear.
- Optionally alert when rating, release date, or language list changes.

## Future improvements we discussed
- Auto recovery if Firefox crashes.
- Request queue so multiple checks do not collide.
- Caching to reduce repeated scraping within a short time window.
- Extra metadata extraction: rating, votes, duration, certificate, genres, release date.
- SQLite-backed watch list and history.
- Background scheduler inside the Movie Monitor service.
- Notification endpoints or push integrations.

## Manual test results
- `curl` to BookMyShow from VPS returned 403 from Cloudflare.
- `wget` to BookMyShow from VPS also returned 403.
- n8n HTTP Request on VPS saw `ECONNRESET` or blocked response.
- Playwright Chromium got Cloudflare challenge pages.
- Playwright Firefox loaded the page successfully in the Debian LXC.
- The Book tickets dialog was found and parsed successfully.
- The final `/check` endpoint returned booking and language data correctly for multiple movies.

## Operational commands
```bash
systemctl start movie-monitor
systemctl stop movie-monitor
systemctl restart movie-monitor
systemctl status movie-monitor
journalctl -u movie-monitor -f
```

## Example output states

```json
{
  "booking": { "open": false },
  "languages": [],
  "wantedLanguage": { "name": "Hindi", "available": false }
}
```

```json
{
  "booking": { "open": true },
  "languages": [
    { "language": "English", "formats": ["2D", "3D"] }
  ],
  "wantedLanguage": { "name": "Hindi", "available": false }
}
```

```json
{
  "booking": { "open": true },
  "languages": [
    { "language": "English", "formats": ["2D", "3D"] },
    { "language": "Hindi", "formats": ["2D", "IMAX"] }
  ],
  "wantedLanguage": { "name": "Hindi", "available": true }
}
```

## Practical notes
- Do not rely on `eventLanguage` alone; it is release metadata, not booking availability.
- Do not wait for `networkidle` on BookMyShow; use `domcontentloaded` + short waits.
- Use Firefox in headless mode in the LXC; headed mode failed because there was no `DISPLAY`.
- Use the Book tickets dialog as the source of truth for availability.
- Keep `browser.js`, `scraper.js`, and `server.js` separate for easier maintenance.

## Short summary
The project started as a simple idea: notify when Hindi tickets become available on BookMyShow. After several blocked approaches and false starts, the reliable solution was found: use Playwright Firefox in a Debian LXC, load the page as a real browser, click Book tickets, parse the dialog, and expose the result through a small Express API. That API is ready for n8n or any other automation client.

## Git publishing steps

1. Initialize a Git repo in `/opt/movie-monitor`.
2. Add a proper `.gitignore` (`node_modules/`, `.cache/`, logs, temp files).
3. Commit the current working code and documentation.
4. Create a GitHub repository.
5. Add the GitHub remote and push the main branch.
6. Optionally add tags/releases when the scraper or workflow gets major updates.

### Example git commands

```bash
cd /opt/movie-monitor
git init
cat > .gitignore <<'EOF'
node_modules/
.cache/
*.log
/tmp/
EOF
git add .
git commit -m "Initial Movie Monitor release"
git branch -M main
git remote add origin git@github.com:YOUR_USERNAME/movie-monitor.git
git push -u origin main
```

### Recommended repo layout

- `browser.js`, `scraper.js`, `server.js` at the repo root.
- `lib/` for helpers.
- `README.md` for setup and usage.
- `SYSTEMD.md` if you want to keep service instructions separate.
- `docs/` for future design notes or screenshots.

### What to include in the README commit
- What the project is.
- Why it exists.
- Prerequisites.
- Setup instructions.
- Example API request/response.
- n8n workflow overview.
- Troubleshooting notes.
- Git deployment instructions.


### Screenshots
<img width="2560" height="393" alt="image" src="https://github.com/user-attachments/assets/bead31f8-f8c2-4176-b202-00995e48b437" />

<img width="1259" height="687" alt="image" src="https://github.com/user-attachments/assets/41b0df6c-ff29-4e90-82ab-6702e8c00437" />

<img width="1271" height="1105" alt="image" src="https://github.com/user-attachments/assets/29b7c543-fd3b-4284-b0e0-0fb739b74ffe" />

<img width="1261" height="669" alt="image" src="https://github.com/user-attachments/assets/3f0a09cc-374c-4a0f-bfec-1ff8c36d50ae" />

<img width="1289" height="691" alt="image" src="https://github.com/user-attachments/assets/02f47119-9ede-4507-ad6f-17e228d86d10" />

<img width="1289" height="1269" alt="image" src="https://github.com/user-attachments/assets/c8b26115-283c-443f-b2c1-ec6fe4d0289c" />

<img width="1271" height="757" alt="image" src="https://github.com/user-attachments/assets/e4bdd6fe-463a-4491-bbbe-3e657b97a702" />

<img width="1263" height="821" alt="image" src="https://github.com/user-attachments/assets/16da97ca-8f5e-4fb7-938c-038c92d8fd6d" />

<img width="1235" height="761" alt="image" src="https://github.com/user-attachments/assets/9b94cbe5-8923-4a80-9786-4e3faeb59f06" />







