/**
 * Seanime's onlinestream provider contract.
 * The runtime supplies these; esbuild strips them while transpiling.
 */

declare interface FetchOptions {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    noCloudflareBypass?: boolean;
    redirect?: "follow" | "manual" | "error";
    // Timeout in seconds. Defaults to 35.
    timeout?: number;
}

declare interface FetchResponse {
    status: number;
    statusText: string;
    ok: boolean;
    url: string;
    headers: Record<string, string>;

    text(): string;

    json<T = any>(): T;
}

declare function fetch(url: string, options?: FetchOptions): Promise<FetchResponse>;

// Key/value store the runtime shares across this extension's VMs.
declare const $store: {
    get<T = any>(key: string): T | undefined;
    set(key: string, value: any): void;
    has(key: string): boolean;
    remove(key: string): void;
} | undefined;

// Bytes as the runtime's CryptoJS hands them out; only its own functions read them.
declare interface CryptoBytes {
    readonly __cryptoBytes: never;
}

declare interface CryptoEncoder {
    // Yields null when the input is not valid for this encoding.
    parse(input: string): CryptoBytes;
    stringify(input: CryptoBytes): string;
}

/**
 * Seanime's Go-backed stand-in for crypto-js, not the library itself. AES is
 * CBC with PKCS#7 and nothing else, ciphertext goes in as standard base64, and
 * keys and IVs must be bytes from one of the `enc` parsers.
 */
declare const CryptoJS: {
    AES: {
        encrypt(message: string, key: CryptoBytes, cfg: { iv: CryptoBytes }): { toString(encoder: CryptoEncoder): string };
        decrypt(base64: string, key: CryptoBytes, cfg: { iv: CryptoBytes }): { toString(encoder: CryptoEncoder): string };
    };
    enc: {
        Utf8: CryptoEncoder;
        Base64: CryptoEncoder;
        Hex: CryptoEncoder;
        Latin1: CryptoEncoder;
    };
};
