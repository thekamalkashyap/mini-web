/* Deep-link regression: ?solo=<map>[&demo][&flashhold][&colliders][&bots][&zoom=N]
   must always boot a game — an unknown map id used to 404 the map JSON (the
   dev server answers index.html), killing JSON.parse in BootScene and hanging
   on a blank page with no HUD. resolveMapId coerces to 1outpost up front. */
import { MAPS, resolveMapId } from "../shared/constants.js";
import { parseSoloSearch } from "../src/soloLink.js";

let errors = 0;
const fail = m => { console.error("FAIL:", m); errors++; };
const pass = m => console.log("PASS:", m);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* every shipped map id resolves to itself */
{
  const bad = MAPS.map(m => m[0]).filter(id => resolveMapId(id) !== id);
  if (bad.length) fail("known ids rejected: " + bad.join(","));
  else pass("all MAPS ids resolve to themselves");
}

/* the reported failure: unknown map + full debug-flag combo must still load */
{
  const o = parseSoloSearch("?solo=BADMAP&colliders&bots&demo&flashhold&zoom=2");
  if (!o) fail("full-flag deep link parsed as null");
  else if (o.map !== "1outpost") fail("bad map did not fall back, got " + o.map);
  else if (!eq([o.demo, o.flashHold, o.colliders, o.bots, o.zoom], [true, true, true, true, 2]))
    fail("flags lost: " + JSON.stringify(o));
  else pass("unknown map + all flags falls back to 1outpost, flags kept");
}

/* display labels are not ids — must load, not blank-screen */
{
  const o = parseSoloSearch("?solo=Outpost");
  if (!o || o.map !== "1outpost") fail("label 'Outpost' did not fall back");
  else pass("label instead of id falls back to 1outpost");
}

/* valid deep link passes through untouched */
{
  const o = parseSoloSearch("?solo=7lunarcy&bots&zoom=2");
  if (!o || o.map !== "7lunarcy" || o.bots !== true || o.zoom !== 2) fail("valid link altered: " + JSON.stringify(o));
  else pass("valid map id passes through with flags");
}

/* edge inputs */
{
  const cases = [
    ["?solo=", "1outpost", "empty solo"],
    ["?solo", "1outpost", "bare solo"],
    ["?solo=%201outpost%20", "1outpost", "padded id"],
    ["?solo=1outpost&zoom=junk", 0, "junk zoom"],
    ["?solo=1outpost", 0, "missing zoom"],
  ];
  for (const [q, want, name] of cases) {
    const o = parseSoloSearch(q);
    const got = typeof want === "number" ? o && o.zoom : o && o.map;
    if (!o || got !== want) fail(`${name}: got ${JSON.stringify(o)}`);
    else pass(`${name} ok`);
  }
  if (parseSoloSearch("?bots") !== null) fail("non-solo query parsed as link");
  else pass("non-solo query returns null");
  for (const bad of [undefined, null, "", "  "]) {
    if (resolveMapId(bad) !== "1outpost") fail("resolveMapId(" + JSON.stringify(bad) + ") not fallback");
  }
  pass("resolveMapId edge inputs fall back");
}

console.log(errors ? `\nDEEP LINK TEST FAILED (${errors})` : "\nDEEP LINK TEST PASSED");
process.exit(errors ? 1 : 0);
