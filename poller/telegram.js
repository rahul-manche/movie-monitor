// Telegram sender. Uses the Bot API sendMessage endpoint.
// Node 22 has global fetch, so no extra dependency needed.

const config = require("./config");

async function sendMessage(text) {

    const url =
        `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/sendMessage`;

    const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: config.TELEGRAM_CHAT_ID,
            text,
            parse_mode: "HTML",
            disable_web_page_preview: false
        })
    });

    const data = await res.json();

    if (!data.ok) {
        throw new Error(
            `Telegram sendMessage failed: ${JSON.stringify(data)}`
        );
    }

    return data;
}

module.exports = { sendMessage };
