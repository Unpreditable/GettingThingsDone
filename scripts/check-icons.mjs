#!/usr/bin/env node
/**
 * Checks every Lucide icon name used in src/ against the set your installed
 * Obsidian actually ships.
 *
 * This exists because lucide.dev shows the LATEST icon set, while Obsidian
 * bundles a snapshot taken whenever that release was cut. `broom` and
 * `broom-sparkles` are real Lucide icons and are absent from Obsidian 1.13.7;
 * setIcon() fails silently for a name it doesn't know, leaving an empty span
 * that is easy to miss in review.
 *
 *   node scripts/check-icons.mjs            # find Obsidian automatically
 *   node scripts/check-icons.mjs --list     # print every available name
 *   node scripts/check-icons.mjs --asar <path to obsidian-x.y.z.asar>
 *
 * Not wired into `npm run build`: it needs a local Obsidian install, which CI
 * does not have.
 */
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const args = process.argv.slice(2);
const wantList = args.includes("--list");
const asarFlag = args.indexOf("--asar");

function findAsar() {
  if (asarFlag !== -1 && args[asarFlag + 1]) return args[asarFlag + 1];
  const dirs = [
    process.env.APPDATA && join(process.env.APPDATA, "obsidian"),
    process.env.HOME && join(process.env.HOME, ".config", "obsidian"),
    process.env.HOME && join(process.env.HOME, "Library", "Application Support", "obsidian"),
  ].filter(Boolean);
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    // Highest version wins when several are cached side by side.
    const found = readdirSync(dir)
      .filter((f) => /^obsidian-[\d.]+\.asar$/.test(f))
      .sort()
      .pop();
    if (found) return join(dir, found);
  }
  return null;
}

const asar = findAsar();
if (!asar) {
  console.error("Could not find an Obsidian .asar. Pass one with --asar <path>.");
  process.exit(2);
}

/**
 * Pulls one file out of an asar archive without unpacking it or shelling out.
 * Layout: a 16-byte pickle header, then a JSON directory of that length, then
 * the file blobs, whose offsets are relative to the end of the pickle.
 */
function readFromAsar(archive, name) {
  const buf = readFileSync(archive);
  const pickleSize = buf.readUInt32LE(8);
  const jsonLen = buf.readUInt32LE(12);
  const dir = JSON.parse(buf.subarray(16, 16 + jsonLen).toString("utf8"));
  const entry = dir.files[name];
  if (!entry) throw new Error(`${name} not found inside ${archive}`);
  const start = 8 + pickleSize + Number(entry.offset);
  return buf.subarray(start, start + entry.size).toString("utf8");
}

const appJs = readFromAsar(asar, "app.js");

// Registry entries are `name:[[n,"M…"]]` — a bare identifier when the name is a
// valid JS identifier, quoted when it is kebab-case.
const available = new Set();
const entry = /(?:"([a-z][a-z0-9-]{1,40})"|\b([a-z][a-zA-Z0-9]{1,40}))\s*:\s*\[\[\s*\d+\s*,\s*"[Mm]/g;
for (let m; (m = entry.exec(appJs)); ) available.add(m[1] || m[2]);

console.log(`${asar.split(/[\\/]/).pop()} — ${available.size} icons`);

if (wantList) {
  console.log([...available].sort().join("\n"));
  process.exit(0);
}

function* sourceFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sourceFiles(p);
    else if (/\.(ts|svelte)$/.test(e.name)) yield p;
  }
}

// use:icon={"pin"} · setIcon("pin") · renderIcon(el, "pin") · icon: "pin" · marker: "zap"
const usage =
  /(?:use:icon=\{|setIcon\(|renderIcon\([\w.[\]]+,\s*|(?:icon|marker):\s*)"([a-z][a-z0-9-]*)"/g;
const used = new Map();
for (const file of sourceFiles("src")) {
  const text = readFileSync(file, "utf8");
  for (let m; (m = usage.exec(text)); ) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(file);
  }
}

let bad = 0;
for (const [name, files] of [...used].sort()) {
  const ok = available.has(name);
  if (!ok) bad++;
  console.log(`${ok ? "  ok" : "MISS"}  ${name}${ok ? "" : "   ← " + [...files].join(", ")}`);
}

if (bad > 0) {
  console.error(`\n${bad} icon name(s) this Obsidian does not ship — setIcon renders nothing for them.`);
  process.exit(1);
}
