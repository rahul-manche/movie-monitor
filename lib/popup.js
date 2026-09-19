const logger = require("./logger");

// ----------------------------------------------------
// Dismiss 18+ popup if present
// ----------------------------------------------------

async function dismissAgePopup(page) {

    const continueButton =
        page.getByRole("button", {
            name: /Continue/i
        });

    if (await continueButton.count() > 0) {

        logger.info(
            "18+ popup detected"
        );

        await continueButton.click();

        await page.waitForTimeout(1000);

        return true;

    }

    return false;

}

module.exports = {
    dismissAgePopup
};
