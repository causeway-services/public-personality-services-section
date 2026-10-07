import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { ADVANCE_READER_TAG, subscribePageUrl } from "@red-cup-engineering/buttondown-services-section";
import { LIVE_STATES, presenceUrl } from "./presence.mjs";

/**
 * A persona's author site: a VICTOR (static-site-publisher) site at <persona>/sites/<host>/, whose identity is her
 * persona.json and some of whose pages are derived from the house's records, so the site says what they say.
 *
 * - `authorSiteConfig(site)` is the site's static-site-publisher config, from persona.json: her name and summary,
 *   the home page's address, and her other presences in `discovery.me`, so each verifies the site as hers.
 * - `deriveAuthorSite({ site })` writes what is derived. Book pages come from each book's ebook.json; books.json
 *   names the manifests, the edition cover, the storefronts where the book is on sale and the book's launch plan.
 *   The newsletter and reader-team pages exist while her Buttondown presence is held (its receipt beside
 *   persona.json), and the reader-team page lists each launch plan's advance reading. The site's icons are her
 *   mark (persona.json `avatar`): the image itself at /avatar.<ext>, where her Hive profile points, and
 *   favicon.ico and apple-touch-icon.png, the addresses browsers ask for, made from it. `check` fails if a page or
 *   an icon is stale.
 */

