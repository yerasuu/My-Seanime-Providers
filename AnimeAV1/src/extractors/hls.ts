/// <reference path="../http.ts" />

/**
 * Cloudflare turns away player segments (/segs/) that do not look like they
 * came from the player itself: without Sec-Fetch-Site it answers 403, playback
 * stalls and Seanime refetches the source in a loop. Seanime's proxy replays
 * these headers on every segment, not just on the playlist.
 */
const HLS_HEADERS: { [key: string]: string } = {
    "Referer": "https://player.zilla-networks.com/",
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "User-Agent": BROWSER_UA,
};
