/**
 * The gate everything a persona says in public passes before it is said: a note on her site, an answer to a reader.
 *
 * It withholds what would break the rules she keeps:
 *
 * - `claims-human`: she never claims to be a human, nor a human life (a body, a family, a home she lives in, a
 *   childhood). She is an author-character, so she speaks as one: about the books, their places and their people.
 * - `denies-ai`: she never denies being AI or made with it.
 * - `names-private-person`: she never names, addresses or describes a real private person. Characters in her books
 *   and public figures acting in public are not private persons.
 * - `breaks-platform-rules`: nothing breaks the rules of a platform it goes to, as that platform states them (a
 *   Mastodon server's own rules, Hive's norms), nor solicits votes or follows, nor carries links outside her own sites.
 *
 * The gate reads twice. Its own patterns catch the plain cases, and an assay (a second reader holding the same rules)
 * catches what patterns cannot, such as a note that implies a body without saying "I am". A draft passes only when
 * both pass it. An assay that cannot be read withholds, so the gate fails closed. Every withholding records its
 * reasons.
 */

export const GATE_RULES = Object.freeze([
  { id: "claims-human", says: "Never claim to be a human or to live a human life: no body, family, home, childhood, job or daily routine of her own." },
  { id: "denies-ai", says: "Never deny being AI or being made with AI, and never call the writing human-made." },
  { id: "names-private-person", says: "Never name, address or describe a real private person. Characters in her books and public figures acting in public are fine." },
  { id: "breaks-platform-rules", says: "Never break the rules of a platform it is posted to; never solicit votes, follows or reblogs; never link anywhere but her own sites." },
]);

