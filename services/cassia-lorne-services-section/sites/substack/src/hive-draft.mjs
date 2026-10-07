// Stage 3 of the diviner cycle: a Hive draft, never a broadcast.
//
// Aagaard (the Hive wallet-fleet enterprise) presently locks posting
// categorically -- its own Hive write boundary implements only voting,
// trading, liquidity, savings, and incentive actions, by design (see
// hiveWrite.adapter.ts's IncentiveActionKind exclusion of "comment"/"post").
// This is not a missing credential; it is a capability aagaard has not
// grown yet. Extending aagaard's own scope is a decision for that
// settlement, not this script.
//
// So: this stage produces a waggle-shaped post payload
// (@561-group/waggle's `post({ title, body, tags, permlink })`) and writes
// it to backstage/hive-drafts/<date>.json as a plain, inert record. It
// broadcasts nothing. A human reviews the file and either runs waggle's own
// CLI/library against it once ready, or asks for the broadcast path to be
// wired properly first. This is the "scheduled or draft post I can
// manually flip" surface asked for -- never an auto-post.
//
// Known gap, stated rather than hidden: Hive does not carry inline image
// bytes. A post's image must be uploaded to an image host (conventionally
// https://images.hive.blog) and referenced by URL; that upload is not
// wired here, so the draft's body references the local image path with a
// TODO marker instead of a live URL.
//
// Run: pnpm run divine:hive-draft [-- YYYY-MM-DD]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { createHivePostDraft } from "@red-cup-engineering/create-hive-post-draft-service";
import { decodeFrontMatterDocument } from "./frontmatter.mjs";
import { dateArgument, PROPERTY_ROOT } from "./config.mjs";

function imageExtension(mimeType) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return "jpg";
  return "img";
}

/** Resolve the exact image stage 1 recorded, retaining JPEG output from before metadata was read here. */
export function generatedImagePath(imagesRoot, dateIso) {
  const metadataPath = join(imagesRoot, `${dateIso}.json`);
  if (existsSync(metadataPath)) {
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
    const path = join(imagesRoot, `${dateIso}.${imageExtension(metadata.mimeType)}`);
    return existsSync(path) ? path : undefined;
  }
  const retainedJpeg = join(imagesRoot, `${dateIso}.jpg`);
  return existsSync(retainedJpeg) ? retainedJpeg : undefined;
}

export function buildHiveDraft(dateIso, documentText, imagePath) {
  const doc = decodeFrontMatterDocument(documentText);
  const title = String(doc.frontMatter.title ?? `Routine Read — ${dateIso}`);
  return createHivePostDraft({ account: "cassia-lorne", title, body: doc.body, tags: ["divination", "tarot", "astrology", "hive"], dateIso, ...(imagePath ? { imagePath } : {}) });
}

async function main() {
  const argv = process.argv.slice(2);
  const dateIso = dateArgument(argv);

  const publishedPath = join(PROPERTY_ROOT, "content", `${dateIso}.md`);
  const withheldPath = join(PROPERTY_ROOT, "backstage", "withheld", `${dateIso}.md`);
  const documentPath = existsSync(publishedPath) ? publishedPath : withheldPath;
  if (!existsSync(documentPath)) {
    throw new Error(`no read found for ${dateIso} at ${publishedPath} or ${withheldPath} -- run divine:read first`);
  }
  if (documentPath === withheldPath) {
    console.error(`warning: ${dateIso}'s read was withheld by the publish gates; drafting from it anyway for review, not for posting as-is`);
  }

  const imagePath = generatedImagePath(join(PROPERTY_ROOT, "backstage", "images"), dateIso);
  const draft = buildHiveDraft(dateIso, readFileSync(documentPath, "utf8"), imagePath);

  const draftPath = join(PROPERTY_ROOT, "backstage", "hive-drafts", `${dateIso}.json`);
  mkdirSync(join(PROPERTY_ROOT, "backstage", "hive-drafts"), { recursive: true });
  writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`);
  console.log(`hive draft (awaiting manual approval) → ${draftPath}`);
  if (draft.imageUploadRequired) {
    console.log(`  image still needs manual upload: ${draft.imagePath}`);
  }
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
