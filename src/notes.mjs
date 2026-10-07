import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gate, judged } from "./gate.mjs";
import { playedBy } from "./cast.mjs";
import { readPersona } from "./persona.mjs";
import { releaseSiteScript } from "./site-runner.mjs";

/**
 * Her notes: short pieces she says on her own site, in her voice, one per cadence.
 *
 * persona.json's `notes` names her voice document (`voice`, a path in her section), how often she speaks (`cadence`,
 * an ISO 8601 duration such as "P2D"), and the site that carries them (`site`, a directory under sites/). When the
 * cadence has run since her last draft, a turn asks the inference market for one note, puts it through the gate, and
 * then either publishes it at /notes/<date>-<slug>/ on that site or withholds it. Her feed then carries the note, and
 * a later turn syndicates it like anything else she publishes.
 *
 * Every draft, passed or withheld, is recorded in data/records/notes/<id>.json: what was asked, what came back, the
 * gate's verdict with its reasons, and where the page went. A withheld draft still uses up its cadence, so a bad
 * draft means a quiet spell, never a second try at the same slot. Each delivery is judged back to the market,
 * accepted when it passed and refused when it was withheld.
 */

const notesDir = (dir) => join(dir, "data", "records", "notes");
const DAY = 86_400_000;

/** An ISO 8601 duration of days and hours ("P2D", "PT12H", "P1DT6H") in milliseconds. */
export function cadenceMs(duration) {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?)?$/u.exec(duration ?? "");
  if (!match || (!match[1] && !match[2])) throw new TypeError(`notes.cadence must be an ISO 8601 duration of days and hours, like "P2D": ${duration}`);
  return Number(match[1] ?? 0) * DAY + Number(match[2] ?? 0) * 3_600_000;
}

/** Every note record, oldest first. */
export async function readNotes(dir) {
  let names;
  try { names = await readdir(notesDir(dir)); } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const notes = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => JSON.parse(await readFile(join(notesDir(dir), name), "utf8"))));
  return notes.sort((a, b) => Date.parse(a.draftedAt) - Date.parse(b.draftedAt));
}

/** When her next note is due: her last draft's time plus the cadence, or now if she has none. */
export const nextNoteAt = (notes, cadence, now) => (notes.length ? new Date(Date.parse(notes.at(-1).draftedAt) + cadenceMs(cadence)) : now);

export const slugOf = (title) => title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/gu, "").replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "").slice(0, 48).replace(/-$/u, "") || "note";

/** The request for one note: her voice document, what she said lately (so she does not repeat it), and the date. */
export function draftMessages({ persona, voice, recent = [], today }) {
  const lately = recent.length
    ? `What she said lately, so this note says something else:\n\n${recent.map(({ title, body }) => `${title}\n${body}`).join("\n\n---\n\n")}`
    : "This is her first note.";
  return [
    {
      role: "system",
      content: `${voice.trim()}\n\nWrite as ${persona.name}. Answer with JSON only: {"title": a short title, "body": the note, plain paragraphs, no headings, no lists, no hashtags, no links}.`,
    },
    { role: "user", content: `Today is ${today}. Write one note for her site.\n\n${lately}` },
  ];
}

/** The delivered note as `{ title, body }`, or null when it is not one. */
export function readDraft(text) {
  let parsed;
  try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/gu, "")); } catch { return null; }
  const title = typeof parsed?.title === "string" ? parsed.title.trim().replace(/^["“]|["”]$/gu, "") : "";
  const body = typeof parsed?.body === "string" ? parsed.body.trim() : "";
  return title && body ? { title, body } : null;
}

const yamlString = (value) => JSON.stringify(value);

