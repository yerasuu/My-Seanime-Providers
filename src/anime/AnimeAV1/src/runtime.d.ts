/// <reference path="../../../core.d.ts" />

/**
 * What core.d.ts, Seanime's own declarations, leaves out.
 * The runtime supplies these; esbuild strips them while transpiling.
 */

// Key/value store the runtime shares across this extension's VMs.
declare const $store: {
    get<T = any>(key: string): T | undefined;
    set(key: string, value: any): void;
    has(key: string): boolean;
    remove(key: string): void;
} | undefined;
