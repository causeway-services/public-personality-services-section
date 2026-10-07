import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { profileFor, provisionPersona, readReceipt } from "../src/persona.mjs";
import { personaAddress, personaEmail } from "../src/providers.mjs";

const PERSONA = {
  persona: "test-author", name: "Test Author", summary: "Quiet books.", disclosure: "Made by the Group.",
  home: "https://testauthor.neocities.org/", publisher: "Causeway Services",
  email: { provider: "fastmail", prefer: ["test.author@fastmail.com", "test.author@561.group"] },
  presences: [
    { platform: "neocities", site: "testauthor" },
    { platform: "hive", account: "testauthor" },
    { platform: "mastodon", server: "mastodon.example", username: "testauthor" },
  ],
};
const personaDir = async (persona = PERSONA) => {
  const dir = await mkdtemp(join(tmpdir(), "persona-"));
  await writeFile(join(dir, "persona.json"), JSON.stringify(persona));
  return dir;
};

test("profiles say how the persona is made only where a platform requires it", () => {
  const [, hive, mastodon] = PERSONA.presences;
  assert.equal(profileFor(PERSONA, hive).about, "Quiet books.");
  assert.deepEqual(profileFor(PERSONA, mastodon), {
    display_name: "Test Author", note: "Quiet books.", bot: false,
    fields: [{ name: "Website", value: "https://testauthor.neocities.org/" }, { name: "Hive", value: "https://peakd.com/@testauthor" }, { name: "Publisher", value: "Causeway Services" }],
  });
  const required = { ...PERSONA, discloseOn: ["mastodon"] };
  assert.equal(profileFor(required, hive).about, "Quiet books.");
  assert.deepEqual([profileFor(required, mastodon).note, profileFor(required, mastodon).bot], ["Quiet books.\n\nMade by the Group.", true]);
});

test("each presence is reconciled and receipted; one failing does not stop the others", async () => {
  const dir = await personaDir();
  const providers = {
    email: async (p) => ({ platform: "email", provider: p.provider, address: p.prefer[0], state: "waits-on-person", step: "api-token" }),
    neocities: async (p) => ({ platform: "neocities", site: p.site, state: "held" }),
    hive: async () => { throw new Error("node unreachable"); },
    mastodon: async (p) => ({ platform: "mastodon", username: p.username, state: "awaiting-approval" }),
  };
  const { results } = await provisionPersona(dir, { providers });
  assert.deepEqual(results.map((r) => r.state ?? r.error), ["waits-on-person", "held", "node unreachable", "awaiting-approval"]);
  assert.equal((await readReceipt(dir, "mastodon")).state, "awaiting-approval");
  assert.equal(await readReceipt(dir, "hive"), null);
});

test("a dry run writes no receipts", async () => {
  const dir = await personaDir();
  await provisionPersona(dir, { providers: { neocities: async () => ({ platform: "neocities", state: "exists" }) }, only: ["neocities"], dryRun: true });
  assert.equal(await readReceipt(dir, "neocities"), null);
});

test("an address on a provider's shared domain is made once, from the persona's preferences, by the person", async () => {
  const receipts = new Map();
  const context = { persona: PERSONA, dryRun: false, readReceipt: async (k) => receipts.get(k) ?? null, writeReceipt: async (k, v) => receipts.set(k, v) };
  const asked = [];
  const person = { ask: async ({ input }) => { asked.push(input); assert.ok(!input.pattern.test("someone@else.com")); return "Test.Author@fastmail.com"; } };
  assert.equal(await personaAddress(context, person), "test.author@fastmail.com");
  assert.equal(await personaAddress(context, null), "test.author@fastmail.com");
  assert.equal(asked.length, 1);
  assert.equal(receipts.get("email").madeBy, "person");
  assert.deepEqual(await personaEmail(context, null), { address: "test.author@fastmail.com" });
  await assert.rejects(personaAddress({ ...context, readReceipt: async () => null }, null), /needs a person/u);
});

test("an address on the house's domain is assigned, and accounts wait until the house sends as it", async () => {
  const receipts = new Map();
  const persona = { ...PERSONA, email: { provider: "fastmail", prefer: ["Test.Author@561.group"] } };
  const context = { persona, dryRun: false, readReceipt: async (k) => receipts.get(k) ?? null, writeReceipt: async (k, v) => receipts.set(k, v) };
  const person = { ask: async () => assert.fail("nobody picks an assigned address") };
  assert.equal(await personaAddress(context, person), "test.author@561.group");
  assert.equal(receipts.size, 0);
  assert.deepEqual(await personaEmail(context, person), { waits: { state: "waits-on-email", address: "test.author@561.group", step: "email" } });
  receipts.set("email", { address: "test.author@561.group", state: "waits-on-person", step: "api-token" });
  assert.equal((await personaEmail(context, person)).waits.step, "api-token");
  receipts.set("email", { address: "test.author@561.group", state: "sends" });
  assert.deepEqual(await personaEmail(context, person), { address: "test.author@561.group" });
});
