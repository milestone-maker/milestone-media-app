#!/usr/bin/env node

process.on("unhandledRejection", (err) => { console.error("✗ Unhandled rejection:", err); process.exit(1); });
process.on("uncaughtException",  (err) => { console.error("✗ Uncaught exception:",  err); process.exit(1); });

// Unit test for src/lib/facebookAlbumEdit.js — the pure add/remove/swap + step
// logic behind the editable FB album.  node scripts/test-facebook-album-edit.mjs

import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOD = resolve(__dirname, "..", "src", "lib", "facebookAlbumEdit.js");
const { addToAlbum, removeFromAlbum, swapInAlbum, stepIndex } = await import(pathToFileURL(MOD).href);

let passed = 0, failed = 0;
const check = (n, c, d = "") => { if (c) { console.log(`  ✓ ${n}`); passed++; } else { console.log(`  ✗ ${n}${d ? ` — ${d}` : ""}`); failed++; } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("\n── facebookAlbumEdit ──\n");

// addToAlbum — append, no dup, preserve order.
check("add appends in order", eq(addToAlbum(["a", "b"], "c"), ["a", "b", "c"]));
check("add dedupes (no-op if present)", eq(addToAlbum(["a", "b"], "a"), ["a", "b"]));
check("add ignores empty url", eq(addToAlbum(["a"], ""), ["a"]));
check("add to empty", eq(addToAlbum([], "a"), ["a"]));

// removeFromAlbum
check("remove drops the url", eq(removeFromAlbum(["a", "b", "c"], "b"), ["a", "c"]));
check("remove absent → unchanged", eq(removeFromAlbum(["a", "b"], "z"), ["a", "b"]));

// swapInAlbum — replace in place, preserve position.
check("swap replaces in place", eq(swapInAlbum(["a", "b", "c"], "b", "x"), ["a", "x", "c"]));
check("swap first slot", eq(swapInAlbum(["a", "b", "c"], "a", "x"), ["x", "b", "c"]));
check("swap last slot", eq(swapInAlbum(["a", "b", "c"], "c", "x"), ["a", "b", "x"]));
check("swap of absent old → appends new", eq(swapInAlbum(["a", "b"], "z", "x"), ["a", "b", "x"]));
check("swap to same url → no-op", eq(swapInAlbum(["a", "b"], "b", "b"), ["a", "b"]));
check("swap with empty new → no-op", eq(swapInAlbum(["a", "b"], "b", ""), ["a", "b"]));
// new already present elsewhere → no duplicate, old slot takes new.
check("swap when new already present → no dup", eq(swapInAlbum(["a", "b", "c"], "a", "c"), ["c", "b"]));

// stepIndex — wrap both directions, edge lengths.
check("step +1", stepIndex(0, 3, 1) === 1);
check("step +1 wraps", stepIndex(2, 3, 1) === 0);
check("step -1 wraps", stepIndex(0, 3, -1) === 2);
check("step -1", stepIndex(2, 3, -1) === 1);
check("step len 1 stays 0", stepIndex(0, 1, 1) === 0);
check("step len 0 → 0", stepIndex(0, 0, 1) === 0);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
