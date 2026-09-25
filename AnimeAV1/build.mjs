// Seanime transpiles the payload one file at a time and never follows a
// `/// <reference>`, so whatever src/ pulls in that way has to be written into
// main.ts itself. References that leave src/ only carry types and are kept.
// The payload is reprinted by TypeScript's own printer without comments, so it
// stays TypeScript and readable while carrying only what runs.
//
//   node build.mjs          writes main.ts
//   node build.mjs --check  fails when main.ts is out of date with src/

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const out = join(root, "main.ts");

const REFERENCE = /^\/\/\/ <reference path="([^"]+)" \/>\n+/gm;

const inlined = new Set();
const kept = new Set();

async function inline(file) {
    if (inlined.has(file)) return "";
    inlined.add(file);

    const text = await readFile(file, "utf8");
    const parts = [];

    for (const [, path] of text.matchAll(REFERENCE)) {
        const target = resolve(dirname(file), path);

        if (target.startsWith(src + sep)) {
            parts.push(await inline(target));
        } else {
            kept.add(relative(root, target).split(sep).join("/"));
        }
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

const body = condense(await inline(join(src, "main.ts")));
const header = [...kept].map(path => `/// <reference path="${path}" />`).join("\n");
const bundle = `${header}\n\n// Generated from src/ by build.mjs - edit those files, not this one.\n\n${body}\n`;

if (process.argv.includes("--check")) {
    const current = await readFile(out, "utf8").catch(() => "");
    if (current !== bundle) {
        process.stderr.write("main.ts is out of date with src/, run: node AnimeAV1/build.mjs\n");
        process.exit(1);
    }
} else {
    await writeFile(out, bundle);
}
