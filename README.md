# My Seanime Providers

Seanime extensions (providers/plugins) repo.

## Plugins

| Plugin | Type | Description | Manifest branch | Notes |
|---|---|---|---|---|
| [AnimeAV1](AnimeAV1) | onlinestream-provider | Online streaming, hard subs + dubs, Spanish. Servers: HLS, UPNShare, Byse, Voe, MP4Upload | `test` | Use version from [Seanime-contributions/Seanime-Providers](https://github.com/Seanime-contributions/Seanime-Providers), not this repo |
| [multi-marketplace](multi-marketplace) | plugin | Browse/manage extensions from multiple community marketplaces at once | `test-marketplace` | |
| [OlympusScanlation](OlympusScanlation) | manga-provider | Manga provider (Olympus Scanlation, olympusxyz.com), Spanish | `test` | |
| [shademanga](shademanga) | manga-provider | Manga/comics provider (Shade Manga), Spanish | `main` | |

Install by adding a plugin's manifest to Seanime:
`https://raw.githubusercontent.com/yerasuu/My-Seanime-Providers/<branch>/<plugin>/manifest.json`

Each plugin dir has its own `manifest.json` + `main.ts` payload.

## Building

Plugins with a `src/` directory (today only AnimeAV1) have a generated `main.ts`. Edit `src/`, never `main.ts`.

```sh
npm install          # once
npm run build        # regenerate every plugin's main.ts
npm run check        # fail if any main.ts is out of date with its src/
# build just one plugin
npm run build AnimeAV1
# or
node build.mjs AnimeAV1
```

Commit `src/` and the regenerated `main.ts` together.

Seanime loads only the payload file and never follows `/// <reference>`, so the build inlines every referenced file (shared `.d.ts` included) and reprints the result with the TypeScript printer: still TypeScript and readable, with no comments.
