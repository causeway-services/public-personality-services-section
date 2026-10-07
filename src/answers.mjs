import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gate, judged } from "./gate.mjs";
import { playedBy } from "./cast.mjs";
import { readPersona } from "./persona.mjs";

/**
 * Her answers: what she says back to whoever spoke to her in public.
 *
 * Each public reply or mention her inbox records (data/records/inbox/<platform>.jsonl) gets one decision, recorded
 * beside it in data/records/answers/<platform>/<inbox id>.json: an answer, or a deliberate pass with its reason. An
 * answer is drafted by the inference market in her voice (her notes' voice document), put through the same gate as
 * her notes, and posted where she was spoken to (a Hive comment under what was said, a Mastodon status in reply to
 * it). A record that holds a posted reply is never answered again, and what was said is answered once however many
 * entries name it (a Hive comment that mentions her is both a reply and a mention), so a retry cannot answer twice.
 *
 * Someone who asks what she is (a person, an AI) is answered with her `disclosure`, never with a draft: she does not
 * deny being AI when sincerely asked. A direct or followers-only message is never answered in public; the inbox
 * keeps only that it came, and its record says so.
 */

const answersDir = (dir, platform) => join(dir, "data", "records", "answers", platform);
const inboxPath = (dir, platform) => join(dir, "data", "records", "inbox", `${platform}.jsonl`);

/** The inbox entries that are someone speaking to her, by platform; follows, votes and boosts ask nothing. */
export const SPOKEN = Object.freeze({ mastodon: ["mention"], hive: ["reply", "reply_comment", "mention"] });

/** Whether someone is asking what she is: a person, a human, an AI, a bot. */
export const ASKS_NATURE = /\b(?:are|r)\s+(?:you|u)\s+(?:(?:an?|even|actually|really|a\s+real)\s+)*(?:ai|a\.i\.|bot|robot|chatbot|llm|machine|human|real|person|people|woman|computer)\b|\b(?:is|was)\s+(?:this|it|she|that)\s+(?:written\s+(?:by|with)\s+|made\s+(?:by|with)\s+|generated\s+(?:by|with)\s+)?(?:an?\s+)?(?:ai|a\.i\.|bot|chatgpt|llm)\b|\b(?:did|does)\s+(?:an?\s+)?(?:ai|chatgpt|llm|bot)\s+write\b|\bwho\s+(?:really\s+)?(?:writes|wrote)\s+(?:this|these|your)\b/iu;

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** Every entry of one platform's inbox, oldest first. */
export async function readInbox(dir, platform) {
  let lines;
  try { lines = (await readFile(inboxPath(dir, platform), "utf8")).split("\n").filter(Boolean); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return lines.map((line) => JSON.parse(line));
}

/** What an inbox entry is about: the status or post that was said. One comment can arrive as a reply and a mention. */
export const saidOf = (row) => row.statusId ?? row.url ?? row.id;

/** The key one answer is known by on every retry: a Mastodon idempotency key, a Hive permlink. */
export const answerKey = (persona, platform, row) => createHash("sha256").update(`${persona.persona}:${platform}:${saidOf(row)}`).digest("hex").slice(0, 24);

/** The request for one answer: her voice, what was said to her and by whom, and the one answer shape it may take. */
export function answerMessages({ persona, voice, heard, from, platform }) {
  return [
    {
      role: "system",
      content: [
        voice.trim(),
        `Now ${persona.name} is answering someone who spoke to her in public on ${platform}. Answer as she would: briefly (one to three sentences), in her voice, about what they said. She may thank, agree, add one concrete thing about the books or the lake, or say plainly where a book is.`,
        "Pass instead when no answer is owed: spam, abuse, provocation, or nothing addressed to her. Never address them by handle; the reply reaches them already.",
        "Answer with JSON only: {\"answer\": the reply text} or {\"pass\": why no answer is owed}.",
      ].join("\n\n"),
    },
    { role: "user", content: `${from ? `${from} said` : "Someone said"}:\n\n${heard}` },
  ];
}

/** The delivered decision as `{ answer }` or `{ pass }`, or null when it is neither. */
export function readDecision(text) {
  let parsed;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/gu, "")); } catch { return null; }
  if (typeof parsed?.answer === "string" && parsed.answer.trim()) return { answer: parsed.answer.trim() };
  if (typeof parsed?.pass === "string" && parsed.pass.trim()) return { pass: parsed.pass.trim() };
  return null;
}

/**
 * One turn of her answers. `channels` maps a platform to a channel with `heard(presence, row)` (what was said, or
 * null when it is gone) and `reply(presence, row, text, { key })` (where the answer now is). Answers at most `limit`
 * entries a turn, oldest first. Without `publish`, it only says which entries it would answer.
 */
