#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { deriveAuthorSite } from "../src/author-site.mjs";

const USAGE = "usage: author-site derive [--check] [<site-dir>]\n"
  + "  Writes the pages, covers and icons a persona's author site (<persona>/sites/<host>/, the current directory\n"
  + "  by default) derives from the house's records: book pages from books.json, the newsletter and reader-team pages\n"
  + "  while her Buttondown presence is held, and her mark as the site's icons. --check writes nothing and fails if\n"
  + "  anything is stale.";

export async function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { check: { type: "boolean" } } });
  const [command, site = "."] = positionals;
  if (command !== "derive" || positionals.length > 2) throw new Error(USAGE);
  await deriveAuthorSite({ site: resolve(site), check: values.check });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message ?? error); process.exitCode = 1; }
}
