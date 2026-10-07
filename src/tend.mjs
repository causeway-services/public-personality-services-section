import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { entryPermlink } from "./channels.mjs";
import { playedBy } from "./cast.mjs";
import { readPersona } from "./persona.mjs";

/**
 * One turn of a persona's life on the web, after her accounts are made.
 *
 * - Out: each entry her site's feed published since `syndicate.since` is
 *   carried to every presence with a channel, oldest first, at most
 *   `perTurn` entries per platform per turn (a Hive account posts on
 *   resource credits, and nobody wants a backlog at once). What each copy
 *   became is recorded in data/records/syndication/<entry>.json, so an entry
 *   reaches each platform once. Without `publish`, the turn only says what
 *   it would post.
 * - In: what reached her on each platform since the last turn (replies,
 *   mentions, follows, boosts) is appended to data/records/inbox/<platform>.jsonl;
 *   the newest id read is where the next turn starts. Direct messages are
 *   recorded as having come, never what they said.
 *
 * Answering what came in is a separate act (answers.mjs), done in her voice
 * and under the same gate as her notes; this part of the turn never replies.
 */

const syndicationDir = (dir) => join(dir, "data", "records", "syndication");
const inboxPath = (dir, platform) => join(dir, "data", "records", "inbox", `${platform}.jsonl`);

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** The feed's entries published on or after `since`, oldest first. */
export async function feedEntries({ feed, since }, { fetch: fetchImpl = fetch } = {}) {
  const response = await fetchImpl(feed, { headers: { accept: "application/feed+json, application/json" } });
  if (!response.ok) throw new Error(`${feed}: ${response.status}`);
  const { items = [] } = await response.json();
  const from = since ? Date.parse(since) : -Infinity;
  return items
    .filter((item) => item.url && Date.parse(item.date_published ?? item.date_modified ?? 0) >= from)
    .sort((a, b) => Date.parse(a.date_published) - Date.parse(b.date_published));
}

/** The last id this platform's inbox recorded, where the next read starts. */
async function lastInboxId(dir, platform) {
  let lines;
  try { lines = (await readFile(inboxPath(dir, platform), "utf8")).trim().split("\n"); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  return lines.length && lines[0] ? JSON.parse(lines.at(-1)).id : null;
}

/**
 * What each platform she posts to says anything posted there must keep, by platform. A platform whose rules cannot
 * be read this turn is reported and left out; the gate's own rules still hold everything she says.
 */
export async function platformRulesOf(dir, channels, { only = null, notify = () => {} } = {}) {
  const persona = await readPersona(dir);
  const rules = {};
  for (const presence of persona.presences) {
    const channel = channels[presence.platform];
    if (!channel?.post || !channel.rules || (only && !only.includes(presence.platform))) continue;
    try { rules[presence.platform] = await channel.rules(presence); } catch (error) { notify(`${presence.platform}: rules: ${error.message}`); }
  }
  return rules;
}

export async function tendPersona(dir, { channels, cast, publish = false, only = null, perTurn = 1, fetch: fetchImpl = fetch, notify = () => {}, now = () => new Date() } = {}) {
  const persona = await readPersona(dir);
  const presences = persona.presences.filter((presence) => channels[presence.platform] && (!only || only.includes(presence.platform)));
  const context = { persona, dir };
  const out = [], inbox = [];

  if (persona.syndicate?.feed) {
    const entries = await feedEntries(persona.syndicate, { fetch: fetchImpl });
    const records = new Map();
    for (const entry of entries) records.set(entry, await readJson(join(syndicationDir(dir), `${entryPermlink(entry)}.json`)));
    for (const presence of presences) {
      const { platform } = presence;
      if (!channels[platform].post) continue;
      const due = entries.filter((entry) => !records.get(entry)?.copies?.[platform]).slice(0, perTurn);
      for (const entry of due) {
        const row = { platform, entry: entry.url };
        if (!publish) { out.push({ ...row, state: "would-post" }); continue; }
        try {
          const copy = await channels[platform].post(presence, entry, context);
          if (copy.waiting) { out.push({ ...row, state: "waits-on-account", waiting: copy.waiting }); break; }
          const record = records.get(entry) ?? { persona: persona.persona, entry: { id: entry.id, url: entry.url, title: entry.title, published: entry.date_published }, copies: {} };
          record.copies[platform] = { ...copy, ...playedBy(cast, platform), recordedAt: now().toISOString() };
          records.set(entry, record);
          await mkdir(syndicationDir(dir), { recursive: true });
          await writeFile(join(syndicationDir(dir), `${entryPermlink(entry)}.json`), `${JSON.stringify(record, null, 2)}\n`);
          out.push({ ...row, state: copy.state, url: copy.url });
        } catch (error) {
          notify(`${platform}: ${entry.url}: ${error.message}`);
          out.push({ ...row, error: error.message });
          break;
        }
      }
    }
  }

  for (const presence of presences) {
    const { platform } = presence;
    if (!channels[platform].read) continue;
    try {
      const rows = await channels[platform].read(presence, await lastInboxId(dir, platform), context);
      if (rows.waiting) { inbox.push({ platform, state: "waits-on-account", waiting: rows.waiting }); continue; }
      if (rows.length) {
        await mkdir(join(dir, "data", "records", "inbox"), { recursive: true });
        await appendFile(inboxPath(dir, platform), rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
      }
      inbox.push({ platform, arrived: rows.length, types: [...new Set(rows.map((row) => row.type))] });
    } catch (error) {
      notify(`${platform}: ${error.message}`);
      inbox.push({ platform, error: error.message });
    }
  }

  return { persona: persona.persona, publish, at: now().toISOString(), out, inbox };
}
