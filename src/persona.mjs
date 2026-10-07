import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureAvatar } from "./avatar.mjs";
import { LIVE_STATES, presenceUrl } from "./presence.mjs";

export { LIVE_STATES, presenceUrl };

/**
 * A persona is a directory with a persona.json: who she is (name, summary,
 * disclosure, home page, publisher), the email address her accounts are
 * registered with and her mail is sent from (in order of preference), and her
 * presences, one per platform account. Provisioning reconciles the address
 * first (made, and ready to send), then each presence through its
 * platform's provider, in the order given, and writes what it observed to
 * <persona>/data/records/presences/<platform>.json when that changed. Receipts hold public
 * facts only; passwords, keys and tokens stay in each platform's private
 * store on the node.
 *
 * Every public profile is derived from the identity, so a persona says the
 * same thing everywhere, and shows the same mark (`avatar`, see avatar.mjs),
 * made first when it is asked for and not there yet. How she is made (`disclosure`) is said only on the
 * platforms that require it, listed in `discloseOn`; elsewhere it is not.
 */

export async function readPersona(dir) {
  const persona = JSON.parse(await readFile(join(dir, "persona.json"), "utf8"));
  for (const key of ["persona", "name", "summary", "home"]) {
    if (typeof persona[key] !== "string" || !persona[key]) throw new TypeError(`${dir}/persona.json needs "${key}"`);
  }
  if (!Array.isArray(persona.presences)) throw new TypeError(`${dir}/persona.json needs "presences"`);
  persona.discloseOn ??= [];
  if (persona.discloseOn.length && !persona.disclosure) throw new TypeError(`${dir}/persona.json discloses on ${persona.discloseOn.join(", ")} but has no "disclosure"`);
  if (persona.notes && ["voice", "cadence", "site"].some((key) => typeof persona.notes[key] !== "string" || !persona.notes[key])) {
    throw new TypeError(`${dir}/persona.json "notes" needs "voice", "cadence" and "site"`);
  }
  return persona;
}

const receiptsDir = (dir) => join(dir, "data", "records", "presences");
const receiptKey = (presence) => presence.platform;

export async function readReceipt(dir, platform) {
  try {
    return JSON.parse(await readFile(join(receiptsDir(dir), `${platform}.json`), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeReceipt(dir, platform, receipt) {
  await mkdir(receiptsDir(dir), { recursive: true });
  const path = join(receiptsDir(dir), `${platform}.json`);
  await writeFile(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return path;
}

const PLATFORM_NAMES = { neocities: "Website", hive: "Hive", mastodon: "Mastodon", buttondown: "Newsletter" };

const discloses = (persona, presence) => (persona.discloseOn ?? []).includes(presence.platform);

/**
 * The profile each platform shows, from the persona's identity. It links her other presences only where they
 * exist (`live`, the platforms whose receipts are live), never one still waiting on an account: a link to a name
 * not yet registered is a dead link, and an open name anyone could take. `image` is the address of her mark where
 * a platform's profile takes one by address (Hive).
 */
export function profileFor(persona, presence, live = null, { image = null } = {}) {
  const disclose = discloses(persona, presence);
  switch (presence.platform) {
    case "hive":
      return { name: persona.name, about: disclose ? `${persona.summary} ${persona.disclosure}` : persona.summary, website: persona.home, ...(image ? { profile_image: image } : {}) };
    case "mastodon": {
      const fields = [{ name: "Website", value: persona.home }];
      for (const other of persona.presences) {
        const url = presenceUrl(other);
        if (other !== presence && other.platform !== "neocities" && url && (!live || live.has(other.platform))) fields.push({ name: PLATFORM_NAMES[other.platform] ?? other.platform, value: url });
      }
      if (persona.publisher) fields.push({ name: "Publisher", value: persona.publisher });
      return { display_name: persona.name, note: disclose ? `${persona.summary}\n\n${persona.disclosure}` : persona.summary, bot: disclose, fields: fields.slice(0, 4) };
    }
    case "buttondown":
      return { name: persona.name, description: disclose ? `${persona.summary} ${persona.disclosure}` : persona.summary, from_name: persona.name };
    default:
      return null;
  }
}

/**
 * Bring every presence (or those named in `only`) to what persona.json
 * declares. `providers` maps a platform to `(presence, context) => result`;
 * a provider's error stops that presence only, and is reported in its place.
 * Her mark comes before them all (made by `generate` when it is asked for and
 * not there), and each provider finds it as `context.avatar`.
 */
export async function provisionPersona(dir, { providers, generate = null, dryRun = false, only = null, notify = () => {}, now = () => new Date() } = {}) {
  const persona = await readPersona(dir);
  const live = new Set();
  for (const presence of persona.presences) if (LIVE_STATES.includes((await readReceipt(dir, receiptKey(presence)))?.state)) live.add(presence.platform);
  const mark = await ensureAvatar(dir, persona, { generate, dryRun, now });
  const context = { persona, dir, dryRun, notify, live, avatar: mark.avatar, readReceipt: (platform) => readReceipt(dir, platform), writeReceipt: (platform, receipt) => (dryRun ? null : writeReceipt(dir, platform, receipt)) };
  const results = [];
  // Her address comes first: the accounts after it are registered with it.
  const email = persona.email ? [{ platform: "email", ...persona.email }] : [];
  for (const presence of [...email, ...persona.presences]) {
    if (only && !only.includes(presence.platform)) continue;
    const provider = providers[presence.platform];
    if (!provider) { results.push({ platform: presence.platform, error: `no provider for ${presence.platform}` }); continue; }
    try {
      const result = await provider(presence, context);
      const receipt = { ...result, persona: persona.persona, observedAt: now().toISOString() };
      // observedAt is when the presence was last seen to change; an unchanged presence keeps its receipt.
      const before = await readReceipt(dir, receiptKey(presence));
      const changed = !before || JSON.stringify({ ...before, observedAt: null }) !== JSON.stringify({ ...receipt, observedAt: null });
      if (!dryRun && changed) await writeReceipt(dir, receiptKey(presence), receipt);
      if (LIVE_STATES.includes(receipt.state)) live.add(presence.platform); else live.delete(presence.platform);
      results.push(changed ? receipt : before);
    } catch (error) {
      notify(`${presence.platform}: ${error.message}`);
      results.push({ platform: presence.platform, error: error.message });
    }
  }
  const avatar = { state: mark.state, ...(mark.avatar ? { image: mark.avatar.image, digest: mark.avatar.digest } : {}) };
  return { persona: persona.persona, dryRun, avatar, results };
}