export async function tendAnswers(dir, { channels, market, cast, publish = false, platformRules = {}, only = null, limit = 5, now = () => new Date() } = {}) {
  const persona = await readPersona(dir);
  const voice = persona.notes?.voice ? await readFile(join(dir, persona.notes.voice), "utf8") : `You write as ${persona.name}. ${persona.summary}`;
  const rows = [];
  let spent = 0;
  for (const presence of persona.presences) {
    const { platform } = presence;
    const channel = channels[platform];
    if (!SPOKEN[platform] || !channel?.reply || (only && !only.includes(platform))) continue;
    const decided = new Map();
    for (const entry of await readInbox(dir, platform)) {
      if (!SPOKEN[platform].includes(entry.type)) continue;
      const path = join(answersDir(dir, platform), `${entry.id}.json`);
      const before = await readJson(path);
      const first = decided.get(saidOf(entry));
      if (!first) decided.set(saidOf(entry), entry.id);
      if (before && (before.decision === "pass" || before.reply?.url)) continue;
      if (first) {
        if (!publish) continue;
        await mkdir(answersDir(dir, platform), { recursive: true });
        await writeFile(path, `${JSON.stringify({ persona: persona.persona, platform, ...playedBy(cast, platform), inbox: { id: entry.id, type: entry.type, at: entry.at, from: entry.from, url: entry.url }, decidedAt: now().toISOString(), decision: "pass", reason: `same as ${first}` }, null, 2)}\n`);
        rows.push({ platform, inbox: entry.id, state: "passed", reason: `same as ${first}` });
        continue;
      }
      if (spent >= limit) { rows.push({ platform, inbox: entry.id, state: "waits-for-next-turn" }); continue; }
      if (!publish) { rows.push({ platform, inbox: entry.id, state: "would-answer" }); continue; }
      spent += 1;
      try {
        const record = before ?? await decide({ persona, cast, voice, platform, presence, channel, entry, market, platformRules, now });
        if (record.decision === "answer" && !record.reply?.url) {
          try {
            record.reply = { ...(await channel.reply(presence, entry, record.answer, { key: answerKey(persona, platform, entry) })), at: now().toISOString() };
          } catch (error) {
            record.reply = { error: error.message, at: now().toISOString() };
          }
        }
        await mkdir(answersDir(dir, platform), { recursive: true });
        await writeFile(path, `${JSON.stringify(record, null, 2)}\n`);
        rows.push({ platform, inbox: entry.id, state: record.decision === "pass" ? "passed" : record.reply.url ? "answered" : "drafted", ...(record.reason ? { reason: record.reason } : {}), ...(record.reply?.url ? { url: record.reply.url } : {}), ...(record.reply?.error ? { error: record.reply.error } : {}) });
      } catch (error) {
        rows.push({ platform, inbox: entry.id, error: error.message });
      }
    }
  }
  return rows;
}

/** One inbox entry's decision, as its record: a pass with its reason, or a gated answer not yet posted. */
async function decide({ persona, cast, voice, platform, presence, channel, entry, market, platformRules, now }) {
  const record = { persona: persona.persona, platform, ...playedBy(cast, platform), inbox: { id: entry.id, type: entry.type, at: entry.at, from: entry.from, url: entry.url }, decidedAt: now().toISOString() };
  const pass = (reason, extra = {}) => ({ ...record, ...extra, decision: "pass", reason });
  if (entry.visibility && !["public", "unlisted"].includes(entry.visibility)) return pass(`private (${entry.visibility}): never answered in public`);
  const heard = await channel.heard(presence, entry);
  if (!heard) return pass("gone: what was said is no longer there");
  if (!market) throw new Error("an answer needs the inference market");

  let answer, draft = null, decision = null;
  if (ASKS_NATURE.test(heard)) {
    answer = persona.disclosure;
    if (!answer) throw new Error(`${persona.persona} is asked what she is but persona.json has no "disclosure"`);
  } else {
    const delivered = await market.chat({
      taskClass: "persona-answer-draft", objective: `Answer, in ${persona.name}'s voice, someone who spoke to her on ${platform}.`,
      messages: answerMessages({ persona, voice, heard, from: entry.from, platform }), json: true, temperature: 0.7,
    });
    draft = delivered.lot;
    decision = readDecision(delivered.text);
    if (!decision) {
      return pass("draft-unreadable", { delivered: delivered.text.slice(0, 2000), draft, judgements: { draft: await judged(market, draft, "refused", `persona-answer:${persona.persona}:${platform}:${entry.id}:unreadable`) } });
    }
    if (decision.pass) {
      return pass(decision.pass, { draft, judgements: { draft: await judged(market, draft, "accepted", `persona-answer:${persona.persona}:${platform}:${entry.id}:pass`) } });
    }
    answer = decision.answer;
  }

  const verdict = await gate(answer, { persona, sites: persona.links ?? [], platformRules: platformRules[platform] ? { [platform]: platformRules[platform] } : {}, market });
  const evidence = `persona-answer:${persona.persona}:${platform}:${entry.id}:${verdict.verdict}`;
  const judgements = {
    ...(draft ? { draft: await judged(market, draft, verdict.verdict === "pass" ? "accepted" : "refused", evidence) } : {}),
    ...(verdict.assay ? { assay: await judged(market, verdict.assay, verdict.assay.readable ? "accepted" : "refused", evidence) } : {}),
  };
  const said = { answer, ...(draft ? { draft } : { asked: "nature" }), gate: verdict, judgements };
  if (verdict.verdict !== "pass") return pass(`withheld: ${verdict.reasons.map(({ rule }) => rule).join(", ")}`, said);
  return { ...record, decision: "answer", ...said };
}
