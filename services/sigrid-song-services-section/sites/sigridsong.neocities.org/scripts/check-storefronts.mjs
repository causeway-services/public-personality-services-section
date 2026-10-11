#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const site = resolve(import.meta.dirname, "..");
const normalizeUrl = (value) => new URL(value).href;

export function validateStorefronts(catalog, launches) {
  const problems = [];
  for (const entry of catalog.books ?? []) {
    if (!entry.launch) continue;
    const launch = launches.get(entry.launch);
    if (!launch) {
      problems.push(`${entry.manifest}: launch record ${entry.launch} is missing`);
      continue;
    }
    const active = new Map(
      (launch.channels ?? [])
        .filter((channel) => channel?.status === "active" && channel?.where)
        .map((channel) => [normalizeUrl(channel.where), channel.id ?? channel.where]),
    );
    const declared = new Map();
    for (const storefront of entry.storefronts ?? []) {
      if (!storefront?.name || !storefront?.url) {
        problems.push(`${entry.manifest}: every storefront needs name and url`);
        continue;
      }
      const url = normalizeUrl(storefront.url);
      if (declared.has(url)) problems.push(`${entry.manifest}: duplicate storefront ${url}`);
      declared.set(url, storefront.name);
      if (!active.has(url)) {
        problems.push(`${entry.manifest}: storefront ${storefront.name} (${url}) is not an active launch channel`);
      }
    }
    for (const [url, channel] of active) {
      if (!declared.has(url)) {
        problems.push(`${entry.manifest}: active launch channel ${channel} (${url}) is missing from books.json storefronts`);
      }
    }
  }
  return problems;
}

async function main() {
  const catalog = JSON.parse(await readFile(resolve(site, "books.json"), "utf8"));
  const launches = new Map();
  for (const entry of catalog.books ?? []) {
    if (!entry.launch || launches.has(entry.launch)) continue;
    launches.set(entry.launch, JSON.parse(await readFile(resolve(site, entry.launch), "utf8")));
  }
  const problems = validateStorefronts(catalog, launches);
  if (problems.length) throw new Error(`storefront consistency failed:\n- ${problems.join("\n- ")}`);
  console.log("storefront consistency ok");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main().catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  });
}