const PATTERNS = Object.freeze({
  "claims-human": [
    /\b(?:real|actual|living|flesh[- ]and[- ]blood)\s+(?:woman|man|person|human|girl|lady|author|writer)\b/iu,
    /\bI(?:'m|’m| am)\s+(?:a\s+|an\s+)?(?:human|person|woman|mother|wife|grandmother|daughter|sister)\b/iu,
    /\bI\s+(?:live|lived|grew up|was born|was raised)\b/iu,
    /\b(?:living|born and raised)\s+in\s+[A-Z]/u,
    /\bmy\s+(?:husband|wife|partner|boyfriend|girlfriend|kids?|children|daughter|son|mom|mother|dad|father|grandmother|grandfather|body|apartment|house|hometown|childhood|day job)\b/iu,
  ],
  "denies-ai": [
    /\b(?:not|never|no|isn't|isn’t)\s+(?:an?\s+)?(?:ai|a\.i\.|bot|robot|chatbot|language model|llm)\b/iu,
    /\b(?:human[- ](?:written|made|authored)|written by a (?:real )?(?:human|person)|100% human|no ai)\b/iu,
  ],
  "names-private-person": [
    /(?:^|[\s(])@[a-z0-9_][a-z0-9_.-]*/iu,
    /\b[\w.+-]+@[\w-]+\.[\w.]+\b/u,
    /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/u,
  ],
  "breaks-platform-rules": [
    /\b(?:up-?vote|downvote|resteem|reblog this|boost this|follow (?:me|back)|f4f|follow for follow|vote for)\b/iu,
  ],
});

const HASHTAG_LIMIT = 4;

/** Her own sites: her home, and whatever `sites` adds (her publisher's shop). Links anywhere else are withheld. */
const ownHosts = (persona, sites = []) => new Set([persona.home, ...sites].filter(Boolean).map((url) => new URL(url).host));

/** The gate's own reading: one `{ rule, says }` reason for each pattern the text meets. */
export function patternReasons(text, { persona, sites = [] } = {}) {
  const reasons = [];
  for (const [rule, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) {
      const found = text.match(pattern);
      if (found) reasons.push({ rule, says: `“${found[0].trim()}”` });
    }
  }
  const hashtags = text.match(/(?:^|\s)#\w+/gu) ?? [];
  if (hashtags.length > HASHTAG_LIMIT) reasons.push({ rule: "breaks-platform-rules", says: `${hashtags.length} hashtags; at most ${HASHTAG_LIMIT}` });
  if (persona) {
    const hosts = ownHosts(persona, sites);
    for (const [url] of text.matchAll(/https?:\/\/[^\s<>()"]+/gu)) {
      let host = null;
      try { host = new URL(url).host; } catch { /* not a link */ }
      if (host && !hosts.has(host)) reasons.push({ rule: "breaks-platform-rules", says: `links outside her sites: ${url}` });
    }
  }
  return reasons;
}

/** The assay's instructions: the rules, each platform's own, and the one answer shape it may give. */
export function assayMessages(text, { persona, platformRules = {} }) {
  const platforms = Object.entries(platformRules).filter(([, rules]) => rules.length)
    .map(([platform, rules]) => `${platform}:\n${rules.map((rule) => `- ${rule}`).join("\n")}`).join("\n\n");
  return [
    {
      role: "system",
      content: [
        `You check text before ${persona.name} posts it. ${persona.name} is a fictional author-character; the text must not pretend otherwise and must keep these rules:`,
        GATE_RULES.map(({ id, says }) => `- ${id}: ${says}`).join("\n"),
        platforms ? `The platforms it goes to state these rules of their own, which count under breaks-platform-rules:\n\n${platforms}` : "",
        "Answer with JSON only: {\"withhold\": boolean, \"reasons\": [{\"rule\": one of the rule ids, \"says\": the words that break it}]}. Withhold only for a rule the text breaks; reasons is empty when it breaks none.",
      ].filter(Boolean).join("\n\n"),
    },
    { role: "user", content: text },
  ];
}

/** The assay's answer as reasons, or a reason of its own when the answer cannot be read (the gate fails closed). */
export function assayReasons(answer) {
  let parsed;
  try { parsed = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/gu, "")); } catch { return [{ rule: "assay-unreadable", says: answer.slice(0, 200) }]; }
  if (typeof parsed?.withhold !== "boolean") return [{ rule: "assay-unreadable", says: answer.slice(0, 200) }];
  if (!parsed.withhold) return [];
  const ids = new Set(GATE_RULES.map(({ id }) => id));
  const reasons = (Array.isArray(parsed.reasons) ? parsed.reasons : [])
    .map((reason) => ({ rule: ids.has(reason?.rule) ? reason.rule : "unnamed-rule", says: String(reason?.says ?? "").slice(0, 300) }));
  return reasons.length ? reasons : [{ rule: "unnamed-rule", says: "the assay withheld without naming a rule" }];
}

/**
 * Judges `text`. `market` is the inference market (`chat`, `judge`); without one, only the patterns read it.
 * Resolves to `{ verdict: "pass" | "withhold", reasons, assay }`, where `assay` is the lot the assay was delivered
 * under (judged accepted when its answer could be read).
 */
export async function gate(text, { persona, sites = [], platformRules = {}, market = null }) {
  const reasons = patternReasons(text, { persona, sites });
  let assay = null;
  if (market) {
    try {
      const { text: answer, lot } = await market.chat({
        taskClass: "persona-speech-assay", objective: `Check text before ${persona.name} posts it against the rules she keeps.`,
        messages: assayMessages(text, { persona, platformRules }), json: true, temperature: 0,
      });
      const found = assayReasons(answer);
      reasons.push(...found);
      assay = { ...lot, readable: !found.some(({ rule }) => rule === "assay-unreadable") };
    } catch (error) {
      reasons.push({ rule: "assay-unreadable", says: error.message });
    }
  }
  return { verdict: reasons.length ? "withhold" : "pass", reasons, assay };
}

/** Judges a delivery back to the market; a judgement that fails is recorded, never fatal to the turn. */
export async function judged(market, lot, outcome, evidence) {
  if (!lot) return null;
  try { await market.judge(lot, outcome, evidence); return { outcome, evidence }; } catch (error) { return { outcome, evidence, error: error.message }; }
}
