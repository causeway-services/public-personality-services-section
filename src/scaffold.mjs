import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * A new persona, written out so persona-provision and persona-tend can take her up: her section
 * (`services/<persona>-services-section/`) with its persona.json and README, and her author site
 * (`sites/<handle>.neocities.org/`), whose config and derived pages come from persona.json (author-site.mjs).
 *
 * Every name follows from her own: one handle for her Neocities site, her Hive account and (when one is asked
 * for) her Mastodon account and Buttondown newsletter, and an address on the house's mail domain, which the
 * house assigns, so no person picks it. Her mark is asked for by prompt and made on her first provisioning.
 * Nothing that exists is overwritten.
 */

export const HOUSE_MAIL_DOMAIN = "561.group";
const SITE_DEPENDENCIES = { "@red-cup-engineering/public-personality-services-section": "0.1.0", "@red-cup-engineering/static-site-publisher": "0.1.15" };
const SITE_DEV_DEPENDENCIES = { "@red-cup-engineering/neocities-services-section": "0.1.0" };

const SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
// One handle serves every platform: Hive's 3 to 16 lowercase characters, starting with a letter, are the narrowest.
const HANDLE = /^[a-z][a-z0-9]{2,15}$/u;

const words = (name) => name.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[a-z0-9]+/gu) ?? [];
const slugOf = (text) => words(text).join("-");

/** The handle and house address her name gives. */
export function namesFor(name) {
  const parts = words(name);
  return { handle: parts.join(""), address: `${parts.join(".")}@${HOUSE_MAIL_DOMAIN}` };
}

const defaultPrompt = (name, summary) => `A flat illustrated emblem for ${name}'s pen name, evoking: ${summary} Simple vector-style mark, bold clean shapes, a limited palette on a plain background. Non-figurative: no people, no faces, no figures, no text, no letters.`;

