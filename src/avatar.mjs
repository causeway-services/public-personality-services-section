import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { generateImageWithReceipt } from "@red-cup-engineering/computer-inference-engine/media/generation-receipt";
import { imageProviders } from "@red-cup-engineering/google-flow-services-section/flow-generate";

/**
 * Her mark: one image, named in persona.json as `avatar: { image, prompt }`, that every presence shows. It is her
 * Mastodon avatar, her site's icon (her site's derive makes favicon.ico and apple-touch-icon.png from it and serves the
 * image itself as /avatar.<ext>), and her Hive profile image (that same file on her site, addressed by the mark's
 * version so a new mark is a new address). The site and Hive show the very bytes; Mastodon re-encodes what it is sent.
 *
 * When the image is not there yet and a prompt is, the mark is generated from the prompt by the house's
 * image generation (generateMark: a square Google Flow image, else Workers AI), and its generation receipt is recorded with the prompt in data/records/avatar/<version>.json.
 * A mark is never a photographic human face: the prompt asks for a non-figurative or illustrated emblem, and the
 * receipt keeps what was asked. A mark that exists is kept; generating another means removing the image first.
 */

/** Her mark from `prompt`, as `{ bytes, receipt }`: a square Google Flow image, else Workers AI. */
export const generateMark = (prompt) => generateImageWithReceipt(prompt, { providers: imageProviders({ consumer: "persona-marks", aspect: "1:1" }) });

const MIME_TYPES = Object.freeze({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" });

/** The path her site serves the mark at, unchanged (the site's derive copies it there); Hive's profile image is it. */
export const siteAvatar = (avatar) => `avatar${extname(avatar.image).toLowerCase()}`;

const receiptsDir = (dir) => join(dir, "data", "records", "avatar");

function declared(persona) {
  const { avatar } = persona;
  if (!avatar) return null;
  if (typeof avatar.image !== "string" || !MIME_TYPES[extname(avatar.image).toLowerCase()]) {
    throw new TypeError(`${persona.persona}'s "avatar" needs an "image" ending in ${Object.keys(MIME_TYPES).join(", ")}`);
  }
  return avatar;
}

/** The mark as its bytes and what it is known by, or null when persona.json names none or its image is not there. */
export async function readAvatar(dir, persona) {
  const avatar = declared(persona);
  if (!avatar) return null;
  let bytes;
  try { bytes = await readFile(join(dir, avatar.image)); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const hex = createHash("sha256").update(bytes).digest("hex");
  return Object.freeze({
    image: avatar.image, bytes, digest: `sha256:${hex}`, version: hex.slice(0, 12),
    mimeType: MIME_TYPES[extname(avatar.image).toLowerCase()], filename: basename(avatar.image),
  });
}

/** Where her site serves this mark: the same address for the same bytes, a new one for a new mark. */
export const avatarUrl = (persona, avatar) => new URL(`${siteAvatar(avatar)}?v=${avatar.version}`, persona.home).href;

/** Whether her site serves this very mark now. */
export async function siteServes(persona, avatar, { fetch: fetchImpl = fetch } = {}) {
  const response = await fetchImpl(avatarUrl(persona, avatar));
  if (!response.ok) return false;
  return `sha256:${createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex")}` === avatar.digest;
}

/**
 * Her mark, made when persona.json asks for one that is not there yet. `generate(prompt)` resolves to
 * `{ bytes, receipt }` (the inference engine's generateImageWithReceipt). Resolves to `{ state, avatar }`: `none`
 * (no mark asked for), `held`, `generated`, or `would-generate` on a dry run.
 */
export async function ensureAvatar(dir, persona, { generate = null, dryRun = false, now = () => new Date() } = {}) {
  const asked = declared(persona);
  if (!asked) return { state: "none", avatar: null };
  const held = await readAvatar(dir, persona);
  if (held) return { state: "held", avatar: held };
  if (typeof asked.prompt !== "string" || !asked.prompt.trim()) throw new Error(`${asked.image} is not there and ${persona.persona}'s "avatar" has no "prompt" to make it from`);
  if (dryRun) return { state: "would-generate", avatar: null };
  if (!generate) throw new Error(`${asked.image} is not there and nothing was given to generate it`);
  const { bytes, receipt } = await generate(asked.prompt);
  const wanted = MIME_TYPES[extname(asked.image).toLowerCase()];
  if (receipt?.output?.mimeType && receipt.output.mimeType !== wanted) throw new Error(`the generator made ${receipt.output.mimeType}, but ${asked.image} is ${wanted}`);
  await mkdir(dirname(join(dir, asked.image)), { recursive: true });
  await writeFile(join(dir, asked.image), bytes);
  const avatar = await readAvatar(dir, persona);
  await mkdir(receiptsDir(dir), { recursive: true });
  await writeFile(join(receiptsDir(dir), `${avatar.version}.json`), `${JSON.stringify({
    persona: persona.persona, image: avatar.image, digest: avatar.digest, prompt: asked.prompt, generatedAt: now().toISOString(), generation: receipt ?? null,
  }, null, 2)}\n`);
  return { state: "generated", avatar };
}
