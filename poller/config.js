// Central config for the poller, read from environment.
// On the server these come from the systemd unit / .env file.

require("dotenv").config();

function required(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required env var: ${name}`);
    }
    return value;
}

if (!process.env.GOOGLE_KEY_FILE && !process.env.GOOGLE_CREDENTIALS_JSON) {
    throw new Error(
        "Provide GOOGLE_KEY_FILE (path) or GOOGLE_CREDENTIALS_JSON (inline)."
    );
}

module.exports = {

    // Google Sheet holding the watch-list (columns A..Y).
    SHEET_ID: required("SHEET_ID"),

    // Range to read each poll. Rows 2+ are watch-list entries.
    // Column V  = per-row notifyEveryMinutes override.
    // Columns W/X = theatre-watch inputs; Y = theatre-watch state.
    SHEET_RANGE: process.env.SHEET_RANGE || "A1:Y50",

    // Google service-account credentials. Provide EITHER:
    //  - GOOGLE_KEY_FILE: path to the JSON key file (server/VM), or
    //  - GOOGLE_CREDENTIALS_JSON: the raw JSON contents (CI/secrets).
    // The service account's email must be shared on the sheet
    // as an Editor.
    GOOGLE_KEY_FILE: process.env.GOOGLE_KEY_FILE || null,
    GOOGLE_CREDENTIALS_JSON: process.env.GOOGLE_CREDENTIALS_JSON || null,

    // Telegram bot credentials.
    TELEGRAM_BOT_TOKEN: required("TELEGRAM_BOT_TOKEN"),
    TELEGRAM_CHAT_ID: required("TELEGRAM_CHAT_ID"),

    // Run a single poll then exit (used by GitHub Actions / cron).
    // Otherwise the process loops on POLL_INTERVAL_MINUTES.
    POLL_ONCE:
        String(process.env.POLL_ONCE || "").toLowerCase() === "true",

    // How often to poll, in minutes (loop mode only).
    POLL_INTERVAL_MINUTES:
        Number(process.env.POLL_INTERVAL_MINUTES || 10),

    // Timezone label used for the human-readable timestamp.
    DISPLAY_TIMEZONE: process.env.DISPLAY_TIMEZONE || "Asia/Kolkata",

    // Notify on EVERY poll while a movie is open/available, instead of
    // only on the FALSE→TRUE transition. Also bypasses the per-row
    // notifyCount cap and autoDisable. Expect ~one message per poll
    // per open movie (e.g. every 10 min) until you disable the row.
    NOTIFY_EVERY_TIME:
        String(process.env.NOTIFY_EVERY_TIME || "").toLowerCase() === "true",

    // City segment used to build cinema (theatre-watch) URLs, e.g. "HYD".
    THEATRE_CITY: process.env.THEATRE_CITY || "HYD",

    // Send a generic "monitor alive" heartbeat at most this often, in
    // minutes (0 disables). Confirms the pipeline (sheet + BMS) is working
    // even when nothing has released. Throttled via HEARTBEAT_CELL.
    HEARTBEAT_EVERY_MINUTES:
        Number(process.env.HEARTBEAT_EVERY_MINUTES || 60),

    // Scratch cell holding the last heartbeat's ISO timestamp. Must be
    // OUTSIDE the watch-list range (A..Y) but INSIDE the sheet grid
    // (currently 28 cols, so AA/AB are safe; AD would exceed the grid).
    HEARTBEAT_CELL: process.env.HEARTBEAT_CELL || "AA1"

};
