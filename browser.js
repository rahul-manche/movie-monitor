const { firefox } = require("playwright");

let browser = null;
let launching = null;

/**
 * Launch a fresh Firefox browser.
 */
async function launchBrowser() {

    console.log("Launching Firefox...");

    browser = await firefox.launch({

        headless: true

    });

    browser.on("disconnected", () => {

        console.log("Firefox disconnected.");

        browser = null;

    });

    console.log("Firefox ready.");

    return browser;

}

/**
 * Get a browser instance.
 * If none exists, launch one.
 */
async function getBrowser() {

    // Browser already alive
    if (browser && browser.isConnected()) {

        return browser;

    }

    // Someone else is already launching it
    if (launching) {

        return launching;

    }

    launching = launchBrowser();

    try {

        browser = await launching;

        return browser;

    } finally {

        launching = null;

    }

}

/**
 * Force browser recreation.
 */
async function restartBrowser() {

    console.log("Restarting Firefox...");

    try {

        if (browser) {

            await browser.close();

        }

    } catch (err) {

        console.log("Ignoring browser close error.");

    }

    browser = null;

    return getBrowser();

}

/**
 * Gracefully close.
 */
async function closeBrowser() {

    if (!browser) {

        return;

    }

    try {

        await browser.close();

    } catch {

    }

    browser = null;

}

module.exports = {

    getBrowser,
    restartBrowser,
    closeBrowser

};
