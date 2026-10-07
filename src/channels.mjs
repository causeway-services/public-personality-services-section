import { createHash } from "node:crypto";
import { HiveClient } from "@red-cup-engineering/hive-blockchain-client-service";
import { titlePermlink } from "@red-cup-engineering/hive-blockchain-client-service/ops.mjs";
import { openVault } from "@red-cup-engineering/hive-account-provisioning-service/vault";
import { accountState, notifications, postStatus, serverRules } from "@red-cup-engineering/mastodon-services-section/api";
import { openCredentials } from "@red-cup-engineering/mastodon-services-section/credentials";

/**
 * Each platform as a channel the persona lives through once her account is
 * made: `post(presence, entry, context)` puts one of her site's entries on
 * the platform and returns where it now is; `read(presence, since, context)`
 * returns what reached her there after the `since` id, oldest first. A
 * channel that cannot act yet (an account still awaiting approval) answers
 * `{ waiting }` instead, and the turn moves on. `rules(presence)` is what the
 * platform says anything posted there must keep, which the gate holds her to.
 * `heard(presence, row)` is what an inbox entry said (null when it is gone),
 * and `reply(presence, row, text, { key })` answers it where it was said,
 * once per `key`.
 *
 * What is posted is what her site already published, in full on Hive (with
 * the site as its canonical address) and as a short notice on Mastodon.
 */

const APP = "561-group-persona/0.1";

/** Hive states no server rules; these are the norms its curators and its spam watchers hold posts to. */
export const HIVE_NORMS = Object.freeze([
  "Post only original work, and credit any source you use.",
  "Do not spam: no repeated or low-effort posts, and no off-topic tags.",
  "Do not ask for votes, follows or reblogs.",
]);
const text = (html) => html.replace(/<[^>]+>/gu, " ").replace(/&nbsp;/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/&quot;/gu, "\"").replace(/&#39;/gu, "'").replace(/\s+/gu, " ").trim();

/** The entry's HTML with its links and images made absolute, so it reads the same off the site. */
export function absoluteHtml(html, base) {
  return html.replace(/\b(href|src)="([^"]*)"/gu, (all, name, value) => {
    try { return `${name}="${new URL(value, base).href}"`; } catch { return all; }
  });
}

