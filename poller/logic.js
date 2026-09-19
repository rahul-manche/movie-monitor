// Pure-ish logic for the poller: column mapping, change
// detection, and message formatting. No I/O here except
// escaping — keeps this easy to reason about and test.

const config = require("./config");

// 0-based column indices for the A..Y schema.
const COL = {
    enabled: 0,            // A
    movie: 1,              // B
    city: 2,               // C
    url: 3,                // D
    wantedLanguage: 4,     // E
    notifyBookingOpen: 5,  // F
    notifyLanguage: 6,     // G
    notifyCount: 7,        // H
    autoDisable: 8,        // I
    bookingOpen: 9,        // J
    available: 10,         // K
    stateHash: 11,         // L
    event: 12,             // M
    runCount: 13,          // N
    notified: 14,          // O
    lastChecked: 15,       // P
    lastCheckedDisplay: 16, // Q
    lastChanged: 17,       // R
    lastNotification: 18,  // S
    lastMessage: 19,       // T
    lastError: 20,         // U
    notifyEveryMinutes: 21, // V  (input: min minutes between repeat alerts)
    watchTheatres: 22,     // W   (input: theatre codes/URLs to watch, comma-sep)
    watchDates: 23,        // X   (input: dates to watch, comma-sep)
    theatreState: 24       // Y   (state: JSON {"CODE|YYYYMMDD": lastNotifiedISO})
};

const isTrue = v => String(v || "").trim().toUpperCase() === "TRUE";
const cell = (row, i) => (row[i] !== undefined ? row[i] : "");

function displayTime(date) {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: config.DISPLAY_TIMEZONE,
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false
    }).format(date).replace(",", "");
}

function escapeHtml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Build the state hash the same way the previous cron did:
 *   open=<bool>|<language>=<bool>
 */
function stateHash(open, wantedLanguage, available) {
    const lang = (wantedLanguage || "").toLowerCase() || "lang";
    return `open=${open}|${lang}=${available}`;
}

/**
 * Decide whether this poll result should fire a notification,
 * given the previous row state and the row's notify settings.
 *
 * Returns { notify, reason }.
 */
function decideNotification(row, result) {

    const prevOpen = isTrue(cell(row, COL.bookingOpen));
    const prevAvail = isTrue(cell(row, COL.available));

    const notifyBookingOpen = isTrue(cell(row, COL.notifyBookingOpen));
    const notifyLanguage = isTrue(cell(row, COL.notifyLanguage));

    const cap = Number(cell(row, COL.notifyCount)) || 0;
    const notified = Number(cell(row, COL.notified)) || 0;

    const newOpen = !!result.booking.open;
    const newAvail = !!result.wantedLanguage.available;

    // What (if anything) is this row currently in a notifiable state for?
    // Language availability takes priority over plain booking-open.
    let reason = null;
    if (notifyLanguage && result.wantedLanguage.name && newOpen && newAvail) {
        reason = "language available";
    } else if (notifyBookingOpen && newOpen) {
        reason = "booking opened";
    }
    if (!reason) {
        return { notify: false, reason: "no transition" };
    }

    // Mode 1 — per-row interval (column Y): once the state is notifiable,
    // re-alert every N minutes. Ignores the cap/autoDisable. Great for a
    // heartbeat (e.g. 60) or aggressive watching (e.g. 5).
    const everyMin = Number(cell(row, COL.notifyEveryMinutes)) || 0;
    if (everyMin > 0) {
        const last = Date.parse(cell(row, COL.lastNotification));
        const elapsedMin = isNaN(last) ? Infinity : (Date.now() - last) / 60000;
        return elapsedMin >= everyMin
            ? { notify: true, reason }
            : { notify: false, reason: "interval not elapsed" };
    }

    // Mode 2 — global NOTIFY_EVERY_TIME: alert on every poll while notifiable.
    if (config.NOTIFY_EVERY_TIME) {
        return { notify: true, reason };
    }

    // Mode 3 — default: FALSE→TRUE transition only, honouring the cap.
    if (cap > 0 && notified >= cap) {
        return { notify: false, reason: "cap reached" };
    }
    if (reason === "language available") {
        return (prevOpen && prevAvail)
            ? { notify: false, reason: "no transition" }
            : { notify: true, reason };
    }
    // booking opened
    return prevOpen
        ? { notify: false, reason: "no transition" }
        : { notify: true, reason };
}

