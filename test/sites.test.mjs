import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { derivedSites, refreshSites } from "../src/sites.mjs";

const personaWithSites = async () => {
  const dir = await mkdtemp(join(tmpdir(), "persona-sites-"));
  const site = async (name, scripts) => {
    await mkdir(join(dir, "sites", name), { recursive: true });
    await writeFile(join(dir, "sites", name, "package.json"), JSON.stringify({ scripts }));
  };
  await site("derived.example", { derive: "x", "derive:check": "x", publish: "x" });
  await site("plain.example", { build: "x" });
  return dir;
};

test("only a site that derives pages and can publish takes part in the turn", async () => {
  const dir = await personaWithSites();
  assert.deepEqual(derivedSites(dir), [join(dir, "sites", "derived.example")]);
  assert.deepEqual(derivedSites(join(dir, "nowhere")), []);
});

test("a stale site is derived and republished on a publishing turn, and only reported otherwise", async () => {
  const dir = await personaWithSites();
  const ran = [];
  const stale = async (site, script) => (ran.push(script), { status: script === "derive:check" ? 1 : 0, said: "" });
  assert.deepEqual(await refreshSites(dir, { run: stale }), [{ site: "derived.example", state: "would-republish" }]);
  assert.deepEqual(ran, ["derive:check"]);
  ran.length = 0;
  assert.deepEqual(await refreshSites(dir, { publish: true, run: stale }), [{ site: "derived.example", state: "republished" }]);
  assert.deepEqual(ran, ["derive:check", "derive", "publish"]);
  const current = async () => ({ status: 0, said: "" });
  assert.deepEqual(await refreshSites(dir, { publish: true, run: current }), [{ site: "derived.example", state: "current" }]);
  const failing = async (site, script) => ({ status: script === "publish" ? 1 : script === "derive:check" ? 1 : 0, said: "neocities refused" });
  assert.deepEqual(await refreshSites(dir, { publish: true, run: failing }), [{ site: "derived.example", error: "publish failed: neocities refused" }]);
});
