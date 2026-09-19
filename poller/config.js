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

    // Google Sheet holding the watch-list (columns A..X).
    SHEET_ID: required("SHEET_ID"),

    // Range to read each poll. Rows 2+ are watch-list entries.
    SHEET_RANGE: process.env.SHEET_RANGE || "A1:X50",

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
        String(process.env.NOTIFY_EVERY_TIME || "").toLowerCase() === "true"

};
