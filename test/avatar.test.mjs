import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { avatarUrl, ensureAvatar, readAvatar, siteServes } from "../src/avatar.mjs";
import { profileFor, provisionPersona } from "../src/persona.mjs";

const PROMPT = "A flat illustrated emblem: a sprig of wild blueberry over a crescent of lake shore. No people, no faces, no text.";
const PERSONA = {
  persona: "test-author", name: "Test Author", summary: "Quiet books.", home: "https://testauthor.neocities.org/",
  avatar: { image: "avatar.jpg", prompt: PROMPT },
  presences: [{ platform: "hive", account: "testauthor" }, { platform: "mastodon", server: "mastodon.example", username: "testauthor" }],
};
const MARK = Buffer.from("not really a jpeg, but bytes");

const personaDir = async (persona = PERSONA) => {
  const dir = await mkdtemp(join(tmpdir(), "persona-avatar-"));
  await writeFile(join(dir, "persona.json"), JSON.stringify(persona));
  return dir;
};

function generator(bytes = MARK, mimeType = "image/jpeg") {
  const asked = [];
  return {
    asked,
    async generate(prompt) {
      asked.push(prompt);
      return { bytes, receipt: { id: "ni:///sha-256;receipt", type: "MediaInferenceReceipt", model: "@cf/black-forest-labs/flux-1-schnell", output: { mimeType } } };
    },
  };
}

test("a mark asked for and not there is generated once from its prompt, and the receipt keeps the prompt", async () => {
  const dir = await personaDir();
  const { asked, generate } = generator();
  const made = await ensureAvatar(dir, PERSONA, { generate, now: () => new Date("2026-10-03T00:00:00Z") });
  assert.equal(made.state, "generated");
  assert.deepEqual(asked, [PROMPT]);
  assert.deepEqual(await readFile(join(dir, "avatar.jpg")), MARK);
  const [name] = await readdir(join(dir, "data", "records", "avatar"));
  assert.equal(name, `${made.avatar.version}.json`);
  const receipt = JSON.parse(await readFile(join(dir, "data", "records", "avatar", name), "utf8"));
  assert.equal(receipt.prompt, PROMPT);
  assert.equal(receipt.digest, made.avatar.digest);
  assert.equal(receipt.generation.model, "@cf/black-forest-labs/flux-1-schnell");

  const again = await ensureAvatar(dir, PERSONA, { generate });
  assert.equal(again.state, "held");
  assert.equal(asked.length, 1);
  assert.equal(again.avatar.digest, made.avatar.digest);
});

test("a dry run generates nothing; a mark the generator makes in another format is refused; no mark asked is none", async () => {
  const dir = await personaDir();
  assert.deepEqual(await ensureAvatar(dir, PERSONA, { dryRun: true }), { state: "would-generate", avatar: null });
  await assert.rejects(ensureAvatar(dir, PERSONA, { generate: generator(MARK, "image/png").generate }), /made image\/png, but avatar\.jpg is image\/jpeg/u);
  await assert.rejects(ensureAvatar(dir, { ...PERSONA, avatar: { image: "avatar.jpg" } }, {}), /no "prompt"/u);
  assert.deepEqual(await ensureAvatar(dir, { ...PERSONA, avatar: undefined }), { state: "none", avatar: null });
});

test("her site's copy of the mark is addressed by its version, and is only taken as served when its bytes are the mark's", async () => {
  const dir = await personaDir();
  await writeFile(join(dir, "avatar.jpg"), MARK);
  const avatar = await readAvatar(dir, PERSONA);
  assert.equal(avatarUrl(PERSONA, avatar), `https://testauthor.neocities.org/avatar.jpg?v=${avatar.version}`);
  const serving = (bytes) => async (url) => (url === avatarUrl(PERSONA, avatar) && bytes ? new Response(bytes) : new Response("", { status: 404 }));
  assert.equal(await siteServes(PERSONA, avatar, { fetch: serving(MARK) }), true);
  assert.equal(await siteServes(PERSONA, avatar, { fetch: serving(Buffer.from("an older mark")) }), false);
  assert.equal(await siteServes(PERSONA, avatar, { fetch: serving(null) }), false);
  assert.equal(profileFor(PERSONA, PERSONA.presences[0], null, { image: avatarUrl(PERSONA, avatar) }).profile_image, avatarUrl(PERSONA, avatar));
  assert.equal("profile_image" in profileFor(PERSONA, PERSONA.presences[0]), false);
});

test("provisioning makes the mark before any presence, and every provider finds it", async () => {
  const dir = await personaDir();
  const seen = [];
  const provider = (platform) => async (presence, { avatar }) => (seen.push([platform, avatar?.digest]), { platform, state: "held" });
  const result = await provisionPersona(dir, { providers: { hive: provider("hive"), mastodon: provider("mastodon") }, generate: generator().generate });
  assert.equal(result.avatar.state, "generated");
  assert.match(result.avatar.digest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(seen, [["hive", result.avatar.digest], ["mastodon", result.avatar.digest]]);
  assert.equal((await provisionPersona(dir, { providers: { hive: provider("hive"), mastodon: provider("mastodon") } })).avatar.state, "held");
});
