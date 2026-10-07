import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ASKS_NATURE, readDecision, tendAnswers } from "../src/answers.mjs";

const PERSONA = {
  persona: "test-author", name: "Test Author", summary: "Quiet books.", home: "https://testauthor.neocities.org/",
  disclosure: "A fictional author-character: the 561 Group created her and performs her using AI.",
  notes: { voice: "voice.md", cadence: "P2D", site: "testauthor.neocities.org" },
  presences: [{ platform: "mastodon", server: "mastodon.example", username: "testauthor" }, { platform: "hive", account: "testauthor" }],
};

const INBOX = [
  { id: "101", type: "mention", at: "2026-10-02T10:00:00Z", from: "reader@elsewhere.example", statusId: "9001", url: "https://elsewhere.example/@reader/9001", visibility: "public", text: "@testauthor I loved the bridge scene in Ice Out." },
  { id: "102", type: "mention", at: "2026-10-02T11:00:00Z", from: "curious@elsewhere.example", statusId: "9002", url: "https://elsewhere.example/@curious/9002", visibility: "public", text: "@testauthor honest question, are you an AI?" },
  { id: "103", type: "mention", at: "2026-10-02T12:00:00Z", from: "friend@elsewhere.example", statusId: "9003", url: "https://elsewhere.example/@friend/9003", visibility: "direct" },
  { id: "104", type: "follow", at: "2026-10-02T13:00:00Z", from: "someone@elsewhere.example" },
];

const personaDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "persona-answers-"));
  await writeFile(join(dir, "persona.json"), JSON.stringify(PERSONA));
  await writeFile(join(dir, "voice.md"), "You write quietly about the lake.");
  await mkdir(join(dir, "data", "records", "inbox"), { recursive: true });
  await writeFile(join(dir, "data", "records", "inbox", "mastodon.jsonl"), INBOX.map((row) => `${JSON.stringify(row)}\n`).join(""));
  return dir;
};

function fakeMarket(drafts) {
  const asked = [], judged = [];
  return {
    asked, judged,
    async chat(request) {
      asked.push(request);
      const text = request.taskClass === "persona-answer-draft" ? drafts.shift() : "{\"withhold\": false, \"reasons\": []}";
      return { text, lot: { workLot: `urn:work-lot:${asked.length}`, taskClass: request.taskClass } };
    },
    async judge(lot, outcome) { judged.push([lot.taskClass, outcome]); },
  };
}

function fakeChannel() {
  const posted = [];
  return {
    posted,
    heard: async (presence, row) => row.text ?? null,
    async reply(presence, row, text, { key }) {
      posted.push({ to: row.statusId, text, key });
      return { url: `https://mastodon.example/@testauthor/${posted.length}`, id: String(posted.length), state: "posted" };
    },
  };
}

test("a public mention and a sincere 'are you an AI?' are answered under the gate; a direct message is never answered in public; a second turn answers nothing again", async () => {
  const dir = await personaDir();
  const mastodon = fakeChannel();
  const market = fakeMarket([JSON.stringify({ answer: "Thank you. The bridge was the first thing I put in." })]);
  const rows = await tendAnswers(dir, { channels: { mastodon }, market, publish: true });

  assert.deepEqual(rows.map(({ inbox, state }) => [inbox, state]), [["101", "answered"], ["102", "answered"], ["103", "passed"]]);
  assert.deepEqual(mastodon.posted.map(({ to }) => to), ["9001", "9002"]);
  assert.equal(mastodon.posted[0].text, "Thank you. The bridge was the first thing I put in.");
  // Asked what she is, she says it: her disclosure, never a draft.
  assert.equal(mastodon.posted[1].text, PERSONA.disclosure);
  assert.equal(market.asked.filter(({ taskClass }) => taskClass === "persona-answer-draft").length, 1);

  const records = Object.fromEntries(await Promise.all((await readdir(join(dir, "data", "records", "answers", "mastodon"))).map(async (name) => [name, JSON.parse(await readFile(join(dir, "data", "records", "answers", "mastodon", name), "utf8"))])));
  assert.equal(records["101.json"].gate.verdict, "pass");
  assert.equal(records["102.json"].gate.verdict, "pass");
  assert.equal(records["102.json"].asked, "nature");
  assert.equal(records["103.json"].decision, "pass");
  assert.match(records["103.json"].reason, /^private \(direct\)/u);
  assert.equal(records["103.json"].answer, undefined);
  assert.equal(records["104.json"], undefined);

  const again = await tendAnswers(dir, { channels: { mastodon }, market, publish: true });
  assert.deepEqual(again, []);
  assert.equal(mastodon.posted.length, 2);
});

