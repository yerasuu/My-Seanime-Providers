interface MarketplaceSource {
    id: string;
    name: string;
    url: string;
}

interface CatalogEntry {
    id: string;
    name: string;
    description?: string;
    author?: string;
    type?: string;
    language?: string;
    lang?: string;
    icon?: string;
    manifestURI?: string;
    payloadURI?: string;
    website?: string;
    sourceId: string;
    sourceName: string;
}

$ui.register((ctx) => {
    // Everything the UI handler needs must live inside this function body:
    // Seanime stringifies this callback and re-evaluates it in an isolated
    // scope, so top-level consts/functions declared outside it are invisible.
    const DEFAULT_SOURCES: MarketplaceSource[] = [
        {
            id: "seanime-community-marketplace",
            name: "Seanime Community Marketplace",
            url: "https://raw.githubusercontent.com/Bas1874/Seanime-Marketplace/refs/heads/main/Marketplace/Main.json",
        },
        {
            id: "seanime-contributions",
            name: "Seanime-Contributions",
            url: "https://raw.githubusercontent.com/Seanime-contributions/Seanime-Providers/main/marketplace/main.json",
        },
        {
            id: "asleepydrink",
            name: "ASleepyDrink",
            url: "https://raw.githubusercontent.com/ASleepyDrink/Seanime-Stuff/refs/heads/main/marketplace.json",
        },
        {
            id: "pal-droid",
            name: "Pal-droid",
            url: "https://raw.githubusercontent.com/Pal-droid/Seanime-Providers/main/marketplace/main.json",
        },
        {
            id: "jhoorodre",
            name: "Jhoorodre",
            url: "https://raw.githubusercontent.com/Jhoorodre/seanime-provider/master/marketplace.json",
        },
        {
            id: "carloss616",
            name: "Carloss616",
            url: "https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/marketplace.json",
        },
    ];

    const MAX_RENDERED_ENTRIES = 150;

    function slugify(value: string): string {
        const slug = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
        return slug || `source-${Date.now()}`;
    }

    const tray = ctx.newTray({
        tooltipText: "Multi-Marketplace",
        iconUrl: "https://raw.githubusercontent.com/yerasuu/My-Seanime-Providers/test-marketplace/multi-marketplace/icon.svg",
        withContent: true,
        isDrawer: true,
    });

    // Best-effort: hook the native "Change repository" button on the Extensions
    // page so it also opens this plugin's tray. Purely additive (extra click
    // listener, never removes/replaces the native handler) and fully guarded,
    // so if the DOM API is unavailable or Seanime's markup changes, this just
    // silently does nothing and the tray icon keeps working as the fallback.
    async function tryHookChangeRepositoryButton() {
        if (!ctx.dom || !ctx.dom.query) return;
        try {
            const buttons = await ctx.dom.query("button");
            if (!Array.isArray(buttons)) return;
            for (const btn of buttons) {
                try {
                    const text = btn.getText ? (btn.getText() || "").trim() : "";
                    if (text !== "Change repository") continue;
                    const attrs = btn.getAttributes ? btn.getAttributes() : {};
                    if (attrs && attrs["data-mmp-hooked"]) continue;
                    if (btn.setAttribute) btn.setAttribute("data-mmp-hooked", "1");
                    if (btn.addEventListener) {
                        btn.addEventListener("click", () => {
                            try { tray.open(); } catch (e) { /* ignore */ }
                        });
                    }
                } catch (e) {
                    // Skip this element, keep checking the rest
                }
            }
        } catch (e) {
            // DOM API unavailable/blocked, tray icon remains the fallback
        }
    }

    try {
        if (ctx.dom && ctx.dom.onReady) {
            ctx.dom.onReady(() => { tryHookChangeRepositoryButton(); });
        }
    } catch (e) { /* ignore */ }

    ctx.setInterval(() => { tryHookChangeRepositoryButton(); }, 2000);

    const storedSources = $storage.get<MarketplaceSource[]>("sources");
    const sources = ctx.state<MarketplaceSource[]>(storedSources && storedSources.length > 0 ? storedSources : DEFAULT_SOURCES);
    const catalog = ctx.state<CatalogEntry[]>([]);
    const query = ctx.state<string>("");
    const loading = ctx.state<boolean>(false);
    const lastError = ctx.state<string>("");

    const searchRef = ctx.fieldRef<string>("");
    const newSourceNameRef = ctx.fieldRef<string>("");
    const newSourceUrlRef = ctx.fieldRef<string>("");

    function persistSources(list: MarketplaceSource[]) {
        $storage.set("sources", list);
    }

    async function refresh() {
        if (loading.get()) return;
        loading.set(true);
        lastError.set("");

        const merged: Record<string, CatalogEntry> = {};
        const failed: string[] = [];

        for (const src of sources.get()) {
            try {
                const res = await ctx.fetch(src.url);
                if (!res.ok) {
                    failed.push(src.name);
                    continue;
                }
                const data = await res.json();
                if (!Array.isArray(data)) {
                    failed.push(src.name);
                    continue;
                }
                for (const item of data) {
                    if (!item || !item.id || !item.name) continue;
                    if (merged[item.id]) continue;
                    merged[item.id] = {
                        id: String(item.id),
                        name: String(item.name),
                        description: item.description || "",
                        author: item.author || "",
                        type: item.type || "",
                        language: item.language || "",
                        lang: item.lang || "",
                        icon: item.icon || "",
                        manifestURI: item.manifestURI || "",
                        payloadURI: item.payloadURI || "",
                        website: item.website || "",
                        sourceId: src.id,
                        sourceName: src.name,
                    };
                }
            } catch (e) {
                failed.push(src.name);
            }
        }

        catalog.set(Object.values(merged).sort((a, b) => a.name.localeCompare(b.name)));
        if (failed.length > 0) {
            lastError.set(`Could not reach: ${failed.join(", ")}`);
        }
        loading.set(false);
    }

    ctx.registerEventHandler("refresh", () => {
        refresh();
    });

    ctx.registerEventHandler("search", () => {
        query.set(searchRef.current || "");
    });

    ctx.registerEventHandler("clear-search", () => {
        searchRef.setValue("");
        query.set("");
    });

    ctx.registerEventHandler("add-source", () => {
        const name = (newSourceNameRef.current || "").trim();
        const url = (newSourceUrlRef.current || "").trim();
        if (!name || !url) {
            ctx.toast.warning("Name and URL are required");
            return;
        }
        if (!/^https:\/\//.test(url)) {
            ctx.toast.warning("URL must start with https://");
            return;
        }
        const list = [...sources.get(), { id: slugify(name), name, url }];
        sources.set(list);
        persistSources(list);
        newSourceNameRef.setValue("");
        newSourceUrlRef.setValue("");
        ctx.toast.success(`Added ${name}, refreshing`);
        refresh();
    });

    function removeSource(id: string) {
        const list = sources.get().filter(s => s.id !== id);
        sources.set(list);
        persistSources(list);
        refresh();
    }

    // enable/disable devuelven Promise<boolean>: sin await el catch nunca se
    // dispara y el fallo queda como unhandled rejection.
    async function enableExtension(id: string) {
        try {
            const ok = await ctx.extensions.enable(id);
            if (!ok) {
                ctx.toast.alert(`${id} is not installed yet, install it in Seanime first`);
                return;
            }
            ctx.toast.success(`Enabled ${id}`);
        } catch (e) {
            ctx.toast.alert(`${id} is not installed yet, install it in Seanime first`);
        }
    }

    async function disableExtension(id: string) {
        try {
            const ok = await ctx.extensions.disable(id);
            if (!ok) {
                ctx.toast.alert(`${id} is not installed yet`);
                return;
            }
            ctx.toast.info(`Disabled ${id}`);
        } catch (e) {
            ctx.toast.alert(`${id} is not installed yet`);
        }
    }

    tray.onOpen(() => {
        if (catalog.get().length === 0) refresh();
    });

    tray.render(() => {
        const q = query.get().toLowerCase();
        const all = catalog.get();
        const filtered = q
            ? all.filter(e =>
                e.name.toLowerCase().includes(q) ||
                (e.description || "").toLowerCase().includes(q) ||
                (e.author || "").toLowerCase().includes(q) ||
                (e.type || "").toLowerCase().includes(q))
            : all;
        const shown = filtered.slice(0, MAX_RENDERED_ENTRIES);

        return tray.stack([
            tray.flex([
                tray.text(loading.get()
                    ? "Loading..."
                    : `${all.length} extensions from ${sources.get().length} marketplaces`),
                tray.button("Refresh", { onClick: "refresh", size: "sm", intent: "gray-subtle" }),
            ], { style: { alignItems: "center", justifyContent: "space-between" } }),

            lastError.get() ? tray.text(lastError.get()) : tray.div([]),

            tray.flex([
                tray.input("Search extensions", { fieldRef: searchRef }),
                tray.button("Go", { onClick: "search", size: "sm" }),
                tray.button("Clear", { onClick: "clear-search", size: "sm", intent: "gray-subtle" }),
            ], { style: { alignItems: "flex-end" }, gap: 1 }),

            tray.stack(
                shown.map(entry =>
                    tray.div([
                        tray.flex([
                            tray.text(entry.name),
                            tray.text(`[${entry.sourceName}]`),
                        ], { style: { justifyContent: "space-between" } }),
                        tray.text(`${entry.type || "extension"} · ${entry.author || "unknown"}${entry.lang ? " · " + entry.lang : ""}`),
                        entry.description ? tray.text(entry.description) : tray.div([]),
                        entry.manifestURI ? tray.text(entry.manifestURI) : tray.div([]),
                        tray.flex([
                            entry.manifestURI
                                ? tray.anchor("Open manifest", { href: entry.manifestURI, target: "_blank" })
                                : tray.div([]),
                            tray.button({
                                label: "Enable",
                                size: "sm",
                                intent: "success-subtle",
                                onClick: ctx.eventHandler(`enable-${entry.id}`, () => enableExtension(entry.id)),
                            }),
                            tray.button({
                                label: "Disable",
                                size: "sm",
                                intent: "gray-subtle",
                                onClick: ctx.eventHandler(`disable-${entry.id}`, () => disableExtension(entry.id)),
                            }),
                        ], { gap: 1, style: { alignItems: "center" } }),
                    ], { style: { borderBottom: "1px solid rgba(128,128,128,0.2)", paddingBottom: "8px", marginBottom: "8px" } })
                ),
                {}
            ),

            filtered.length > MAX_RENDERED_ENTRIES
                ? tray.text(`Showing first ${MAX_RENDERED_ENTRIES} of ${filtered.length} matches, refine search`)
                : tray.div([]),

            tray.text("Marketplaces"),
            tray.stack(
                sources.get().map(src =>
                    tray.flex([
                        tray.text(`${src.name} — ${src.url}`),
                        tray.button({
                            label: "Remove",
                            size: "sm",
                            intent: "alert-subtle",
                            onClick: ctx.eventHandler(`remove-${src.id}`, () => removeSource(src.id)),
                        }),
                    ], { style: { justifyContent: "space-between", alignItems: "center" } })
                ),
                {}
            ),

            tray.flex([
                tray.input("Name", { fieldRef: newSourceNameRef }),
                tray.input("https://raw.githubusercontent.com/.../marketplace.json", { fieldRef: newSourceUrlRef }),
                tray.button("Add marketplace", { onClick: "add-source", size: "sm" }),
            ], { style: { alignItems: "flex-end" }, gap: 1 }),
        ], {});
    });
});
