// Checks that the JSON data files match the defaults built into nib.js.
// Run from the repo root:  node tools/check-data.mjs
import { readFileSync } from "node:fs";
import { ERAVAS_PRINT_A, SAILORS_SAILOR } from "../nib.js";

const pairs = [
  ["hands/eravas-print-a.json", ERAVAS_PRINT_A],
  ["profiles/sailors-sailor.json", SAILORS_SAILOR],
];
let ok = true;
for (const [file, builtIn] of pairs) {
  const same = JSON.stringify(JSON.parse(readFileSync(new URL("../" + file, import.meta.url)))) === JSON.stringify(builtIn);
  console.log(`${same ? "ok  " : "DIFF"} ${file}`);
  ok &&= same;
}
process.exit(ok ? 0 : 1);