test("an answer the gate withholds is a pass with its reason, and is never posted", async () => {
  const dir = await personaDir();
  await writeFile(join(dir, "data", "records", "inbox", "mastodon.jsonl"), `${JSON.stringify(INBOX[0])}\n`);
  const mastodon = fakeChannel();
  const market = fakeMarket([JSON.stringify({ answer: "Thanks! I live right by that bridge with my husband." })]);
  const [row] = await tendAnswers(dir, { channels: { mastodon }, market, publish: true });
  assert.equal(row.state, "passed");
  assert.match(row.reason, /^withheld: .*claims-human/u);
  assert.equal(mastodon.posted.length, 0);
  assert.deepEqual(market.judged[0], ["persona-answer-draft", "refused"]);
});

test("a reply that failed to post is retried with the same key, and the draft is not asked for again", async () => {
  const dir = await personaDir();
  await writeFile(join(dir, "data", "records", "inbox", "mastodon.jsonl"), `${JSON.stringify(INBOX[0])}\n`);
  const market = fakeMarket([JSON.stringify({ answer: "Thank you." })]);
  const failing = { ...fakeChannel(), reply: async () => { throw new Error("503"); } };
  assert.equal((await tendAnswers(dir, { channels: { mastodon: failing }, market, publish: true }))[0].state, "drafted");
  const mastodon = fakeChannel();
  assert.equal((await tendAnswers(dir, { channels: { mastodon }, market, publish: true }))[0].state, "answered");
  assert.equal(market.asked.filter(({ taskClass }) => taskClass === "persona-answer-draft").length, 1);
  assert.equal(mastodon.posted[0].text, "Thank you.");
});

test("one comment that arrives as a reply and a mention is answered once", async () => {
  const dir = await personaDir();
  const said = { from: "reader", url: "https://peakd.com/@reader/re-testauthor-x", text: "Did the bridge come first?" };
  await writeFile(join(dir, "data", "records", "inbox", "mastodon.jsonl"), [{ id: "1", type: "mention", ...said, statusId: "77" }, { id: "2", type: "mention", ...said, statusId: "77" }].map((row) => `${JSON.stringify(row)}\n`).join(""));
  const mastodon = fakeChannel();
  const rows = await tendAnswers(dir, { channels: { mastodon }, market: fakeMarket([JSON.stringify({ answer: "It did." })]), publish: true });
  assert.deepEqual(rows.map(({ state, reason }) => [state, reason]), [["answered", undefined], ["passed", "same as 1"]]);
  assert.equal(mastodon.posted.length, 1);
  assert.deepEqual(await tendAnswers(dir, { channels: { mastodon }, market: fakeMarket([]), publish: true }), []);
});

test("without publish nothing is asked or posted; the turn's answers are bounded", async () => {
  const dir = await personaDir();
  const rows = await tendAnswers(dir, { channels: { mastodon: fakeChannel() }, publish: false });
  assert.deepEqual(rows.map(({ state }) => state), ["would-answer", "would-answer", "would-answer"]);
  const bounded = await tendAnswers(dir, { channels: { mastodon: fakeChannel() }, market: fakeMarket([JSON.stringify({ pass: "nothing addressed to her" })]), publish: true, limit: 1 });
  assert.deepEqual(bounded.map(({ state }) => state), ["passed", "waits-for-next-turn", "waits-for-next-turn"]);
});

test("asking what she is is told apart from talk about the books", () => {
  for (const asked of ["are you an AI?", "Are you even a real person", "r u a bot", "Is this written by AI?", "did an AI write this", "who really writes these books?"]) assert.ok(ASKS_NATURE.test(asked), asked);
  for (const said of ["Are you writing another one?", "I loved the bridge.", "Is this the first in a series?", "Are you on Bluesky?"]) assert.ok(!ASKS_NATURE.test(said), said);
  assert.deepEqual(readDecision("{\"pass\": \"spam\"}"), { pass: "spam" });
  assert.equal(readDecision("Sure, here's a reply"), null);
});
