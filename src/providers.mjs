import { readySender, aliasStep } from "@red-cup-engineering/fastmail-services-section";
import { openCredentials as openMailCredentials } from "@red-cup-engineering/fastmail-services-section/credentials";
import { provisionHiveAccount } from "@red-cup-engineering/hive-account-provisioning-service";
import { openReplica, openVault } from "@red-cup-engineering/hive-account-provisioning-service/vault";
import { provisionNewsletter } from "@red-cup-engineering/buttondown-services-section/provision";
import { provisionMastodonAccount } from "@red-cup-engineering/mastodon-services-section";
import { openCredentials } from "@red-cup-engineering/mastodon-services-section/credentials";
import { publicSiteInfo } from "@red-cup-engineering/neocities-services-section";
import { provisionSite } from "@red-cup-engineering/neocities-services-section/site";
import { avatarUrl, siteServes } from "./avatar.mjs";
import { presenceUrl, profileFor } from "./persona.mjs";
import { HOUSE_MAIL_DOMAIN } from "./scaffold.mjs";
import { refreshSites } from "./sites.mjs";
import { errorLine } from "./site-runner.mjs";

/**
 * Each platform's provider, as provisionPersona calls them. `person` is the
 * human at the node (see person.mjs), or null when nobody is there; a step
 * that needs one then stops with the reason.
 */

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
const sink = { write() {} };

/** How each mail provider makes an address a person picks. */
const ALIAS_STEPS = { fastmail: aliasStep };

const onHouseDomain = (address) => address.toLowerCase().endsWith(`@${HOUSE_MAIL_DOMAIN}`);

/**
 * The persona's email address: the one already recorded; else her first
 * preference when it is on the house's own mail domain, which the house
 * assigns (readySender walks the alias into being when the account lacks
 * it); else one the person makes now from the persona's preferences, since a
 * provider's shared domain may not give the first. A person-made address is
 * recorded in presences/email.json; an assigned one is recorded by the email
 * presence that readies it.
 */
export async function personaAddress({ persona, readReceipt, writeReceipt, dryRun }, person) {
  const recorded = await readReceipt("email");
  if (recorded?.address) return recorded.address;
  const { provider, prefer = [] } = persona.email ?? {};
  if (!ALIAS_STEPS[provider] || prefer.length === 0) throw new Error(`${persona.persona} has no email address and persona.json names no provider and addresses to make one`);
  if (dryRun || onHouseDomain(prefer[0])) return prefer[0].toLowerCase(); // a dry run's stands in; it sends nothing
  if (!person) throw new Error(`${persona.persona} has no email address yet; making one needs a person at the node`);
  const address = await person.ask({
    text: ALIAS_STEPS[provider](persona.name, prefer),
    values: prefer.map((value, index) => ({ label: index === 0 ? "First choice" : "Then", value })),
    input: { label: "The address you made", pattern: new RegExp(`^(?:${prefer.map(escape).join("|")})$`, "iu") },
  });
  await writeReceipt("email", { platform: "email", provider, address: address.toLowerCase(), madeBy: "person", persona: persona.persona, observedAt: new Date().toISOString() });
  return address.toLowerCase();
}

/**
 * The address her accounts are registered with. An address a person made exists once they say so, as does one
 * on a provider's shared domain (only a person makes those); an assigned one exists once Fastmail sends as it (its
 * alias made, its identity held), and until then an account registered with it would never see its confirmation.
 * Resolves to `{ address }`, or `{ waits }`: the receipt row of a presence that waits on her address.
 */
export async function personaEmail(context, person) {
  const address = await personaAddress(context, person);
  if (context.dryRun || !onHouseDomain(address)) return { address };
  const recorded = await context.readReceipt("email");
  if (recorded?.address === address && (recorded.madeBy === "person" || recorded.state === "sends")) return { address };
  return { waits: { state: "waits-on-email", address, step: recorded?.step ?? "email" } };
}

export function providers({ person = null, fetch: fetchImpl = fetch, mastodonCredentials = openCredentials(), mailCredentials = openMailCredentials(), browser = {} } = {}) {
  return {
    /** Her address, and whether the house can send as her from it. */
    async email(presence, context) {
      const address = await personaAddress(context, person);
      const madeBy = (await context.readReceipt("email"))?.madeBy;
      const row = { platform: "email", provider: presence.provider, address, ...(madeBy ? { madeBy } : {}) };
      if (context.dryRun) return { ...row, state: "unchecked" };
      const ready = await readySender({ address, name: context.persona.name, person, credentials: mailCredentials, fetch: fetchImpl });
      return ready.state === "ready" ? { ...row, state: "sends", identity: ready.identity.id } : { ...row, state: ready.state, step: ready.step };
    },

    /** Her site: the Neocities site made, and what it derives from the house's records (her mark among them) current. */
    async neocities(presence, { dir, dryRun, notify }) {
      const url = presenceUrl(presence);
      if (dryRun) return { platform: "neocities", site: presence.site, url, state: (await publicSiteInfo({ fetch: fetchImpl, sitename: presence.site })) ? "exists" : "would-create" };
      const done = await provisionSite([presence.site], { fetch: fetchImpl, notify, output: sink, browser });
      const [page] = (await refreshSites(dir, { publish: true })).filter((row) => row.site === new URL(url).host);
      if (page?.error) notify(`neocities: ${page.site}: ${page.error}`);
      return { platform: "neocities", site: presence.site, url, state: done.created ? "created" : "held", ...(page ? { pages: page.error ? "error" : page.state, ...(page.error ? { pagesError: errorLine(page.error) } : {}) } : {}) };
    },

    /** Her Hive account; its profile image is her mark where her site serves it, never an address that is not there yet. */
    async hive(presence, { persona, dryRun, notify, live, avatar }) {
      const image = avatar && await siteServes(persona, avatar, { fetch: fetchImpl }) ? avatarUrl(persona, avatar) : null;
      if (avatar && !image) notify(`hive: ${persona.home} does not serve ${avatar.image} yet; the profile keeps no image until it does`);
      return provisionHiveAccount({
        account: presence.account, creator: presence.creator, profile: profileFor(persona, presence, live, { image }),
        vault: openVault(presence.keys), replica: await openReplica(), rc: presence.rc ?? null, dryRun, notify,
      });
    },

    /** Her newsletter: the Buttondown account under the routing name, its key held, replies coming to her address. */
    async buttondown(presence, context) {
      const { address: email, waits } = await personaEmail(context, person);
      if (waits) return { platform: "buttondown", newsletter: presence.newsletter, ...waits };
      return provisionNewsletter({
        newsletter: presence.newsletter, email, profile: { ...profileFor(context.persona, presence, context.live), reply_to_address: email },
        person, fetch: fetchImpl, dryRun: context.dryRun,
      });
    },

    async mastodon(presence, context) {
      const stored = await mastodonCredentials.read(presence.server, presence.username);
      const { address: email, waits } = stored ? { address: stored.email } : await personaEmail(context, person);
      if (waits) return { platform: "mastodon", server: presence.server, username: presence.username, ...waits };
      return provisionMastodonAccount({
        server: presence.server, username: presence.username, email, reason: presence.reason,
        profile: profileFor(context.persona, presence, context.live), dryRun: context.dryRun,
        avatar: context.avatar, heldAvatar: (await context.readReceipt("mastodon"))?.avatar ?? null,
        credentials: mastodonCredentials, person, fetch: fetchImpl, notify: context.notify,
      });
    },
  };
}
