// Ambient types for the Seanime plugin runtime globals used in main.ts.
// Dev-time only — Seanime injects these at runtime, this file is never fetched/served.

interface FieldRef<T> {
    current: T | undefined;
    setValue(value: T): void;
}

interface StateHandle<T> {
    /** Valor actual. */
    value: T;
    get(): T;
    set(value: T | ((prev: T) => T)): void;
}

interface TrayHandle {
    render(fn: () => any): void;
    onOpen(fn: () => void): void;
    onClose(fn: () => void): void;
    onClick(fn: () => void): void;
    open(): void;
    close(): void;
    update(): void;
    updateBadge(opts: { number: number; intent?: string }): void;
    text(...args: any[]): any;
    span(...args: any[]): any;
    p(...args: any[]): any;
    anchor(...args: any[]): any;
    a(...args: any[]): any;
    img(...args: any[]): any;
    div(children: any[], opts?: any): any;
    stack(children: any[], opts?: any): any;
    flex(children: any[], opts?: any): any;
    input(label: string, opts: any): any;
    button(labelOrOpts: any, opts?: any): any;
    select(label: string, opts: any): any;
    radioGroup(label: string, opts: any): any;
    checkbox(label: string, opts: any): any;
    switch(label: string, opts: any): any;
    badge(...args: any[]): any;
    alert(...args: any[]): any;
    css(...args: any[]): any;
    tabs(...args: any[]): any;
    tabsList(...args: any[]): any;
    tabsTrigger(...args: any[]): any;
    tabsContent(...args: any[]): any;
    modal(...args: any[]): any;
    dropdownMenu(...args: any[]): any;
    dropdownMenuItem(...args: any[]): any;
    tooltip(...args: any[]): any;
}

interface FetchResponse {
    ok: boolean;
    status: number;
    statusText: string;
    url: string;
    headers: Record<string, string>;
    /** Síncrono: el runtime ya leyó el body entero. */
    json<T = any>(): T;
    /** Síncrono. */
    text(): string;
}

interface PluginContext {
    newTray(opts: { tooltipText?: string; iconUrl?: string; withContent?: boolean; isDrawer?: boolean }): TrayHandle;
    state<T>(initial: T): StateHandle<T>;
    fieldRef<T>(initial?: T): FieldRef<T>;
    fetch(url: string, opts?: any): Promise<FetchResponse>;
    toast: {
        info(msg: string): void;
        alert(msg: string): void;
        warning(msg: string): void;
        success(msg: string): void;
    };
    extensions: {
        enable(id: string): Promise<boolean>;
        disable(id: string): Promise<boolean>;
        setDisabled(id: string, disabled: boolean): Promise<boolean>;
    };
    /** Devuelve la función para desregistrar el handler. */
    registerEventHandler(eventName: string, fn: (event: any) => void): () => void;
    eventHandler(uniqueKey: string, fn: (event: any) => void): string;
    /** Devuelve la función para cancelar el intervalo. */
    setInterval(fn: () => void, delay: number): () => void;
    setTimeout(fn: () => void, delay: number): () => void;
    dom?: DomApi;
}

interface DomElement {
    getText?(): string;
    getAttribute?(name: string): string | undefined;
    getAttributes?(): Record<string, string>;
    setAttribute?(name: string, value: string): void;
    addEventListener?(event: string, callback: (event?: any) => void): () => void;
    [key: string]: any;
}

interface DomApi {
    query(selector: string, options?: any): Promise<DomElement[]>;
    queryOne(selector: string, options?: any): Promise<DomElement | null>;
    observe(selector: string, callback: (...args: any[]) => void, options?: any): void;
    onReady(fn: () => void): void;
    onMainTabReady?(fn: () => void): void;
}

declare const $ui: {
    register(fn: (ctx: PluginContext) => void): void;
};

declare const $storage: {
    get<T = any>(key: string): T | undefined;
    getUnsafe<T = any>(key: string): T | undefined;
    set(key: string, value: any): void;
    has(key: string): boolean;
    keys(): string[];
    remove(key: string): void;
    clear(): void;
    drop(): void;
};
