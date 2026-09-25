/// <reference path="runtime.d.ts" />

// The one block AES.encrypt produces for an empty message: PKCS#7 padding.
const PAD_BLOCK_HEX = "10101010101010101010101010101010";

/**
 * AES-GCM decryption without the tag check. The runtime's AES is CBC only,
 * but GCM's ciphertext is plain CTR, and CBC over a single block is one raw
 * block encryption with the IV folded in. The tag goes unchecked: a wrong
 * key still shows up as JSON that will not parse.
 */
function decryptAesGcm(keyHex: string, ivHex: string, dataHex: string): string {
    /**
     * GCM only counts from IV || 1 when the IV is 96 bits; any other
     * length derives the counter through GHASH, which this does not do.
     */
    if (ivHex.length !== 24 || dataHex.length <= 32) return "";

    const key = CryptoJS.enc.Hex.parse(keyHex);
    const body = dataHex.slice(0, -32);
    let plain = "";

    for (let block = 0; block * 32 < body.length; block++) {
        // Counter IV || 1 is spent on the tag, so the payload starts at 2.
        const counter = ivHex + ("0000000" + (block + 2).toString(16)).slice(-8);

        /**
         * An empty message encrypts to its padding block alone, so an IV
         * of counter ^ padding makes that block E(counter).
         */
        const keystream = CryptoJS.AES.encrypt("", key, {
            iv: CryptoJS.enc.Hex.parse(xorHex(counter, PAD_BLOCK_HEX)),
        }).toString(CryptoJS.enc.Hex);

        plain += xorHex(body.slice(block * 32, block * 32 + 32), keystream);
    }

    return CryptoJS.enc.Utf8.stringify(CryptoJS.enc.Hex.parse(plain));
}

// XORs `a` against the start of `b`, keeping `a`'s length.
function xorHex(a: string, b: string): string {
    let out = "";

    for (let i = 0; i < a.length; i += 2) {
        const byte = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
        out += (byte < 16 ? "0" : "") + byte.toString(16);
    }

    return out;
}

function base64ToHex(value: string): string {
    return CryptoJS.enc.Hex.stringify(CryptoJS.enc.Base64.parse(padBase64(value)));
}

// Standard, padded base64, the only kind the runtime's decoder accepts.
function padBase64(value: string): string {
    const std = value.replace(/-/g, "+").replace(/_/g, "/");
    return std + "===".slice((std.length + 3) % 4);
}