/** The note as a page of her site: front matter her site's feed reads (date-created is the feed's date_published). */
export function notePage({ title, body, date }) {
  const description = body.split(/(?<=[.!?])\s/u)[0].slice(0, 200);
  return `---\ntitle: ${yamlString(title)}\ndate-created: ${date}\ntype: page\nstatus: active\ndescription: ${yamlString(description)}\ntags:\n- notes\n---\n\n${body.split(/\n{2,}/u).map((paragraph) => paragraph.replace(/\s*\n\s*/gu, " ").trim()).join("\n\n")}\n`;
}

const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

/**
 * One turn of her notes. Resolves to a row: `{ state: "no-notes" | "not-due" | "would-draft" | "published" |
 * "withheld" | "drafted", ... }`. Without `publish`, nothing is asked of the market and nothing is written.
 * `platformRules` is each destination platform's stated rules, which the gate holds the note to.
 */
export async function tendNotes(dir, { market, cast, publish = false, platformRules = {}, now = () => new Date(), run = releaseSiteScript() } = {}) {
  const persona = await readPersona(dir);
  if (!persona.notes) return { state: "no-notes" };
  const { voice: voicePath, cadence, site } = persona.notes;
  const at = now();
  const notes = await readNotes(dir);
  const next = nextNoteAt(notes, cadence, at);
  if (next > at) return { state: "not-due", next: next.toISOString() };
  if (!publish) return { state: "would-draft" };
  if (!market) throw new Error("a note needs the inference market");

  const voice = await readFile(join(dir, voicePath), "utf8");
  const today = at.toISOString().slice(0, 10);
  const recent = notes.filter(({ gate: verdict }) => verdict?.verdict === "pass").slice(-6).map(({ title, body }) => ({ title, body }));
  const { text, lot } = await market.chat({
    taskClass: "persona-note-draft", objective: `Draft one note for ${persona.name}'s site in her voice.`,
    messages: draftMessages({ persona, voice, recent, today }), json: true, temperature: 0.9,
  });
  const draft = readDraft(text);
  const id = `${today}-${slugOf(draft?.title ?? "unreadable")}`;
  const record = {
    persona: persona.persona, id, draftedAt: at.toISOString(),
    // Said through the site presence that hosts her notes.
    ...playedBy(cast, persona.presences.find((presence) => presence.site && (site === presence.site || site.startsWith(`${presence.site}.`)))?.platform),
    voice: { path: voicePath, digest: digest(voice) },
    ...(draft ?? { delivered: text.slice(0, 2000) }),
    draft: lot,
  };
  const verdict = draft
    ? await gate(`${draft.title}\n\n${draft.body}`, { persona, sites: persona.links ?? [], platformRules, market })
    : { verdict: "withhold", reasons: [{ rule: "draft-unreadable", says: "the delivery was not a note" }], assay: null };
  record.gate = verdict;
  const evidence = `persona-note:${persona.persona}:${id}:${verdict.verdict}`;
  record.judgements = {
    draft: await judged(market, lot, verdict.verdict === "pass" ? "accepted" : "refused", evidence),
    ...(verdict.assay ? { assay: await judged(market, verdict.assay, verdict.assay.readable ? "accepted" : "refused", evidence) } : {}),
  };

  let row = { state: "withheld", id, reasons: verdict.reasons };
  if (verdict.verdict === "pass") {
    const siteDir = join(dir, "sites", site);
    const path = join("content", "notes", `${id}.md`);
    await mkdir(join(siteDir, "content", "notes"), { recursive: true });
    await writeFile(join(siteDir, path), notePage({ ...draft, date: today }));
    record.page = { site, path, url: new URL(`notes/${id}/`, persona.home).href };
    const published = await run(siteDir, "publish");
    record.page = { ...record.page, ...(published.status === 0 ? { publishedAt: now().toISOString() } : { error: `publish failed: ${published.said}` }) };
    row = { state: published.status === 0 ? "published" : "drafted", id, url: record.page.url, ...(record.page.error ? { error: record.page.error } : {}) };
  }
  await mkdir(notesDir(dir), { recursive: true });
  await writeFile(join(notesDir(dir), `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
  return row;
}
