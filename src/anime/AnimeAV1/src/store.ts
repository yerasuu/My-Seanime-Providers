/// <reference path="runtime.d.ts" />

/**
 * Long enough to cover building one episode list, short enough that a catalog
 * that just added an entry is not hidden for long.
 */
const SEARCH_CACHE_MS = 5 * 60 * 1000;

// Reads a value stored less than `maxAge` ago, if the store is there.
function remember<T>(key: string, maxAge: number = SEARCH_CACHE_MS): T | undefined {
    if (typeof $store === "undefined" || !$store) return undefined;

    try {
        // Compare against undefined: a cached false is still an answer.
        const hit = $store.get<{ at: number; value: T }>(key);
        if (hit && hit.value !== undefined && Date.now() - hit.at < maxAge) return hit.value;
    } catch (err) {
        // A store that misbehaves must not take the search down with it.
    }

    return undefined;
}

function keep(key: string, value: any): void {
    if (typeof $store === "undefined" || !$store) return;

    try {
        $store.set(key, { at: Date.now(), value });
    } catch (err) {
        // Not being able to cache is not a reason to fail.
    }
}
