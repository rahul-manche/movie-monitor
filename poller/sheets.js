// Google Sheets read/write using a service-account key.
//
// Replaces the MCP / n8n layer that used to talk to the sheet.
// The service account authenticates headlessly (no OAuth
// browser dance), which is exactly what a server needs.

const { google } = require("googleapis");
const config = require("./config");

let sheetsClient = null;

async function getClient() {

    if (sheetsClient) {
        return sheetsClient;
    }

    const scopes = ["https://www.googleapis.com/auth/spreadsheets"];

    // Inline JSON (CI secret) takes precedence over a key file.
    const auth = config.GOOGLE_CREDENTIALS_JSON
        ? new google.auth.GoogleAuth({
            credentials: JSON.parse(config.GOOGLE_CREDENTIALS_JSON),
            scopes
        })
        : new google.auth.GoogleAuth({
            keyFile: config.GOOGLE_KEY_FILE,
            scopes
        });

    const authClient = await auth.getClient();

    sheetsClient = google.sheets({
        version: "v4",
        auth: authClient
    });

    return sheetsClient;
}

/**
 * Read the whole watch-list range as a 2D array of strings.
 * Row 0 is the header; rows 1+ are entries.
 */
async function readWatchlist() {

    const sheets = await getClient();

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: config.SHEET_ID,
        range: config.SHEET_RANGE
    });

    return res.data.values || [];
}

/**
 * Write the computed state columns L..W for a single row.
 * `values` is a 12-element array matching L,M,N,O,P,Q,R,S,T,U,V,W.
 * rowNumber is 1-based (sheet row, e.g. 2 for the first entry).
 */
async function writeRowState(rowNumber, values) {

    const sheets = await getClient();

    await sheets.spreadsheets.values.update({
        spreadsheetId: config.SHEET_ID,
        range: `L${rowNumber}:W${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: {
            values: [values]
        }
    });
}

/**
 * Flip the `enabled` flag (column A) for a row.
 * Used by autoDisable after the notify cap is reached.
 */
async function setEnabled(rowNumber, enabled) {

    const sheets = await getClient();

    await sheets.spreadsheets.values.update({
        spreadsheetId: config.SHEET_ID,
        range: `A${rowNumber}`,
        valueInputOption: "RAW",
        requestBody: {
            values: [[enabled ? "TRUE" : "FALSE"]]
        }
    });
}

module.exports = {
    readWatchlist,
    writeRowState,
    setEnabled
};
