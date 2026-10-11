import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { reachSitesOf, tendReach } from "../src/reach.mjs";

const persona = async (presence) => {
  const dir = await mkdtemp(join(tmpdir(), "persona-reach-"));
  await mkdir(join(dir, "data", "records", "presences"), { recursive: true });
  if (presence) await writeFile(join(dir, "data", "records", "presences", "neocities.json"), JSON.stringify(presence));
  return dir;
};
const reading = (views) => ({ site: "sigridsong", at: "2026-10-04T12:00:00.000Z", views, hits: views * 2, updatedAt: null });

test("a presence on Neocities names the site whose reach is read; none names nothing", async () => {
  assert.deepEqual(reachSitesOf(await persona({ platform: "neocities", site: "sigridsong" })), ["sigridsong"]);
  assert.deepEqual(reachSitesOf(await persona()), []);
});

test("a publishing turn appends one line per reading and never rewrites; a dry turn only reports", async () => {
  const dir = await persona({ platform: "neocities", site: "sigridsong" });
  const file = join(dir, "data", "records", "reach", "sigridsong.jsonl");
  assert.deepEqual(await tendReach(dir, { read: async () => reading(1) }), [{ site: "sigridsong", state: "read", views: 1, hits: 2 }]);
  await assert.rejects(readFile(file));
  await tendReach(dir, { publish: true, read: async () => reading(1) });
  assert.deepEqual(await tendReach(dir, { publish: true, read: async () => reading(3) }), [{ site: "sigridsong", state: "recorded", views: 3, hits: 6 }]);
  assert.deepEqual((await readFile(file, "utf8")).trim().split("\n").map((line) => JSON.parse(line).views), [1, 3]);
});

test("an absent site and a failed read are her row's alone", async () => {
  const dir = await persona({ platform: "neocities", site: "sigridsong" });
  assert.deepEqual(await tendReach(dir, { publish: true, read: async () => null }), [{ site: "sigridsong", state: "absent" }]);
  assert.match((await tendReach(dir, { publish: true, read: async () => { throw new Error("boom"); } }))[0].error, /boom/u);
});
