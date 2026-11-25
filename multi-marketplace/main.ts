interface MarketplaceSource {
    id: string;
    name: string;
    url: string;
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

    // Seanime keeps the active marketplace in the web UI localStorage (jotai atomWithStorage, JSON encoded).
    const STORAGE_KEY = "marketplace-url";

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
    const activeUrl = ctx.state<string>("");

    const newSourceNameRef = ctx.fieldRef<string>("");
    const newSourceUrlRef = ctx.fieldRef<string>("");

    function persistSources(list: MarketplaceSource[]) {
        $storage.set("sources", list);
    }

    // Switches Seanime's own marketplace repository: writes the web UI's
    // localStorage entry through an injected script, then reloads so the
    // Extensions page reads it. Needs the dom-script-manipulation flag.
    async function useSource(src: MarketplaceSource) {
        try {
            if (!ctx.dom || !ctx.dom.createElement || !ctx.dom.queryOne) throw new Error("no dom");
            const body = await ctx.dom.queryOne("body");
            if (!body) throw new Error("no body");
            const script = await ctx.dom.createElement("script");
            script.setText(`try{localStorage.setItem(${JSON.stringify(STORAGE_KEY)},${JSON.stringify(JSON.stringify(src.url))});}catch(e){}location.reload();`);
            body.append(script);
            activeUrl.set(src.url);
            ctx.toast.success(`Marketplace: ${src.name}`);
        } catch (e) {
            ctx.toast.alert(`Could not switch automatically. Paste this in Change repository: ${src.url}`);
        }
    }

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
        ctx.toast.success(`Added ${name}`);
    });

    function removeSource(id: string) {
        const list = sources.get().filter(s => s.id !== id);
        sources.set(list);
        persistSources(list);
    }

    tray.render(() => {
        const current = activeUrl.get();

        return tray.stack([
            tray.text("Select a marketplace to make it Seanime's repository"),
            tray.stack(
                sources.get().map(src =>
                    tray.flex([
                        tray.text(`${src.url === current ? "● " : ""}${src.name}`),
                        tray.flex([
                        tray.button({
                            label: src.url === current ? "Active" : "Use",
                            size: "sm",
                            intent: "success-subtle",
                            onClick: ctx.eventHandler(`use-${src.id}`, () => useSource(src)),
                        }),
                        tray.button({
                            label: "Remove",
                            size: "sm",
                            intent: "alert-subtle",
                            onClick: ctx.eventHandler(`remove-${src.id}`, () => removeSource(src.id)),
                        }),
                        ], { gap: 1 }),
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
