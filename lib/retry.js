// ----------------------------------------------------
// Retry helper
// ----------------------------------------------------

async function retry(fn, retries = 3, delay = 1000) {

    let lastError;

    for (let attempt = 1; attempt <= retries; attempt++) {

        try {

            return await fn();

        } catch (err) {

            lastError = err;

            console.log(
                `Retry ${attempt}/${retries}`
            );

            if (attempt < retries) {

                await new Promise(resolve =>
                    setTimeout(resolve, delay)
                );

            }

        }

    }

    throw lastError;

}

module.exports = retry;
