/// <reference path="http.ts" />

const PACKER_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Every `eval(function(p,a,c,k,e,d){...}('payload',base,count,'words'.split('|')...))`
 * block in a page, unpacked. The site and its hosts (VidHide, StreamWish) ship
 * their player config this way; it is undone by substituting the word list into
 * the payload, never by running the page's own code.
 */
function unpackAll(html: string): string[] {
    const blocks = allMatches(/\}\('((?:[^'\\]|\\.)*)',(\d+),\d+,'((?:[^'\\]|\\.)*)'\.split\('\|'\)/, html);

    return blocks.map(([, payload, radix, words]) => {
        const base = parseInt(radix, 10);
        const table = words.split("|");

        return payload.replace(/\\'/g, "'").replace(/\\\\/g, "\\").replace(/\b\w+\b/g, token => {
            let index = 0;

            for (const digit of token) {
                const value = PACKER_DIGITS.indexOf(digit);
                if (value < 0 || value >= base) return token;
                index = index * base + value;
            }

            return table[index] || token;
        });
    });
}
