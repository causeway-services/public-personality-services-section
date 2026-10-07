import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { assayReasons, gate, patternReasons } from "../src/gate.mjs";
import { cadenceMs, notePage, readDraft, slugOf, tendNotes } from "../src/notes.mjs";

const PERSONA = {
  persona: "test-author", name: "Test Author", summary: "Quiet books.", home: "https://testauthor.neocities.org/",
  links: ["https://shop.example/"],
  notes: { voice: "voice.md", cadence: "P2D", site: "testauthor.neocities.org" },
  presences: [{ platform: "neocities", site: "testauthor" }],
};

const personaDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "persona-notes-"));
  await writeFile(join(dir, "persona.json"), JSON.stringify(PERSONA));
  await writeFile(join(dir, "voice.md"), "You write quiet notes about the lake.");
  await mkdir(join(dir, "sites", "testauthor.neocities.org"), { recursive: true });
  return dir;
};

/** A market that delivers `drafts` in turn, assays with `verdicts` in turn, and remembers every judgement. */
function fakeMarket({ drafts, verdicts = [] }) {
  const asked = [], judged = [];
  let lot = 0;
  return {
    asked, judged,
    async chat(request) {
      asked.push(request);
      const text = request.taskClass === "persona-note-draft" ? drafts.shift() : verdicts.shift() ?? "{\"withhold\": false, \"reasons\": []}";
      return { text, lot: { workLot: `urn:work-lot:${lot += 1}`, taskClass: request.taskClass } };
    },
    async judge(delivery, outcome, evidence) { judged.push([delivery.workLot, delivery.taskClass, outcome, evidence]); },
  };
}

const at = (iso) => () => new Date(iso);

test("cadence is an ISO 8601 duration of days and hours", () => {
  assert.equal(cadenceMs("P2D"), 2 * 86_400_000);
  assert.equal(cadenceMs("PT12H"), 12 * 3_600_000);
  assert.equal(cadenceMs("P1DT6H"), 30 * 3_600_000);
  assert.throws(() => cadenceMs("2 days"), /ISO 8601/u);
  assert.throws(() => cadenceMs("P"), /ISO 8601/u);
});

test("the gate withholds what she must never say, and names the rule each time", () => {
  const rules = (text) => patternReasons(text, { persona: PERSONA, sites: PERSONA.links }).map(({ rule }) => rule);
  assert.ok(rules("I'm a real woman living in Duluth, and I love the lake.").includes("claims-human"));
  assert.ok(rules("This morning my husband and I watched the ships.").includes("claims-human"));
  assert.ok(rules("No, I'm not a bot, I promise.").includes("denies-ai"));
  assert.ok(rules("Every word human-written.").includes("denies-ai"));
  assert.ok(rules("Thanks to @karen for the coffee.").includes("names-private-person"));
  assert.ok(rules("Please upvote if you liked it.").includes("breaks-platform-rules"));
  assert.ok(rules("Read it at https://elsewhere.example/x").includes("breaks-platform-rules"));
  assert.ok(rules("#a #b #c #d #e").includes("breaks-platform-rules"));
  assert.deepEqual(rules("June had not expected to feel anything about the bridge. Ice Out is at https://shop.example/ and https://testauthor.neocities.org/books/ice-out/."), []);
});

test("an assay that cannot be read withholds: the gate fails closed", async () => {
  assert.deepEqual(assayReasons("{\"withhold\": false, \"reasons\": []}"), []);
  assert.equal(assayReasons("Looks fine to me!")[0].rule, "assay-unreadable");
  assert.equal(assayReasons("{\"withhold\": true}")[0].rule, "unnamed-rule");
  const market = { chat: async () => { throw new Error("no capacity"); } };
  const verdict = await gate("The bridge went up at noon.", { persona: PERSONA, market });
  assert.equal(verdict.verdict, "withhold");
  assert.equal(verdict.reasons[0].rule, "assay-unreadable");
});

test("the assay holds her to each platform's own rules", async () => {
  const market = fakeMarket({ drafts: [] });
  await gate("The bridge went up at noon.", { persona: PERSONA, market, platformRules: { mastodon: ["A Content Warning must always be used for NSFW content."] } });
  const system = market.asked[0].messages[0].content;
  assert.match(system, /claims-human/u);
  assert.match(system, /mastodon:\n- A Content Warning must always be used/u);
});

