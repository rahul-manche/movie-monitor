// Movie Monitor poller.
//
// The self-contained orchestration that used to live in an
// external n8n flow (and, briefly, in a Claude cron):
//
//   read watch-list sheet
//     -> scrape each enabled movie
//        -> detect FALSE->TRUE transition
//           -> send Telegram
//        -> write state back to the sheet
//
// Runs on a timer inside a long-lived process (systemd keeps
// it alive). Reuses the existing Playwright scraper directly.

const config = require("./config");
const {
    readWatchlist, writeRowState, setEnabled, readCell, writeCell
} = require("./sheets");
const { sendMessage } = require("./telegram");
const { COL, isTrue, cell, computeRow } = require("./logic");
const { scrapeMovie, scrapeCinema } = require("../scraper");
const {
    parseCodes, parseDates, etCodeFromUrl,
    buildTheatreMessage, parseState, shouldNotifyCombo
} = require("./theatres");
const { closeBrowser } = require("../browser");

function log(...args) {
    console.log(new Date().toISOString(), ...args);
}

// Escape for Telegram HTML parse mode (heartbeat lines carry movie /
// theatre names that may contain & < >).
function esc(s) {
    return String(s || "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function processRow(rows, index) {

    // Sheet row number is 1-based; rows[0] is the header.
    const rowNumber = index + 1;
    const row = rows[index];

    const url = cell(row, COL.url);
    const wantedLanguage = cell(row, COL.wantedLanguage);
    const movie = cell(row, COL.movie) || url;

    let computed;

    try {
        const result = await scrapeMovie(url, wantedLanguage);
        computed = computeRow(row, result);
    } catch (err) {
        log(`  ! ${movie}: scrape error — ${err.message}`);
        computed = computeRow(row, null, { error: err.message });
    }

    // Persist state (L..W) first, so a Telegram failure never
    // costs us the scrape result.
    try {
        await writeRowState(rowNumber, computed.stateValues);
    } catch (err) {
        log(`  ! ${movie}: sheet write failed — ${err.message}`);
    }

    if (computed.notify && computed.message) {
        try {
            await sendMessage(computed.message);
            log(`  ✓ ${movie}: notified (${computed.reason})`);
        } catch (err) {
            log(`  ! ${movie}: telegram failed — ${err.message}`);
        }
    } else {
        log(`  · ${movie}: ${computed.reason}`);
    }

    if (computed.autoDisable) {
        try {
            await setEnabled(rowNumber, false);
            log(`  · ${movie}: auto-disabled (notify cap reached)`);
        } catch (err) {
            log(`  ! ${movie}: auto-disable failed — ${err.message}`);
        }
    }
}

/**
 * Theatre-watch: for a row with watchTheatres (W) + watchDates (X),
 * check each theatre×date on the cinema page for this row's movie
 * (matched by its ET code). On a hit, send one Telegram per theatre
 * with theatre name + show times + a direct booking link, throttled
 * per-(theatre,date) via the row's notifyEveryMinutes (V).
 *
 * `acc` accumulates per-check detail for the heartbeat.
 */
async function processTheatreWatch(rows, index, acc) {

    const rowNumber = index + 1;
    const row = rows[index];

    const codes = parseCodes(cell(row, COL.watchTheatres));
    const dates = parseDates(cell(row, COL.watchDates));
    if (!codes.length || !dates.length) return;

    const movie = cell(row, COL.movie) || cell(row, COL.url);

    const et = etCodeFromUrl(cell(row, COL.url));
    if (!et) {
        log(`  ! ${movie}: no ET code in url — skipping theatre-watch`);
        return;
    }

    const everyMin = Number(cell(row, COL.notifyEveryMinutes)) || 0;
    const state = parseState(cell(row, COL.theatreState));
    let changed = false;

    for (const code of codes) {
        for (const date of dates) {

            let res;
            try {
                res = await scrapeCinema(
                    config.THEATRE_CITY, code, date.ymd, et
                );
            } catch (err) {
                log(`  ! ${movie} @ ${code} ${date.display}: ${err.message}`);
                acc.checks.push({
                    movie, theatre: code, date: date.display, error: true
                });
                continue;
            }

            // A Cloudflare block means the check is inconclusive — record
            // it as blocked (NOT "not listed") so we don't falsely report
            // absence, and so a later poll re-checks it.
            if (res.blocked) {
                log(`  ! ${movie} @ ${code} ${date.display}: blocked, couldn't check`);
                acc.checks.push({
                    movie, theatre: code, date: date.display, blocked: true
                });
                continue;
            }

            // Record every check (theatre name resolved from the page,
            // even when the movie isn't listed) so the heartbeat can
            // show end-to-end that theatre fetching works.
            acc.checks.push({
                movie,
                theatre: res.theatreName,
                date: date.display,
                found: res.playing,
                times: res.times
            });

            if (!res.playing) {
                log(`  · ${movie} @ ${code} ${date.display}: not listed yet`);
                continue;
            }

            acc.found = true;
            const key = `${code}|${date.ymd}`;

            if (!shouldNotifyCombo(state, key, everyMin)) {
                log(`  · ${movie} @ ${code} ${date.display}: found, throttled`);
                continue;
            }

            const msg = buildTheatreMessage(
                movie, res.theatreName, date.display, res.times, res.url
            );
            try {
                await sendMessage(msg);
                state[key] = new Date().toISOString();
                changed = true;
                log(`  ✓ ${movie} @ ${res.theatreName} ${date.display}: notified`);
            } catch (err) {
                log(`  ! ${movie} @ ${code}: telegram failed — ${err.message}`);
            }
        }
    }

    if (changed) {
        try {
            await writeCell(`Y${rowNumber}`, JSON.stringify(state));
        } catch (err) {
            log(`  ! ${movie}: theatreState write failed — ${err.message}`);
        }
    }
}

/**
 * Send a generic "monitor alive" heartbeat, at most once per
 * HEARTBEAT_EVERY_MINUTES. The last-sent time lives in HEARTBEAT_CELL.
 */
async function maybeHeartbeat(acc) {

    const every = config.HEARTBEAT_EVERY_MINUTES;
    if (!every || every <= 0) return;

    let last;
    try {
        last = await readCell(config.HEARTBEAT_CELL);
    } catch (err) {
        log(`heartbeat read failed — ${err.message}`);
        return;
    }

    const lastMs = Date.parse(last);
    const elapsedMin = isNaN(lastMs) ? Infinity : (Date.now() - lastMs) / 60000;
    if (elapsedMin < every) return;

    const when = new Intl.DateTimeFormat("en-GB", {
        timeZone: config.DISPLAY_TIMEZONE,
        day: "2-digit", month: "short",
        hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date());

    const lines = [
        `✅ <b>Monitor alive</b> — ${when} IST`,
        `Read sheet ✓ · opened BMS ✓ · ${acc.movies} movie(s) checked.`
    ];

    // Per-check breakdown so you can see theatre fetching end-to-end:
    // "<movie> @ <resolved theatre name> — <date>: <status>".
    if (acc.checks.length) {
        lines.push("", "<b>Theatre checks:</b>");
        for (const c of acc.checks) {
            const head = `• ${esc(c.movie)} @ ${esc(c.theatre)} — ${esc(c.date)}: `;
            if (c.blocked) {
                lines.push(head + "🚧 blocked (couldn't check, will retry)");
            } else if (c.error) {
                lines.push(head + "⚠️ fetch error");
            } else if (c.found) {
                const t = c.times && c.times.length
                    ? ` (${c.times.map(esc).join(", ")})` : "";
                lines.push(head + `🎟️ OPEN${t}`);
            } else {
                lines.push(head + "not listed yet");
            }
        }
    }

    const blockedCount = acc.checks.filter(c => c.blocked).length;
    lines.push("", acc.found
        ? "🎟️ Something is OPEN — see the alert(s) above."
        : blockedCount
            ? `Nothing released yet (${blockedCount} check(s) blocked — will retry next poll).`
            : "Nothing released at your theatres yet.");

    const msg = lines.join("\n");

    try {
        await sendMessage(msg);
        await writeCell(config.HEARTBEAT_CELL, new Date().toISOString());
        log("  ✓ heartbeat sent");
    } catch (err) {
        log(`heartbeat send failed — ${err.message}`);
    }
}

async function pollOnce() {

    log("Poll start");

    let rows;
    try {
        rows = await readWatchlist();
    } catch (err) {
        log(`Sheet read failed — ${err.message}`);
        return;
    }

    const acc = { movies: 0, checks: [], found: false };

    // Process entries (skip header row 0) sequentially: they
    // share one Firefox instance.
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !cell(row, COL.url)) continue;
        if (!isTrue(cell(row, COL.enabled))) {
            log(`  · ${cell(row, COL.movie) || `row ${i + 1}`}: disabled, skipping`);
            continue;
        }
        acc.movies++;
        await processRow(rows, i);
        await processTheatreWatch(rows, i, acc);
    }

    await maybeHeartbeat(acc);

    log("Poll done");
}

let stopping = false;

async function main() {

    // Run-once mode (GitHub Actions / external cron): one poll, exit.
    if (config.POLL_ONCE) {
        log("Movie Monitor poller — single run (POLL_ONCE)");
        try {
            await pollOnce();
        } finally {
            try { await closeBrowser(); } catch (_) { /* ignore */ }
        }
        process.exit(0);
    }

    const intervalMs = config.POLL_INTERVAL_MINUTES * 60 * 1000;

    log(`Movie Monitor poller starting — every ${config.POLL_INTERVAL_MINUTES} min`);

    // Run immediately, then on the interval.
    await pollOnce();

    const timer = setInterval(async () => {
        if (stopping) return;
        try {
            await pollOnce();
        } catch (err) {
            log(`Unexpected poll error — ${err.message}`);
        }
    }, intervalMs);

    async function shutdown(signal) {
        log(`${signal} received — shutting down`);
        stopping = true;
        clearInterval(timer);
        try { await closeBrowser(); } catch (_) { /* ignore */ }
        process.exit(0);
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch(err => {
    log(`Fatal — ${err.message}`);
    process.exit(1);
});
