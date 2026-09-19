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

module.exports = {
    scrapeMovie
};
