/* Prod-asset regression: the deployed client 404d on /data/maps/*.json
   because public/{audio,data,img} are symlinks, which source uploads do not
   preserve — the cloud build emitted a dist/ with no game assets. This pins
   the invariant: a fresh production build must ship every map JSON plus art,
   and the Dockerfile must restore the symlinked trees before building. */
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { MAPS } from "../shared/constants.js";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let errors = 0;
const fail = m => { console.error("FAIL:", m); errors++; };
const pass = m => console.log("PASS:", m);

execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
pass("production build runs");

const missing = MAPS.map(m => m[0]).filter(id => !fs.existsSync(path.join(ROOT, "dist", "data", "maps", `${id}.json`)));
if (missing.length) fail("dist missing map JSON: " + missing.join(","));
else pass(`dist ships all ${MAPS.length} map JSONs`);

for (const p of ["dist/index.html", "dist/img", "dist/audio"]) {
  if (!fs.existsSync(path.join(ROOT, p))) fail("dist missing " + p);
  else pass("dist ships " + p);
}

/* the Dockerfile must dereference public/ before vite runs (see header) */
try {
  const out = execFileSync("grep", ["-c", "cp -r \\$d public/\\$d", path.join(ROOT, "Dockerfile")], { stdio: "pipe" });
  if (parseInt(out.toString(), 10) < 1) fail("Dockerfile lost the public-asset restore step");
  else pass("Dockerfile restores symlinked public assets");
} catch (e) {
  fail("Dockerfile lost the public-asset restore step");
}

console.log(errors ? `\nDIST ASSETS TEST FAILED (${errors})` : "\nDIST ASSETS TEST PASSED");
process.exit(errors ? 1 : 0);
