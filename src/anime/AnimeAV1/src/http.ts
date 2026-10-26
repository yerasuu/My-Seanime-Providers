/// <reference path="runtime.d.ts" />

/**
 * How long a request may have been going before retrying stops being worth it.
 * Comfortably above a refused connection, far below a hung one.
 */
const RETRY_BUDGET_MS = 8000;

const BROWSER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * What the site's own frontend sends when it fetches these endpoints. Measured
 * against sending nothing, the median response roughly halves. It does not stop
 * animeav1 dropping or hanging connections, which is a separate problem and the
 * one behind the long waits.
 */
const SITE_HEADERS: { [key: string]: string } = {
    "User-Agent": BROWSER_UA,
    "Accept": "*/*",
    "Accept-Language": "es-ES,es;q=0.9",
    "Referer": "https://animeav1.com/",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
};

const PLAIN_HEADERS: { [key: string]: string } = {
    "User-Agent": BROWSER_UA,
};

/**
 * The runtime exposes neither AbortController nor setTimeout, and `timeout`
 * does nothing because of the type mismatch noted above: every request runs
 * to the 35s default, so retries are worth keeping few.
 */
async function fetchWithRetry(
    url: string,
    retries: number = 2,
    headers: { [key: string]: string } = SITE_HEADERS
): Promise<FetchResponse> {
    const started = Date.now();
    let lastErr: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { timeout: 15, headers });

            // animeav1's 5xx responses are usually transient, so retry.
            if (res.status >= 500 && attempt < retries && Date.now() - started < RETRY_BUDGET_MS) {
                continue;
            }

            return res;
        } catch (err) {
            lastErr = err;

            /**
             * animeav1 refuses roughly one connection in six. A refusal
             * comes back in well under a second and the next attempt
             * usually lands, which is worth doing. A request that instead
             * hangs holds the line until fetch gives up on it 35s later,
             * and since the timeout option never takes effect there is no
             * way to cut that short - trying again just spends another 35s
             * on a host that is clearly not answering. One episode list
             * took Seanime 1m13s that way. Spent time tells the two apart.
             */
            if (Date.now() - started >= RETRY_BUDGET_MS) break;
        }
    }

    throw lastErr ?? new Error(`No se pudo conectar con ${url}`);
}
