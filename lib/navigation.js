const logger = require("./logger");
const { dismissAgePopup } = require("./popup");

/**
 * Opens the booking flow.
 *
 * Returns:
 * LANGUAGE_POPUP
 * BOOKING_CINEMA_PAGE
 * BOOKING_NOT_OPEN
 * UNKNOWN
 */
async function openBookingFlow(page) {

    //---------------------------------------------------
    // Book Tickets button available?
    //---------------------------------------------------

    const bookingButton =
        page.getByRole("button", {
            name: /Book tickets/i
        });

    if (await bookingButton.count() === 0) {

        logger.info("Booking button not found");

        return {
            type: "BOOKING_NOT_OPEN"
        };
    }

    //---------------------------------------------------
    // Click Book Tickets
    //---------------------------------------------------

    logger.info("Clicking Book Tickets");

    await bookingButton.click();

    //---------------------------------------------------
    // Sometimes 18+ popup appears
    //---------------------------------------------------

    await dismissAgePopup(page);

    //---------------------------------------------------
    // Wait for one of the possible outcomes
    //---------------------------------------------------

    const result = await Promise.race([

        page.waitForSelector("h5", {
            timeout: 15000
        }).then(() => "LANGUAGE_POPUP"),

        page.waitForURL(/buytickets/i, {
            timeout: 15000
        }).then(() => "BOOKING_CINEMA_PAGE"),

        page.waitForSelector("[role='alertdialog']", {
            timeout: 15000
        }).then(() => "ERROR_DIALOG")

    ]).catch(() => "UNKNOWN");

    logger.info(`Detected page: ${result}`);

    return {
        type: result
    };

}

module.exports = {
    openBookingFlow
};