/** The first paragraph that says something (not an image, not a tagline), cut at a word to at most `max` characters. */
export function excerpt(html, max = 280) {
  const paragraphs = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/giu)].map(([, inner]) => text(inner)).filter(Boolean);
  const plain = paragraphs.find((paragraph) => paragraph.length >= 80) ?? paragraphs[0] ?? text(html);
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1).replace(/\s+\S*$/u, "")}…`;
}

/** An entry's Hive permlink: its address on the site, so the same entry always lands at the same post. */
export const entryPermlink = (entry) => titlePermlink(new URL(entry.url).pathname.replace(/^\/|\/$/gu, "") || "home");

/** The key a repeat of the same post is known by. */
export const entryKey = (entry) => createHash("sha256").update(entry.id ?? entry.url).digest("hex").slice(0, 32);

export function mastodonStatus(entry) {
  const lead = excerpt(entry.content_html ?? entry.summary ?? "", 400);
  return [entry.title, lead && lead !== entry.title ? lead : null, entry.url].filter(Boolean).join("\n\n");
}

export function hivePost(persona, presence, entry) {
  const tags = [...new Set([...(presence.tags ?? []), ...(entry.tags ?? [])].map(titlePermlink).filter(Boolean))].slice(0, 8);
  const image = (entry.content_html ?? "").match(/<img\b[^>]*\bsrc="([^"]+)"/iu)?.[1];
  const body = `${absoluteHtml(entry.content_html ?? "", entry.url)}\n\n<p><em>First published at <a href="${entry.url}">${new URL(persona.home).host}</a>.</em></p>`;
  return {
    title: entry.title, body, tags, permlink: entryPermlink(entry),
    json_metadata: { app: APP, format: "html", tags, canonical_url: entry.url, ...(image ? { image: [new URL(image, entry.url).href] } : {}) },
  };
}

export function channels({ fetch: fetchImpl = fetch, mastodonCredentials = openCredentials(), hive = (options) => new HiveClient(options), vault = openVault } = {}) {
  const mastodonToken = async (presence) => {
    const stored = await mastodonCredentials.read(presence.server, presence.username);
    if (!stored?.access_token) return { waiting: "no-account" };
    const { state } = await accountState(presence.server, stored.access_token, { fetch: fetchImpl });
    return state === "active" ? { token: stored.access_token } : { waiting: state };
  };

  return {
    hive: {
      rules: async () => HIVE_NORMS,
      async post(presence, entry, { persona }) {
        const post = hivePost(persona, presence, entry);
        const reader = hive({});
        const found = await reader.getContent(presence.account, post.permlink);
        const url = `https://peakd.com/@${presence.account}/${post.permlink}`;
        if (found?.author) return { url, permlink: post.permlink, at: `${found.created}Z`, state: "already-posted" };
        const posting = await vault(presence.keys).read(presence.account, "posting.wif");
        if (!posting) throw new Error(`the vault at ${presence.keys} holds no posting key for ${presence.account}`);
        const { id } = await hive({ account: presence.account, keys: { posting } }).post(post);
        return { url, permlink: post.permlink, tx: id, state: "posted" };
      },
      async heard(presence, row) {
        const [, author, permlink] = row.url?.match(/@([a-z0-9.-]+)\/([^/?#]+)/u) ?? [];
        if (!author) return null;
        const found = await hive({}).getContent(author, permlink);
        return found?.author ? text(found.body.replace(/!\[[^\]]*\]\([^)]*\)/gu, "")) : null;
      },
      async reply(presence, row, answer, { key }) {
        const [, parentAuthor, parentPermlink] = row.url.match(/@([a-z0-9.-]+)\/([^/?#]+)/u);
        const permlink = `re-${key}`;
        const url = `https://peakd.com/@${presence.account}/${permlink}`;
        const found = await hive({}).getContent(presence.account, permlink);
        if (found?.author) return { url, permlink, state: "already-posted" };
        const posting = await vault(presence.keys).read(presence.account, "posting.wif");
        if (!posting) throw new Error(`the vault at ${presence.keys} holds no posting key for ${presence.account}`);
        const { id } = await hive({ account: presence.account, keys: { posting } }).comment({ parentAuthor, parentPermlink, body: answer, permlink, json_metadata: { app: APP, format: "markdown" } });
        return { url, permlink, tx: id, state: "posted" };
      },
      async read(presence, since) {
        const rows = await hive({}).getAccountNotifications({ account: presence.account, limit: 100 });
        return rows
          .filter((row) => !since || BigInt(row.id) > BigInt(since))
          .map((row) => ({ id: row.id, type: row.type, at: `${row.date}Z`, from: row.msg.match(/^@([a-z0-9.-]+)/u)?.[1] ?? null, url: `https://peakd.com/${row.url}`, text: row.msg }))
          .reverse();
      },
    },

    mastodon: {
      rules: (presence) => serverRules(presence.server, { fetch: fetchImpl }),
      async post(presence, entry) {
        const { token, waiting } = await mastodonToken(presence);
        if (waiting) return { waiting };
        const posted = await postStatus(presence.server, token, { status: mastodonStatus(entry), idempotencyKey: entryKey(entry) }, { fetch: fetchImpl });
        return { url: posted.url, id: posted.id, at: posted.created_at, state: "posted" };
      },
      // Only a public or unlisted status keeps its words in the inbox; anything else was never hers to answer in public.
      heard: async (presence, row) => row.text ?? null,
      async reply(presence, row, answer, { key }) {
        if (!row.statusId) throw new Error(`inbox entry ${row.id} names no status to answer`);
        const { token, waiting } = await mastodonToken(presence);
        if (waiting) throw new Error(`the account waits: ${waiting}`);
        // Addressed to the one who spoke, so the reply reaches them; as visible as what they said, no more.
        const status = row.from ? `@${row.from} ${answer}` : answer;
        const posted = await postStatus(presence.server, token, { status, visibility: row.visibility === "unlisted" ? "unlisted" : "public", inReplyToId: row.statusId, idempotencyKey: key }, { fetch: fetchImpl });
        return { url: posted.url, id: posted.id, state: "posted" };
      },
      async read(presence, since) {
        const { token, waiting } = await mastodonToken(presence);
        if (waiting) return { waiting };
        const rows = await notifications(presence.server, token, { sinceId: since }, { fetch: fetchImpl });
        // A direct or followers-only message is recorded as having come, never what it said.
        return rows.map(({ status, ...row }) => ({
          ...row,
          ...(status ? { statusId: status.id, url: status.url, visibility: status.visibility, ...(["public", "unlisted"].includes(status.visibility) ? { text: text(status.content ?? "") } : {}) } : {}),
        }));
      },
    },
  };
}
