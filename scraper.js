const {
    getBrowser,
    restartBrowser
} = require("./browser");

const retry = require("./lib/retry");
const logger = require("./lib/logger");

const {
    openBookingFlow
} = require("./lib/navigation");

const {
    parseLanguages
} = require("./lib/parser");

/**
 * Scrape a BookMyShow movie page.
 */
async function scrapeMovie(url, wantedLanguage = "") {

    const browser = await getBrowser();

    const page = await browser.newPage({

        viewport: {
            width: 1366,
            height: 900
        }

    });

    page.setDefaultTimeout(15000);

    try {

        //----------------------------------------------------
        // Open movie page (with retry)
        //----------------------------------------------------

        logger.info(`Opening ${url}`);

        await retry(async () => {

            await page.goto(url, {

                waitUntil: "domcontentloaded",
                timeout: 60000

            });

        });

        await page.waitForTimeout(2000);

        //----------------------------------------------------
        // Basic movie info
        //----------------------------------------------------

        const movie =
            await page.locator("h1").innerText();

        const movieId =
            url.match(/\/(ET\d+)/)?.[1] || null;

        const city =
            url.split("/")[4] || null;

        //----------------------------------------------------
        // Open booking flow
        //----------------------------------------------------

        const flow =
            await openBookingFlow(page);

        //----------------------------------------------------
        // Booking not open
        //----------------------------------------------------

        if (flow.type === "BOOKING_NOT_OPEN") {

            logger.info(
                `${movie} : Booking not open`
            );

            return {

                success: true,

                movie: {
                    title: movie,
                    movieId,
                    city,
                    url
                },

                booking: {
                    open: false,
                    checkedAt: new Date().toISOString()
                },

                languages: [],

                wantedLanguage: {
                    name: wantedLanguage,
                    available: false
                }

            };

        }

        //----------------------------------------------------
        // Unknown flow
        //----------------------------------------------------

        if (flow.type === "UNKNOWN") {

            throw new Error(
                "Unknown booking flow."
            );

        }

        //----------------------------------------------------
        // Error dialog
        //----------------------------------------------------

        if (flow.type === "ERROR_DIALOG") {

            throw new Error(
                "BookMyShow displayed an error dialog."
            );

        }

        //----------------------------------------------------
        // Cinema page flow
        //
        // BookMyShow sent us straight to the buytickets /
        // cinema-listing page. That means booking IS open.
        // We cannot enumerate every language here (the
        // showtimes API is Cloudflare-blocked and the DOM
        // parser is a stub), but the buytickets URL usually
        // carries a ?language= param we can trust.
        //----------------------------------------------------

        if (flow.type === "BOOKING_CINEMA_PAGE") {

            const currentUrl = page.url();

            const urlLang =
                currentUrl.match(/[?&]language=([^&]+)/i)?.[1];

            const urlLangName =
                urlLang ? decodeURIComponent(urlLang) : null;

            // If we can read a language from the URL, compare it.
            // If not, we can't tell — assume available so the
            // user still gets nudged to check.
            const available =
                !wantedLanguage
                    ? true
                    : urlLangName
                        ? urlLangName.toLowerCase() ===
                          wantedLanguage.toLowerCase()
                        : true;

            logger.info(
                `${movie} : Booking open (cinema page` +
                (urlLangName ? `, language=${urlLangName}` : "") +
                `)`
            );

            return {

                success: true,

                movie: {
                    title: movie,
                    movieId,
                    city,
                    url
                },

                booking: {
                    open: true,
                    flow: "CINEMA_PAGE",
                    checkedAt: new Date().toISOString()
                },

                languages: urlLangName
                    ? [{ language: urlLangName, formats: [] }]
                    : [],

                wantedLanguage: {
                    name: wantedLanguage,
                    available
                }

            };

        }

        //----------------------------------------------------
        // Language popup parser
        //----------------------------------------------------

        logger.info(
            "Parsing language popup"
        );

        const languages =
            await parseLanguages(page);

        const available =
            languages.some(
                item =>
                    item.language.toLowerCase() ===
                    wantedLanguage.toLowerCase()
            );

        //----------------------------------------------------
        // Final response
        //----------------------------------------------------

        return {

            success: true,

            movie: {
                title: movie,
                movieId,
                city,
                url
            },

            booking: {
                open: true,
                checkedAt: new Date().toISOString()
            },

            languages,

            wantedLanguage: {
                name: wantedLanguage,
                available
            }

        };

    }
    catch (err) {

        logger.error(err.message);

// Firefox crashed
    if (
        err.message.includes("Target page") ||
        err.message.includes("Browser has been closed") ||
        err.message.includes("Connection closed") ||
        err.message.includes("NS_ERROR")
    ) {

        logger.warn(
            "Restarting Firefox..."
        );

        await restartBrowser();

    }


        throw err;

    }
    finally {

        try {

            await page.close();

        }
        catch (e) {

            logger.warn(
                "Unable to close page."
            );

        }

    }

}

