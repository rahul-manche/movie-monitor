/**
 * Reads all languages and formats
 */
async function parseLanguages(page) {

    return await page.$$eval(
        "ul > li",
        rows => rows.map(row => {

            const sections =
                row.querySelectorAll("section");

            const language =
                sections[0]
                    ?.querySelector("span")
                    ?.textContent
                    ?.trim();

            const formats =
                Array.from(
                    sections[1]
                        ?.querySelectorAll("span") || []
                ).map(span => span.textContent.trim());

            return {
                language,
                formats
            };

        }).filter(item => item.language)
    );

}

module.exports = {
    parseLanguages
};