const COVER_WIDTH = 600;
const FAVICON_SIZES = [16, 32, 48];
const TOUCH_ICON_SIZE = 180;
const ICON_FILES = ["favicon.ico", "apple-touch-icon.png"];
const NEWSLETTER_PAGES = ["newsletter", "reader-team"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** Presences that are not profiles of their own: the site itself, and a newsletter, which has no rel=me page. */
const NOT_PROFILES = new Set(["neocities", "buttondown"]);

const personaDirOf = (site) => resolve(site, "..", "..");
const yamlString = (value) => JSON.stringify(String(value));
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function repoRootOf(site) {
  for (let dir = site; dir !== dirname(dir); dir = dirname(dir)) if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
  throw new Error(`${site} is not inside the workspace`);
}

async function readJson(path) {
  return existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : null;
}

/** The static-site-publisher config of the author site at `site`, from its persona's persona.json. */
export function authorSiteConfig(site) {
  const persona = JSON.parse(readFileSync(join(personaDirOf(site), "persona.json"), "utf8"));
  const has = (path) => existsSync(join(site, path));
  const books = has("books.json") && JSON.parse(readFileSync(join(site, "books.json"), "utf8")).books?.length > 0;
  return {
    configVersion: 1,
    publicDir: "public",
    site: {
      name: persona.name,
      baseIri: persona.home,
      language: persona.language ?? "en-US",
      license: "All rights reserved",
      menu: [
        { label: "Home", href: "/" },
        ...(books ? [{ label: "Books", href: "/books/" }] : []),
        { label: "About", href: "/about/" },
        // persona-tend publishes her notes under content/notes/ (src/notes.mjs).
        ...(has("content/notes") ? [{ label: "Notes", href: "/notes/" }] : []),
        // deriveAuthorSite writes the newsletter page while her Buttondown newsletter is held.
        ...(has("content/newsletter.md") ? [{ label: "Newsletter", href: "/newsletter/" }] : []),
      ],
    },
    home: "home",
    discovery: { me: persona.presences.filter((presence) => !NOT_PROFILES.has(presence.platform)).map(presenceUrl).filter(Boolean) },
    archives: { pageSize: 12 },
    pwa: { manifest: { name: persona.name, shortName: persona.name, description: persona.summary } },
  };
}

function seriesLine(series) {
  if (!series) return null;
  const inner = `Book ${series.number} of the ${series.name}`;
  return series.within ? `${inner}, in the ${series.within.name} series.` : `${inner}.`;
}

/** A repository-relative path as published: the owner-directory prefix under lib/ names no one a page should. */
const publishedPath = (path) => path.replace(/^lib\/[^/]+\//u, "");

export function bookPage({ manifest, manifestPath, manifestDigest, storefronts, hasCover }) {
  const lines = [
    "---",
    `title: ${yamlString(manifest.title)}`,
    `date-created: ${manifest.date}`,
    "type: page",
    "status: active",
    `description: ${yamlString(manifest.subtitle ?? manifest.title)}`,
    "tags:",
    "- books",
    `- ${manifest.slug}`,
    "generated-by: author-site derive (edit the manifest or books.json, then run npm run derive)",
    `generated-from: ${yamlString(publishedPath(manifestPath))}`,
    `generated-from-digest: ${manifestDigest}`,
    "---",
    "",
  ];
  if (hasCover) lines.push(`![The cover of ${manifest.title} by ${manifest.author}](/covers/${manifest.slug}.jpg)`, "");
  if (manifest.subtitle) lines.push(`*${manifest.subtitle}*`, "");
  const series = seriesLine(manifest.series);
  if (series) lines.push(series, "");
  lines.push(manifest.description, "", "# Where to read it", "");
  if (storefronts.length) for (const store of storefronts) lines.push(`- [${store.name}](${store.url})`);
  else lines.push("Links to the stores will appear here as the book goes on sale.");
  // How a book was made is said where someone requires it (the book's own rights page, the stores' forms), not here.
  lines.push("", "# Who publishes it", "");
  lines.push(`${manifest.publisher ?? manifest.rights?.holder} publishes it.`);
  return `${lines.join("\n")}\n`;
}

const day = (iso) => { const [y, m, d] = iso.split("-").map(Number); return { y, m, d }; };
function span(opens, closes) {
  const [a, b] = [day(opens), day(closes)];
  const tail = `${b.d} ${MONTHS[b.m - 1]} ${b.y}`;
  if (a.y !== b.y) return `${a.d} ${MONTHS[a.m - 1]} ${a.y} to ${tail}`;
  return a.m === b.m ? `${a.d} to ${tail}` : `${a.d} ${MONTHS[a.m - 1]} to ${tail}`;
}

function frontMatter({ title, date, description, tags, from }) {
  return [
    "---", `title: ${yamlString(title)}`, `date-created: ${date}`, "type: page", "status: active",
    `description: ${yamlString(description)}`, "tags:", ...tags.map((tag) => `- ${tag}`),
    "generated-by: author-site derive (run npm run derive after persona-provision changes the newsletter)",
    `generated-from: ${yamlString(publishedPath(from))}`, "---", "",
  ];
}

export function newsletterPage({ author, newsletter, date, from }) {
  return `${[
    ...frontMatter({ title: "Newsletter", date, description: `Letters from ${author} when a book is coming.`, tags: ["newsletter"], from }),
    `${author} writes a letter when a book is coming: the day it goes on sale, where to find it, and now and then`,
    "a chapter early. Nothing else.",
    "",
    `[Subscribe to the newsletter](${subscribePageUrl({ newsletter })}).`,
    "",
    "Buttondown sends the letters. You confirm your address by email before the first one arrives, and every",
    "letter has a link to leave.",
    "",
    "# The reader team",
    "",
    `Readers who want ${author}'s new books early can also [join the reader team](/reader-team/).`,
  ].join("\n")}\n`;
}

export function readerTeamPage({ author, newsletter, date, from, readings }) {
  const lines = [
    ...frontMatter({ title: "Reader team", date, description: `Free early copies of ${author}'s new books.`, tags: ["newsletter", "reader-team"], from }),
    `${author} gives free copies of each new book to a team of readers who want them early. Each copy is made`,
    "for the one reader it is given to.",
    "",
    "# What it asks of you",
    "",
    "Nothing. A review is welcome and never required, and no copy depends on one. If you do post a review,",
    "please say that you received a free copy, and reply to the letter to say where it is. The copy is yours",
    "to read; please don't pass it on.",
    "",
    "# Readings",
    "",
  ];
  if (readings.length) for (const reading of readings) lines.push(`- [${reading.title}](/books/${reading.slug}/): copies go out ${span(reading.opens, reading.closes)}.`);
  else lines.push("No book is out to the team yet. The team hears first when one is.");
  lines.push(
    "", "# Joining", "",
    `[Join the reader team](${subscribePageUrl({ newsletter, tags: [ADVANCE_READER_TAG] })}). It subscribes you to the newsletter`,
    "too, with the same confirmation email. You can leave the team, the newsletter or both at any time.",
  );
  return `${lines.join("\n")}\n`;
}

/** Her Buttondown newsletter while its presence is held, from persona.json and its receipt. */
async function heldNewsletter(personaDir, repoRoot) {
  const persona = await readJson(join(personaDir, "persona.json"));
  const presence = persona?.presences?.find((p) => p.platform === "buttondown");
  if (!presence) return null;
  const receiptPath = join(personaDir, "data", "records", "presences", "buttondown.json");
  const receipt = await readJson(receiptPath);
  if (!receipt || !LIVE_STATES.includes(receipt.state)) return null;
  if (receipt.newsletter !== presence.newsletter) throw new Error(`the Buttondown receipt is for ${receipt.newsletter}, but persona.json declares ${presence.newsletter}`);
  return { newsletter: presence.newsletter, date: receipt.observedAt.slice(0, 10), from: relative(repoRoot, receiptPath) };
}

