import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { authorSiteConfig, deriveAuthorSite } from "../src/author-site.mjs";
import { namesFor, personaFiles, scaffoldPersona } from "../src/scaffold.mjs";

const SPEC = { persona: "wren-hale", name: "Wrën Hale", summary: "Lighthouse mysteries on Lake Huron.", today: "2026-10-02" };

test("every name follows from hers: one handle on every platform, an address on the house's domain", () => {
  assert.deepEqual(namesFor("Wrën Hale"), { handle: "wrenhale", address: "wren.hale@561.group" });
  const files = personaFiles({ ...SPEC, mastodon: { server: "mastodon.example", reason: "An author's account." }, newsletter: true });
  const persona = JSON.parse(files.get("wren-hale-services-section/persona.json"));
  assert.equal(persona.home, "https://wrenhale.neocities.org/");
  assert.deepEqual(persona.email, { provider: "fastmail", prefer: ["wren.hale@561.group"] });
  assert.deepEqual(persona.discloseOn, []);
  assert.deepEqual(persona.presences.map((p) => [p.platform, p.site ?? p.account ?? p.username ?? p.newsletter]),
    [["neocities", "wrenhale"], ["hive", "wrenhale"], ["mastodon", "wrenhale"], ["buttondown", "wrenhale"]]);
  assert.match(persona.avatar.prompt, /no faces/u);
  const site = JSON.parse(files.get("wren-hale-services-section/sites/wrenhale.neocities.org/package.json"));
  assert.equal(site.scripts["derive:check"], "author-site derive --check");
  assert.ok(site.dependencies["@red-cup-engineering/public-personality-services-section"]);
});

test("a name too long for Hive needs a handle, and a malformed id is refused", () => {
  assert.throws(() => personaFiles({ ...SPEC, name: "Evangeline Montgomery-Ashworth" }), /pass a shorter handle/u);
  assert.equal(JSON.parse(personaFiles({ ...SPEC, name: "Evangeline Montgomery-Ashworth", handle: "evangelinema" }).get("wren-hale-services-section/persona.json")).presences[0].site, "evangelinema");
  assert.throws(() => personaFiles({ ...SPEC, persona: "Wren Hale" }), /lowercase words/u);
  assert.throws(() => personaFiles({ ...SPEC, mastodon: { server: "mastodon.example" } }), /reason/u);
});

test("a scaffolded persona's site configures and derives from persona.json, and is scaffolded once", async () => {
  const root = await mkdtemp(join(tmpdir(), "persona-new-"));
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  assert.ok((await scaffoldPersona(root, SPEC, { dryRun: true })).files.every((row) => row.state === "would-write"));
  assert.equal(existsSync(join(root, "wren-hale-services-section")), false);
  const made = await scaffoldPersona(root, SPEC);
  assert.deepEqual([made.section, made.address, made.handle], ["wren-hale-services-section", "wren.hale@561.group", "wrenhale"]);
  await assert.rejects(scaffoldPersona(root, SPEC), /scaffolded once/u);

  const site = join(root, "wren-hale-services-section", "sites", "wrenhale.neocities.org");
  const config = authorSiteConfig(site);
  assert.deepEqual([config.site.name, config.site.baseIri, config.pwa.manifest.description], ["Wrën Hale", "https://wrenhale.neocities.org/", SPEC.summary]);
  assert.deepEqual(config.site.menu.map((item) => item.label), ["Home", "About"]);
  assert.deepEqual(config.discovery.me, ["https://peakd.com/@wrenhale"]);
  await deriveAuthorSite({ site, check: true, log: () => {} });
  assert.match(await readFile(join(site, "content", "about.md"), "utf8"), /Causeway Services/u);
});
