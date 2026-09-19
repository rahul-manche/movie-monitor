// Pure-ish logic for the poller: column mapping, change
// detection, and message formatting. No I/O here except
// escaping — keeps this easy to reason about and test.

const config = require("./config");

// 0-based column indices for the A..X schema.
const COL = {
    enabled: 0,           // A
    movie: 1,             // B
    city: 2,              // C
    url: 3,               // D
    wantedLanguage: 4,    // E
    notifyBookingOpen: 5, // F
    notifyLanguage: 6,    // G
    notifyCount: 7,       // H
    autoDisable: 8,       // I
    priority: 9,          // J
    remarks: 10,          // K
    bookingOpen: 11,      // L
    available: 12,        // M
    stateHash: 13,        // N
    event: 14,            // O
    runCount: 15,         // P
    notified: 16,         // Q
    lastChecked: 17,      // R
    lastCheckedDisplay: 18, // S
    lastChanged: 19,      // T
    lastNotification: 20, // U
    lastMessage: 21,      // V
    lastError: 22,        // W
    wantedTheatres: 23    // X
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

    // Respect the per-row notify cap.
    if (cap > 0 && notified >= cap) {
        return { notify: false, reason: "cap reached" };
    }

    // Language-availability transition takes priority when watched.
    if (notifyLanguage && result.wantedLanguage.name) {
        const was = prevOpen && prevAvail;
        const now = newOpen && newAvail;
        if (now && !was) {
            return {
                notify: true,
                reason: "language available"
            };
        }
    }

    // Booking-open transition.
    if (notifyBookingOpen && newOpen && !prevOpen) {
        return { notify: true, reason: "booking opened" };
    }

    return { notify: false, reason: "no transition" };
}

/**
 * Human-readable Telegram message for a fired notification.
 */
function buildMessage(row, result, reason) {

    const movie = cell(row, COL.movie) || result.movie.title;
    const city = cell(row, COL.city);
    const url = cell(row, COL.url);
    const theatres = cell(row, COL.wantedTheatres);
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

    if (theatres) {
        lines.push(`🎦 Your theatres to check: ${escapeHtml(theatres)}`);
    }

    if (url) {
        lines.push(`🔗 <a href="${escapeHtml(url)}">Book now</a>`);
    }

    return lines.join("\n");
}

/**
 * Given the previous row and a fresh scrape result, compute the
 * new L..W state columns and whether/what to notify.
 *
 * Returns:
 *   {
 *     stateValues: [12 cells for L..W],
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

    const notified = prevNotified + (notify ? 1 : 0);
    const hitCap = cap > 0 && notified >= cap;
    const autoDisable = hitCap && isTrue(cell(row, COL.autoDisable));

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

    // L..W in order.
    const stateValues = [
        open ? "TRUE" : "FALSE",                 // L bookingOpen
        available ? "TRUE" : "FALSE",            // M available
        newHash,                                 // N stateHash
        event,                                   // O event
        prevRunCount + 1,                        // P runCount
        notified,                                // Q notified
        now.toISOString(),                       // R lastChecked
        displayTime(now),                        // S lastCheckedDisplay
        lastChanged,                             // T lastChanged
        lastNotification,                        // U lastNotification
        lastMessage,                             // V lastMessage
        error ? error.slice(0, 300) : ""         // W lastError
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
