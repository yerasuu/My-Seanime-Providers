/// <reference path="runtime.d.ts" />

// Pulled from AnimeAV1: the runtime's store outlives a call and is shared across VMs.
const RESOLVED_MS = 20 * 60 * 1000;

function remember<T>(key: string, maxAge: number): T | undefined {
    if (typeof $store === "undefined" || !$store) return undefined;

    try {
        const hit = $store.get<{ at: number; value: T }>(key);
        if (hit && Date.now() - hit.at < maxAge) return hit.value;
    } catch (err) {
        // A misbehaving store must not take playback down with it.
    }

    return undefined;
}

function keep(key: string, value: unknown): void {
    if (typeof $store === "undefined" || !$store) return;

    try {
        $store.set(key, { at: Date.now(), value });
    } catch (err) {
        // Not being able to cache is not a reason to fail.
    }
}