/**
 * Human-readable Telegram message for a fired notification.
 */
function buildMessage(row, result, reason) {

    const movie = cell(row, COL.movie) || result.movie.title;
    const city = cell(row, COL.city);
    const url = cell(row, COL.url);
    const lang = result.wantedLanguage.name;

    const lines = [];

    if (reason === "language available") {
        lines.push(`🎟️ <b>${escapeHtml(movie)}</b> — booking OPEN in <b>${escapeHtml(lang)}</b>!`);
    } else {
        lines.push(`🎟️ <b>${escapeHtml(movie)}</b> — booking is now OPEN!`);
    }

    if (city) {
        lines.push(`📍 ${escapeHtml(city)}`);
    }

    if (url) {
        lines.push(`🔗 <a href="${escapeHtml(url)}">Book now</a>`);
    }

    return lines.join("\n");
}

/**
 * Given the previous row and a fresh scrape result, compute the
 * new J..U state columns and whether/what to notify.
 *
 * Returns:
 *   {
 *     stateValues: [12 cells for J..U],
 *     notify, reason, message,
 *     hitCap, autoDisable   // for the enabled flag
 *   }
 */
function computeRow(row, result, { error = null } = {}) {

    const now = new Date();
    const wantedLanguage = cell(row, COL.wantedLanguage);

    const open = error ? false : !!result.booking.open;
    const available = error ? false : !!result.wantedLanguage.available;

    const newHash = stateHash(open, wantedLanguage, available);
    const prevHash = cell(row, COL.stateHash);
    const changed = newHash !== prevHash;

    const event = error
        ? "ERROR"
        : open
            ? "BOOKING_OPEN"
            : "BOOKING_NOT_OPEN";

    const { notify, reason } = error
        ? { notify: false, reason: "error" }
        : decideNotification(row, result);

    const message = notify ? buildMessage(row, result, reason) : null;

    const prevRunCount = Number(cell(row, COL.runCount)) || 0;
    const prevNotified = Number(cell(row, COL.notified)) || 0;
    const cap = Number(cell(row, COL.notifyCount)) || 0;

    const everyMin = Number(cell(row, COL.notifyEveryMinutes)) || 0;
    const notified = prevNotified + (notify ? 1 : 0);
    const hitCap = cap > 0 && notified >= cap;
    // Interval mode and global every-time both mean "keep alerting", so the
    // cap-based autoDisable must not kick in for those.
    const autoDisable =
        !config.NOTIFY_EVERY_TIME && everyMin <= 0 &&
        hitCap && isTrue(cell(row, COL.autoDisable));

    // Preserve prior values for cells we don't recompute this run.
    const lastChanged = changed
        ? now.toISOString()
        : cell(row, COL.lastChanged);

    const lastNotification = notify
        ? now.toISOString()
        : cell(row, COL.lastNotification);

    const lastMessage = error
        ? cell(row, COL.lastMessage)
        : (notify
            ? `Notified: ${reason}`
            : (open
                ? `Booking OPEN (${reason})`
                : "Booking not open"));

    // J..U in order.
    const stateValues = [
        open ? "TRUE" : "FALSE",                 // J bookingOpen
        available ? "TRUE" : "FALSE",            // K available
        newHash,                                 // L stateHash
        event,                                   // M event
        prevRunCount + 1,                        // N runCount
        notified,                                // O notified
        now.toISOString(),                       // P lastChecked
        displayTime(now),                        // Q lastCheckedDisplay
        lastChanged,                             // R lastChanged
        lastNotification,                        // S lastNotification
        lastMessage,                             // T lastMessage
        error ? error.slice(0, 300) : ""         // U lastError
    ];

    return {
        stateValues,
        notify,
        reason,
        message,
        autoDisable
    };
}

module.exports = {
    COL,
    isTrue,
    cell,
    computeRow,
    decideNotification,
    buildMessage,
    stateHash
};
