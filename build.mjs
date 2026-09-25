// Seanime transpiles the payload one file at a time and never follows a
// `/// <reference>`, so whatever src/ pulls in that way has to be written into
// main.ts itself, shared type declarations included, so the payload stands alone.
// The payload is reprinted by TypeScript's own printer without comments, so it
// stays TypeScript and readable while carrying only what runs.
//
// Every plugin directory with a src/main.ts is built, or only those named.
//
//   node build.mjs [plugin...]          writes <plugin>/main.ts
//   node build.mjs [plugin...] --check  fails when a main.ts is out of date with its src/

import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(fileURLToPath(import.meta.url));

const REFERENCE = /^\/\/\/ <reference path="([^"]+)" \/>\n+/gm;

async function inline(file, inlined) {
    if (inlined.has(file)) return "";
    inlined.add(file);

    const text = await readFile(file, "utf8");
    const parts = [];

    for (const [, path] of text.matchAll(REFERENCE)) {
        parts.push(await inline(resolve(dirname(file), path), inlined));
    }

    parts.push(text.replace(REFERENCE, "").trimEnd() + "\n");

    return parts.filter(Boolean).join("\n");
}

function condense(source) {
    const file = ts.createSourceFile("main.ts", source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

    return file.statements
        .map(statement => {
            const printed = printer.printNode(ts.EmitHint.Unspecified, statement, file);
            if (!ts.isClassDeclaration(statement)) return printed;

            // The printer drops blank lines, which runs a class's methods together.
            return printed.replace(/^( {4}\}\n)(?= {4}\S)/gm, "$1\n");
        })
        .join("\n\n");
}

async function hasSources(plugin) {
    return access(join(root, plugin, "src", "main.ts")).then(() => true, () => false);
}

async function plugins(named) {
    if (named.length > 0) return named;

    const entries = await readdir(root, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory() && entry.name !== "node_modules");
    const found = await Promise.all(dirs.map(async dir => ((await hasSources(dir.name)) ? dir.name : null)));

    return found.filter(Boolean);
}

const check = process.argv.includes("--check");
const named = process.argv.slice(2).filter(arg => arg !== "--check");
let stale = false;

for (const plugin of await plugins(named)) {
    if (!(await hasSources(plugin))) {
        process.stderr.write(`${plugin}: no src/main.ts to build\n`);
        process.exit(1);
    }

    const out = join(root, plugin, "main.ts");
    const body = condense(await inline(join(root, plugin, "src", "main.ts"), new Set()));
    const bundle = `// Generated from src/ by build.mjs - edit those files, not this one.\n\n${body}\n`;

    if (!check) {
        await writeFile(out, bundle);
    } else if ((await readFile(out, "utf8").catch(() => "")) !== bundle) {
        process.stderr.write(`${plugin}/main.ts is out of date with src/, run: npm run build\n`);
        stale = true;
    }
}

if (stale) process.exit(1);
