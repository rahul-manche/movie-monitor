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
const { readWatchlist, writeRowState, setEnabled } = require("./sheets");
const { sendMessage } = require("./telegram");
const { COL, isTrue, cell, computeRow } = require("./logic");
const { scrapeMovie } = require("../scraper");
const { closeBrowser } = require("../browser");

function log(...args) {
    console.log(new Date().toISOString(), ...args);
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

async function pollOnce() {

    log("Poll start");

    let rows;
    try {
        rows = await readWatchlist();
    } catch (err) {
        log(`Sheet read failed — ${err.message}`);
        return;
    }

    // Process entries (skip header row 0) sequentially: they
    // share one Firefox instance.
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !cell(row, COL.url)) continue;
        if (!isTrue(cell(row, COL.enabled))) {
            log(`  · ${cell(row, COL.movie) || `row ${i + 1}`}: disabled, skipping`);
            continue;
        }
        await processRow(rows, i);
    }

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