const page = ({ title, date, description, tags }, body) => `${[
  "---", `title: ${title}`, `date-created: ${date}`, "type: page", "status: active",
  `description: ${JSON.stringify(description)}`, "tags:", ...tags.map((tag) => `- ${tag}`), "---", "", body,
].join("\n")}\n`;

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The files of a new persona, by path under `root` (the section's `services/` directory). `mastodon` is
 * `{ server, reason }` when she is to have an account there (pick a server whose rules allow her);
 * `newsletter` gives her a Buttondown newsletter under her handle.
 */
export function personaFiles({ persona, name, summary, publisher = "Causeway Services", handle, mastodon = null, newsletter = false, avatarPrompt, creator = "group561", keys = "ssh:cold-red-gate", today }) {
  if (!SLUG.test(persona ?? "")) throw new TypeError(`a persona's id is lowercase words joined by hyphens, not ${JSON.stringify(persona)}`);
  if (!name?.trim() || !summary?.trim()) throw new TypeError("a persona needs a name and a summary");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(today ?? "")) throw new TypeError("today is an ISO date");
  const names = namesFor(name);
  handle ??= names.handle;
  if (!HANDLE.test(handle)) throw new TypeError(`${JSON.stringify(handle)} cannot be her handle on every platform: 3 to 16 lowercase letters and digits, starting with a letter (pass a shorter handle)`);
  if (mastodon && (!mastodon.server || !mastodon.reason)) throw new TypeError("a Mastodon presence names its server and the reason its moderators are given");
  const home = `https://${handle}.neocities.org/`;
  const host = `${handle}.neocities.org`;
  const section = `${persona}-services-section`;
  const site = join(section, "sites", host);
  const declaration = {
    persona, name, summary,
    disclosure: "A fictional author-character, created by the 561 Group and performed using AI.",
    discloseOn: [],
    home, publisher,
    avatar: { image: "avatar.jpg", prompt: avatarPrompt ?? defaultPrompt(name, summary) },
    email: { provider: "fastmail", prefer: [names.address] },
    presences: [
      { platform: "neocities", site: handle },
      { platform: "hive", account: handle, creator, keys, rc: { comments: 6, ceiling: 8000000000 } },
      ...(mastodon ? [{ platform: "mastodon", server: mastodon.server, username: handle, reason: mastodon.reason }] : []),
      ...(newsletter ? [{ platform: "buttondown", newsletter: handle }] : []),
    ],
  };
  const tag = slugOf(name);
  return new Map([
    [join(section, "persona.json"), json(declaration)],
    [join(section, "README.md"), `# ${name}\n\n${summary}\n\n${name} is a fictional author-character. The 561 Group created ${name} and performs the role using AI, and ${publisher} publishes the books. Public presences say how ${name} is made only where a platform's rules or the law require it (\`discloseOn\` in [persona.json](persona.json)). Nothing posted may claim to be human, and a sincere question about being AI is never denied.\n\n[\`persona.json\`](persona.json) declares the accounts, \`persona-provision\` keeps them and \`persona-tend\` gives the hourly turn (see the [section README](../../README.md)). Receipts are in \`data/records/presences/\`. The author site is [\`sites/${host}/\`](sites/${host}/).\n`],
    [join(site, "package.json"), json({
      name: `@${slugOf(publisher)}/${persona}-site`, version: "0.1.0", private: true, type: "module",
      description: `${name}'s author site at ${host}, built with VICTOR from persona.json and the house's records, and published to Neocities.`,
      dependencies: SITE_DEPENDENCIES, devDependencies: SITE_DEV_DEPENDENCIES,
      scripts: {
        derive: "author-site derive",
        "derive:check": "author-site derive --check",
        build: "author-site derive --check && rm -rf dist && static-site-publisher build content dist --config=./static-site-publisher.config.mjs",
        check: "author-site derive --check && static-site-publisher check content --config=./static-site-publisher.config.mjs",
        serve: "static-site-publisher serve content --port=8562 --config=./static-site-publisher.config.mjs",
        "publish:dry-run": "npm run build && neocities-publish . --dry-run",
        publish: "npm run build && neocities-publish .",
      },
      engines: { node: ">=22.18" },
    })],
    [join(site, "static-site-publisher.config.mjs"), "import { authorSiteConfig } from \"@red-cup-engineering/public-personality-services-section/author-site\";\n\n// Her name, summary and other presences come from persona.json.\nexport default authorSiteConfig(import.meta.dirname);\n"],
    [join(site, "neocities.json"), json({ sitename: handle, source: "dist", prune: true, receipts: "data/records/deployments", maxDelete: 100 })],
    [join(site, ".gitignore"), "dist/\nnode_modules/\ndist.report.json\n"],
    [join(site, "books.json"), json({ author: name, books: [] })],
    [join(site, "content", "home.md"), page({ title: name, date: today, description: summary, tags: [tag] }, `${summary}\n\n[About ${name}](/about/).`)],
    [join(site, "content", "about.md"), page({ title: `About ${name}`, date: today, description: `${name}, and how to reach ${publisher}.`, tags: [tag] }, `# The publisher\n\n${publisher}, the 561 Group's public imprint, publishes ${name}'s books and answers readers' letters at [shop.561.group](https://shop.561.group/).`)],
  ]);
}

/** Write a new persona's files under `root`; refuses if her section already has a persona.json. */
export async function scaffoldPersona(root, spec, { dryRun = false } = {}) {
  const files = personaFiles(spec);
  const declaration = [...files.keys()].find((path) => path.endsWith("persona.json"));
  if (existsSync(join(root, declaration))) throw new Error(`${join(root, declaration)} exists; a persona is scaffolded once`);
  const rows = [];
  for (const [path, text] of files) {
    const target = join(root, path);
    if (existsSync(target)) { rows.push({ path, state: "kept" }); continue; }
    if (!dryRun) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, text, { flag: "wx" });
    }
    rows.push({ path, state: dryRun ? "would-write" : "written" });
  }
  const persona = JSON.parse(files.get(declaration));
  return { persona: persona.persona, section: dirname(declaration), address: persona.email.prefer[0], handle: persona.presences[0].site, files: rows };
}