test("a due note is drafted, gated, published at /notes/ on her site, recorded, and judged back to the market", async () => {
  const dir = await personaDir();
  const market = fakeMarket({ drafts: [JSON.stringify({ title: "Sea Smoke", body: "In January the lake steams.\n\nJune sees it from the back stairs." })] });
  const runs = [];
  const row = await tendNotes(dir, { market, publish: true, now: at("2026-10-02T20:00:00Z"), run: async (site, script) => (runs.push(script), { status: 0, said: "" }) });
  assert.deepEqual(row, { state: "published", id: "2026-10-02-sea-smoke", url: "https://testauthor.neocities.org/notes/2026-10-02-sea-smoke/" });
  assert.deepEqual(runs, ["publish"]);
  const page = await readFile(join(dir, "sites", "testauthor.neocities.org", "content", "notes", "2026-10-02-sea-smoke.md"), "utf8");
  assert.match(page, /^---\ntitle: "Sea Smoke"\ndate-created: 2026-10-02\n/u);
  assert.match(page, /In January the lake steams\.\n\nJune sees it from the back stairs\.\n$/u);
  const record = JSON.parse(await readFile(join(dir, "data", "records", "notes", "2026-10-02-sea-smoke.json"), "utf8"));
  assert.equal(record.gate.verdict, "pass");
  assert.match(record.voice.digest, /^sha256:/u);
  assert.deepEqual(market.judged.map(([, taskClass, outcome]) => [taskClass, outcome]), [["persona-note-draft", "accepted"], ["persona-speech-assay", "accepted"]]);

  const later = await tendNotes(dir, { market, publish: true, now: at("2026-10-03T20:00:00Z") });
  assert.deepEqual(later, { state: "not-due", next: "2026-10-04T20:00:00.000Z" });
});

test("a note claiming she is a real woman living in Duluth is withheld, with its reason recorded", async () => {
  const dir = await personaDir();
  const market = fakeMarket({ drafts: [JSON.stringify({ title: "Home", body: "I'm a real woman living in Duluth, and the lake is my whole life." })] });
  const row = await tendNotes(dir, { market, publish: true, now: at("2026-10-02T20:00:00Z"), run: async () => assert.fail("a withheld note is never published") });
  assert.equal(row.state, "withheld");
  assert.ok(row.reasons.some(({ rule, says }) => rule === "claims-human" && /real woman/u.test(says)));
  const record = JSON.parse(await readFile(join(dir, "data", "records", "notes", `${row.id}.json`), "utf8"));
  assert.equal(record.gate.verdict, "withhold");
  assert.ok(record.gate.reasons.some(({ rule }) => rule === "claims-human"));
  assert.equal(record.page, undefined);
  assert.deepEqual(await readdir(join(dir, "sites", "testauthor.neocities.org")), []);
  assert.equal(market.judged[0][2], "refused");
  // A withheld draft uses up its cadence: no second try at the same slot.
  assert.equal((await tendNotes(dir, { market, publish: true, now: at("2026-10-03T08:00:00Z") })).state, "not-due");
});

test("without publish nothing is asked or written; an undeclared persona has no notes", async () => {
  const dir = await personaDir();
  assert.deepEqual(await tendNotes(dir, { publish: false, now: at("2026-10-02T20:00:00Z") }), { state: "would-draft" });
  await writeFile(join(dir, "persona.json"), JSON.stringify({ ...PERSONA, notes: undefined }));
  assert.deepEqual(await tendNotes(dir, { publish: true }), { state: "no-notes" });
});

test("a delivery that is not a note is withheld, never guessed at", () => {
  assert.equal(readDraft("Here is a note about the lake."), null);
  assert.deepEqual(readDraft("```json\n{\"title\": \"“Ice\", \"body\": \"Out.\"}\n```"), { title: "Ice", body: "Out." });
  assert.equal(slugOf("Sea Smoke, in January!"), "sea-smoke-in-january");
  assert.match(notePage({ title: "A \"quoted\" title", body: "One.", date: "2026-10-02" }), /title: "A \\"quoted\\" title"/u);
});