/** An ICO file holding each PNG as it is (the PNG-in-ICO form every current browser reads). */
export function icoOf(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, bytes }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size >= 256 ? 0 : size, entry); header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bytes.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  });
  return Buffer.concat([header, ...pngs.map(({ bytes }) => bytes)]);
}

/** The site's icon files from her mark, by their path under public/; none when she has no mark. */
async function iconFiles(personaDir) {
  const persona = await readJson(join(personaDir, "persona.json"));
  const image = persona?.avatar?.image ? join(personaDir, persona.avatar.image) : null;
  if (!image || !existsSync(image)) return new Map();
  const { default: sharp } = await import("sharp");
  const source = await readFile(image);
  const square = (size) => sharp(source).resize(size, size, { fit: "cover" }).png({ compressionLevel: 9 }).toBuffer();
  const pngs = await Promise.all(FAVICON_SIZES.map(async (size) => ({ size, bytes: await square(size) })));
  return new Map([
    [`avatar${extname(image).toLowerCase()}`, source],
    ["favicon.ico", icoOf(pngs)],
    ["apple-touch-icon.png", await square(TOUCH_ICON_SIZE)],
  ]);
}

async function webCover(source, target) {
  const { default: sharp } = await import("sharp");
  await sharp(source).resize({ width: COVER_WIDTH, withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toFile(target);
}

/** Write (or, with `check`, only find stale) what the author site at `site` derives from the house's records. */
export async function deriveAuthorSite({ site, check = false, log = console.log }) {
  const personaDir = personaDirOf(site);
  const repoRoot = repoRootOf(site);
  const catalog = (await readJson(join(site, "books.json"))) ?? { books: [] };
  const outputs = new Map();
  const readings = [];
  for (const entry of catalog.books) {
    const manifestFile = resolve(site, entry.manifest);
    const bytes = await readFile(manifestFile);
    const manifest = JSON.parse(bytes);
    if (manifest.author !== catalog.author) throw new Error(`${entry.manifest} is by ${manifest.author}, not ${catalog.author}`);
    const coverTarget = join(site, "public", "covers", `${manifest.slug}.jpg`);
    const coverSource = entry.cover ? resolve(site, entry.cover) : null;
    if (!check && coverSource && existsSync(coverSource)) {
      await mkdir(dirname(coverTarget), { recursive: true });
      await webCover(coverSource, coverTarget);
      log(`cover ${relative(site, coverTarget)} from ${entry.cover}`);
    }
    const hasCover = existsSync(coverTarget);
    const manifestPath = relative(repoRoot, manifestFile);
    outputs.set(join(site, "content", "books", `${manifest.slug}.md`), bookPage({
      manifest, manifestPath, manifestDigest: sha256(bytes), storefronts: entry.storefronts ?? [], hasCover,
    }));
    const launch = entry.launch ? await readJson(resolve(site, entry.launch)) : null;
    if (entry.launch && !launch) throw new Error(`${entry.launch} is missing`);
    const reading = launch?.advanceReading;
    if (reading?.opens && reading?.closes) readings.push({ title: manifest.title, slug: manifest.slug, opens: reading.opens, closes: reading.closes });
  }
  const held = await heldNewsletter(personaDir, repoRoot);
  const removals = [];
  for (const name of NEWSLETTER_PAGES) {
    const path = join(site, "content", `${name}.md`);
    if (!held) { if (existsSync(path)) removals.push(path); continue; }
    const input = { author: catalog.author, ...held, readings: readings.sort((a, b) => a.opens.localeCompare(b.opens)) };
    outputs.set(path, name === "newsletter" ? newsletterPage(input) : readerTeamPage(input));
  }
  const icons = await iconFiles(personaDir);
  for (const [name, bytes] of icons) outputs.set(join(site, "public", name), bytes);
  const published = existsSync(join(site, "public")) ? await readdir(join(site, "public")) : [];
  for (const name of published.filter((file) => ICON_FILES.includes(file) || /^avatar\.[a-z]+$/u.test(file))) {
    if (!icons.has(name)) removals.push(join(site, "public", name));
  }
  const stale = [];
  for (const [path, text] of outputs) {
    const current = existsSync(path) ? await readFile(path, Buffer.isBuffer(text) ? null : "utf8") : null;
    if (Buffer.isBuffer(text) ? current?.equals(text) : current === text) continue;
    if (check) stale.push(relative(site, path));
    else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
      log(`wrote ${relative(site, path)}`);
    }
  }
  for (const path of removals) {
    if (check) stale.push(relative(site, path));
    else { await rm(path); log(`removed ${relative(site, path)} (what it came from is gone)`); }
  }
  if (stale.length) throw new Error(`pages are stale (run npm run derive): ${stale.join(", ")}`);
}
