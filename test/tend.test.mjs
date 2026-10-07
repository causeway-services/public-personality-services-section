import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { entryPermlink, excerpt, hivePost, mastodonStatus } from "../src/channels.mjs";
import { tendPersona } from "../src/tend.mjs";

const FEED = "https://testauthor.neocities.org/feed.json";
const PERSONA = {
  persona: "test-author", name: "Test Author", summary: "Quiet books.", home: "https://testauthor.neocities.org/",
  syndicate: { feed: FEED, since: "2026-10-03" },
  presences: [
    { platform: "neocities", site: "testauthor" },
    { platform: "hive", account: "testauthor", tags: ["romance"] },
    { platform: "mastodon", server: "mastodon.example", username: "testauthor" },
  ],
};
const entry = (path, date, body = "<p>Short.</p>") => ({ id: `ni:///${path}`, url: `https://testauthor.neocities.org/${path}`, title: path, date_published: date, content_html: body, tags: ["notes"] });
const ITEMS = [entry("notes/second/", "2026-10-05T00:00:00Z"), entry("about/", "2026-09-30T00:00:00Z"), entry("notes/first/", "2026-10-04T00:00:00Z")];
const feedFetch = async (url) => (assert.equal(url, FEED), { ok: true, json: async () => ({ items: ITEMS }) });

const personaDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "persona-"));
  await writeFile(join(dir, "persona.json"), JSON.stringify(PERSONA));
  return dir;
};

function fakeChannels({ mastodonWaiting = null } = {}) {
  const posted = [], reads = [];
  const inbox = { hive: [{ id: "10", type: "reply", text: "@a replied to you" }, { id: "11", type: "follow", text: "@b followed you" }], mastodon: [] };
  const channel = (platform) => ({
    async post(presence, e) {
      if (platform === "mastodon" && mastodonWaiting) return { waiting: mastodonWaiting };
      posted.push([platform, e.url]);
      return { url: `https://${platform}.example/${entryPermlink(e)}`, state: "posted" };
    },
    async read(presence, since) {
      reads.push([platform, since]);
      if (platform === "mastodon" && mastodonWaiting) return { waiting: mastodonWaiting };
      return inbox[platform].filter((row) => !since || Number(row.id) > Number(since));
    },
  });
  return { posted, reads, channels: { hive: channel("hive"), mastodon: channel("mastodon") } };
}

test("only entries since the cutoff are carried, oldest first, one per platform per turn, each once", async () => {
  const dir = await personaDir();
  const { posted, channels } = fakeChannels();
  const turn = () => tendPersona(dir, { channels, publish: true, fetch: feedFetch });
  await turn();
  assert.deepEqual(posted, [["hive", ITEMS[2].url], ["mastodon", ITEMS[2].url]]);
  await turn(); await turn();
  assert.deepEqual(posted.map(([, url]) => url), [ITEMS[2].url, ITEMS[2].url, ITEMS[0].url, ITEMS[0].url]);
  const record = JSON.parse(await readFile(join(dir, "data/records/syndication/notes-first.json"), "utf8"));
  assert.deepEqual(Object.keys(record.copies), ["hive", "mastodon"]);
  assert.equal(record.entry.url, ITEMS[2].url);
});

test("without publish a turn only says what it would post", async () => {
  const dir = await personaDir();
  const { posted, channels } = fakeChannels();
  const { out } = await tendPersona(dir, { channels, fetch: feedFetch });
  assert.deepEqual(posted, []);
  assert.deepEqual(out.map((row) => [row.platform, row.state]), [["hive", "would-post"], ["mastodon", "would-post"]]);
});

test("a platform still waiting on its account is skipped and tried again next turn", async () => {
  const dir = await personaDir();
  const waiting = fakeChannels({ mastodonWaiting: "awaiting-approval" });
  const { out, inbox } = await tendPersona(dir, { channels: waiting.channels, publish: true, fetch: feedFetch });
  assert.deepEqual(out.find((row) => row.platform === "mastodon"), { platform: "mastodon", entry: ITEMS[2].url, state: "waits-on-account", waiting: "awaiting-approval" });
  assert.equal(inbox.find((row) => row.platform === "mastodon").state, "waits-on-account");
  const approved = fakeChannels();
  await tendPersona(dir, { channels: approved.channels, publish: true, fetch: feedFetch });
  assert.deepEqual(approved.posted, [["hive", ITEMS[0].url], ["mastodon", ITEMS[2].url]]);
});

test("the inbox records what arrived and the next turn reads on from there", async () => {
  const dir = await personaDir();
  const { reads, channels } = fakeChannels();
  const { inbox } = await tendPersona(dir, { channels, fetch: feedFetch });
  assert.deepEqual(inbox.find((row) => row.platform === "hive"), { platform: "hive", arrived: 2, types: ["reply", "follow"] });
  await tendPersona(dir, { channels, fetch: feedFetch });
  assert.deepEqual(reads.filter(([platform]) => platform === "hive"), [["hive", null], ["hive", "11"]]);
  const lines = (await readFile(join(dir, "data/records/inbox/hive.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);
});

test("platform forms: Hive gets the whole entry with the site as canonical, Mastodon a notice", () => {
  const e = entry("notes/ice/", "2026-10-04T00:00:00Z", `<p><img src="/covers/x.jpg" alt=""></p><p>${"The ice went out today. ".repeat(5)}</p><p><a href="/books/">Books</a></p>`);
  const post = hivePost(PERSONA, PERSONA.presences[1], e);
  assert.equal(post.permlink, "notes-ice");
  assert.deepEqual(post.tags, ["romance", "notes"]);
  assert.equal(post.json_metadata.canonical_url, e.url);
  assert.deepEqual(post.json_metadata.image, ["https://testauthor.neocities.org/covers/x.jpg"]);
  assert.match(post.body, /href="https:\/\/testauthor\.neocities\.org\/books\/"/u);
  assert.match(excerpt(e.content_html), /^The ice went out today\./u);
  assert.equal(mastodonStatus(e).split("\n\n").length, 3);
  assert.ok(mastodonStatus(e).endsWith(e.url));
});
