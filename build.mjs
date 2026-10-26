// Seanime transpiles the payload one file at a time and never follows a
// `/// <reference>`, so whatever src/ pulls in that way has to be written into
// main.ts itself, shared type declarations included, so the payload stands alone.
// The payload is reprinted by TypeScript's own printer without comments, so it
// stays TypeScript and readable while carrying only what runs.
//
// Every plugin directory under src/ with its own src/main.ts is built, or only those named.
//
//   node build.mjs [plugin...]          writes src/<category>/<plugin>/main.ts
//   node build.mjs [plugin...] --check  fails when a main.ts is out of date with its src/

import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(fileURLToPath(import.meta.url));

const REFERENCE = /^\/\/\/ <reference path="([^"]+)" \/>\n+/gm;

// Plugins live at src/<category>/<name>, beside the .d.ts files shared by the repo (src/core.d.ts, src/<category>/*.d.ts).
const sourceRoot = join(root, "src");

// A .d.ts outside the plugin's own directory is shared and stays a `/// <reference>` in the payload instead of being inlined.
const isShared = (file, pluginDir) => file.endsWith(".d.ts") && relative(pluginDir, file).startsWith("..");

async function inline(file, inlined, shared, pluginDir) {
    if (inlined.has(file)) return "";
    inlined.add(file);

    const text = await readFile(file, "utf8");
    const parts = [];

    for (const [, path] of text.matchAll(REFERENCE)) {
        const target = resolve(dirname(file), path);
        if (isShared(target, pluginDir)) {
            // A shared declaration is never read, so a wrong path would only surface in the editor.
            await access(target);
            shared.add(target);
        }
        else parts.push(await inline(target, inlined, shared, pluginDir));
    }

    parts.push(text.replace(REFERENCE, "").trimEnd() + "\n");

    return parts.filter(Boolean).join("\n");
}

function condense(source) {
    const file = ts.createSourceFile("main.ts", source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

    // The runtime supplies every ambient `declare` and Seanime strips them while transpiling, so the payload drops them.
    const isAmbient = statement => ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword);

    return file.statements
        .filter(statement => !isAmbient(statement))
        .map(statement => {
            const printed = printer.printNode(ts.EmitHint.Unspecified, statement, file);
            if (!ts.isClassDeclaration(statement)) return printed;

            // The printer drops blank lines, which runs a class's methods together.
            return printed.replace(/^( {4}\}\n)(?= {4}\S)/gm, "$1\n");
        })
        .join("\n\n");
}

async function hasSources(dir) {
    return access(join(dir, "src", "main.ts")).then(() => true, () => false);
}

// Every directory under src/ that has its own src/main.ts, as an absolute path.
async function findPlugins(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const found = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const child = join(dir, entry.name);
        if (await hasSources(child)) found.push(child);
        else found.push(...(await findPlugins(child)));
    }

    return found;
}

async function plugins(named) {
    const all = await findPlugins(sourceRoot);
    if (named.length === 0) return all;

    // A name is the plugin's directory name or its path below src/, e.g. AnimeAV1 or anime/AnimeAV1.
    return named.map(name => {
        const match = all.find(dir => basename(dir) === name || relative(sourceRoot, dir) === name);
        if (!match) {
            process.stderr.write(`${name}: no plugin with a src/main.ts under src/\n`);
            process.exit(1);
        }
        return match;
    });
}

function header(date) {
    return `// Generated from src/ by build.mjs on ${date.toISOString().slice(0, 10)} - edit those files, not this one.`;
}

// Drops the generated header line, dated or from before dates were added, and the blank line after it.
function withoutHeader(text) {
    return text.replace(/^\/\/ Generated from src\/ by build\.mjs[^\n]*\n\n/, "");
}

const check = process.argv.includes("--check");
const named = process.argv.slice(2).filter(arg => arg !== "--check");
let stale = false;

for (const pluginDir of await plugins(named)) {
    const plugin = relative(root, pluginDir);
    const out = join(pluginDir, "main.ts");
    const shared = new Set();
    const inlined = condense(await inline(join(pluginDir, "src", "main.ts"), new Set(), shared, pluginDir));
    const references = [...shared].map(file => `/// <reference path="${relative(pluginDir, file)}" />\n`).join("");
    const body = `${references}${references ? "\n" : ""}${inlined}\n`;
    const existing = await readFile(out, "utf8").catch(() => "");
    const current = withoutHeader(existing);
    const dated = /^\/\/ Generated from src\/ by build\.mjs on \d{4}-\d{2}-\d{2} /.test(existing);

    // The date is when the payload last changed, so an unchanged rebuild keeps the old one and --check never goes stale with the calendar.
    if (!check) {
        if (current !== body || !dated) await writeFile(out, `${header(new Date())}\n\n${body}`);
    } else if (current !== body) {
        process.stderr.write(`${plugin}/main.ts is out of date with src/, run: npm run build\n`);
        stale = true;
    }
}

if (stale) process.exit(1);
