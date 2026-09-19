const express = require("express");
const { scrapeMovie } = require("./scraper");
const { closeBrowser } = require("./browser");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.json({
        service: "Movie Monitor",
        status: "Running"
    });
});

app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "Healthy",
        timestamp: new Date().toISOString()
    });
});

app.post("/check", async (req, res) => {

    try {

        const {
            url,
            wantedLanguage
        } = req.body;

        if (!url) {
            return res.status(400).json({
                success: false,
                error: "url is required"
            });
        }

try {

    const result =
        await scrapeMovie(url, wantedLanguage);

    res.json(result);

} catch (err) {

    res.json({

        success: false,

        error: err.message,

        booking: {

            open: false

        },

        wantedLanguage: {

            available: false

        }

    });

}


    } catch (err) {

        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });

    }

});


// Graceful shutdown

async function shutdown(signal) {

    console.log(`${signal} received`);

    try {

        await closeBrowser();

    } catch (err) {

        console.error(err);

    }

    process.exit(0);

}

process.on("SIGINT", () => shutdown("SIGINT"));

process.on("SIGTERM", () => shutdown("SIGTERM"));



app.listen(PORT, () => {

    console.log(`====================================`);
    console.log(`Movie Monitor running`);
    console.log(`http://localhost:${PORT}`);
    console.log(`====================================`);

});
