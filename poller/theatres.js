// Theatre-watch helpers: parse the per-row theatre/date config, build
// cinema URLs + messages, and throttle per-(theatre,date) notifications.
//
// Unlike the movie->showtimes API (Cloudflare-blocked), the cinema page
// (/cinemas/<CITY>/<slug>/buytickets/<CODE>/<YYYYMMDD>) is server-rendered
// and lists which movies play at that theatre on that date. BMS resolves
// the slug from the code, so a placeholder slug ("x") is fine.

const config = require("./config");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Pull a theatre code out of a bare code ("SMMR") or a pasted BMS URL
 * (".../buytickets/SMMR/20260921" or ".../cinemas/HYD/slug/SMMR").
 */
function extractCode(token) {
    token = String(token || "").trim();
    if (!token) return null;
    const m =
        token.match(/buytickets\/([A-Za-z0-9]{3,8})/) ||
        token.match(/\/([A-Za-z0-9]{3,8})\/\d{8}(?:[/?#]|$)/) ||
        token.match(/\/cinemas\/[^/]+\/[^/]+\/([A-Za-z0-9]{3,8})(?:[/?#]|$)/);
    if (m) return m[1].toUpperCase();
    if (/^[A-Za-z0-9]{3,8}$/.test(token)) return token.toUpperCase();
    return null;
}

/** Comma/newline-separated theatre codes or URLs -> unique code list. */
function parseCodes(cellVal) {
    return [...new Set(
        String(cellVal || "").split(/[,\n]/).map(extractCode).filter(Boolean)
    )];
}

/**
 * Parse one date in YYYY-MM-DD, YYYYMMDD, DD-MM-YYYY or DD/MM/YYYY.
 * Returns { ymd: "20260924", display: "24 Sep" } or null.
 */
function parseOneDate(s) {
    s = String(s || "").trim();
    let y, m, d, mt;
    if ((mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) { [, y, m, d] = mt; }
    else if ((mt = s.match(/^(\d{4})(\d{2})(\d{2})$/))) { [, y, m, d] = mt; }
    else if ((mt = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) { [, d, m, y] = mt; }
    else return null;
    m = String(m).padStart(2, "0");
    d = String(d).padStart(2, "0");
    const mi = Number(m) - 1;
    if (mi < 0 || mi > 11) return null;
    return { ymd: `${y}${m}${d}`, display: `${Number(d)} ${MONTHS[mi]}` };
}

/** Comma/newline-separated dates -> unique [{ ymd, display }]. */
function parseDates(cellVal) {
    const out = [];
    const seen = new Set();
    String(cellVal || "").split(/[,\n]/).forEach(tok => {
        const p = parseOneDate(tok);
        if (p && !seen.has(p.ymd)) { seen.add(p.ymd); out.push(p); }
    });
    return out;
}

/** Extract the ET movie code from a movie URL. */
function etCodeFromUrl(url) {
    return (String(url || "").match(/\/(ET\d+)/) || [])[1] || null;
}

/** Build the cinema showtimes URL (placeholder slug; BMS redirects). */
function cinemaUrl(city, code, ymd) {
    return `https://in.bookmyshow.com/cinemas/${city}/x/buytickets/${code}/${ymd}`;
}

function escapeHtml(s) {
    return String(s || "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Telegram message for a movie found at a specific theatre + date. */
function buildTheatreMessage(movie, theatreName, dateDisplay, times, url) {
    const lines = [
        `🎟️ <b>${escapeHtml(movie)}</b> — booking OPEN at <b>${escapeHtml(theatreName)}</b>!`,
        `📅 ${escapeHtml(dateDisplay)}`
    ];
    if (times && times.length) lines.push(`🕐 ${times.map(escapeHtml).join(" · ")}`);
    if (url) lines.push(`🔗 <a href="${escapeHtml(url)}">Book now</a>`);
    return lines.join("\n");
}

/** Parse the per-row theatreState JSON cell (combo -> last-notified ISO). */
function parseState(cellVal) {
    try {
        const o = JSON.parse(String(cellVal || "").trim() || "{}");
        return (o && typeof o === "object") ? o : {};
    } catch (_) {
        return {};
    }
}

/**
 * Should we notify for this (theatre|date) combo now?
 *  - never notified  -> yes
 *  - everyMin > 0     -> yes if that many minutes elapsed since last
 *  - everyMin <= 0    -> no (notify once per combo)
 */
function shouldNotifyCombo(state, key, everyMin) {
    const last = Date.parse(state[key]);
    if (isNaN(last)) return true;
    if (everyMin > 0) return (Date.now() - last) / 60000 >= everyMin;
    return false;
}

module.exports = {
    extractCode,
    parseCodes,
    parseOneDate,
    parseDates,
    etCodeFromUrl,
    cinemaUrl,
    buildTheatreMessage,
    parseState,
    shouldNotifyCombo
};