/**
 * Scrape a BookMyShow CINEMA page to see whether a specific movie
 * (identified by its ET code) is playing at that theatre on a date,
 * and if so, at what show times.
 *
 * The cinema page is server-rendered and NOT Cloudflare-blocked (unlike
 * the movie->showtimes API). Scheduled movies are linked with a
 * REGION-PREFIXED path (/movies/HYD/<slug>/ET...) and carry time pills;
 * sidebar "now showing" recommendations are not region-prefixed and have
 * no times — so we anchor on a region-prefixed ET link WITH show times.
 *
 * Returns:
 *   { url, theatreName, playing: bool, times: [ "11:00 AM", ... ] }
 */
async function scrapeCinema(city, code, dateYmd, targetEt) {

    const browser = await getBrowser();

    const page = await browser.newPage({
        viewport: { width: 1366, height: 900 }
    });

    page.setDefaultTimeout(15000);

    // Placeholder slug ("x"); BMS resolves the real one from the code.
    const url =
        `https://in.bookmyshow.com/cinemas/${city}/x/buytickets/` +
        `${code}/${dateYmd}`;

    try {

        logger.info(`Cinema ${code} ${dateYmd}: ${url}`);

        await retry(async () => {
            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 60000
            });
        });

        await page.waitForTimeout(2500);

        const finalUrl = page.url();

        // The resolved URL slug is the theatre, e.g.
        // /cinemas/HYD/sandhya-70mm-4k-dolby-atmos-rtc-x-roads/buytickets/...
        // Prettify it; fall back to the page H1, then the raw code.
        let theatreName = code;
        const slug = finalUrl.match(/\/cinemas\/[^/]+\/([^/]+)\/buytickets\//)?.[1];
        if (slug && slug !== "x") {
            theatreName = slug
                .split("-")
                .map(w => w ? w[0].toUpperCase() + w.slice(1) : w)
                .join(" ");
        } else {
            try {
                const h1 = (await page.locator("h1").first().innerText()).trim();
                if (h1) theatreName = h1;
            }
            catch (_) { /* fall back to the code */ }
        }

        const info = await page.evaluate((ET) => {

            // Scheduled movies use a region-prefixed link like
            // /movies/HYD/<slug>/ET... (uppercase region segment).
            const anchors = [...document.querySelectorAll("a[href]")]
                .filter(a => {
                    const h = a.getAttribute("href") || "";
                    const m = h.match(/^\/movies\/([A-Za-z]{2,})\/[^/]+\/(ET\d+)/);
                    return m && m[1] === m[1].toUpperCase() && m[2] === ET;
                });

            if (!anchors.length) return { playing: false, times: [] };

            // Walk up to the movie's row/card and collect its time pills.
            let node = anchors[0];
            for (let i = 0; i < 6 && node.parentElement; i++) {
                node = node.parentElement;
            }

            const times = [...node.querySelectorAll("a,div,span,button")]
                .map(e => (e.textContent || "").trim())
                .filter(t => /^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(t));

            // A real schedule block has time pills; a bare link (rare
            // region-prefixed rec) does not, so require at least one.
            return { playing: times.length > 0, times: [...new Set(times)] };

        }, targetEt);

        if (info.playing) {
            logger.info(
                `Cinema ${code} ${dateYmd}: ${targetEt} playing ` +
                `(${info.times.join(", ")})`
            );
        }
        else {
            logger.info(`Cinema ${code} ${dateYmd}: ${targetEt} not listed`);
        }

        return {
            url: finalUrl,
            theatreName,
            playing: info.playing,
            times: info.times || []
        };

    }
    catch (err) {

        logger.error(`Cinema ${code} ${dateYmd} failed: ${err.message}`);

        if (
            err.message.includes("Target page") ||
            err.message.includes("Browser has been closed") ||
            err.message.includes("Connection closed") ||
            err.message.includes("NS_ERROR")
        ) {
            logger.warn("Restarting Firefox...");
            await restartBrowser();
        }

        throw err;

    }
    finally {
        try { await page.close(); }
        catch (_) { logger.warn("Unable to close cinema page."); }
    }

}

module.exports = {
    scrapeMovie,
    scrapeCinema
};
