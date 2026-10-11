import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readSiteReach } from "@red-cup-engineering/neocities-services-section";

/**
 * Her reach, read each turn. A persona's Neocities presence (data/records/presences/neocities.json) names her
 * site; the turn reads that site's public record once (no key) and appends one dated line to
 * data/records/reach/<site>.jsonl: {site, at, views, hits, updatedAt}. The file is only ever appended to; the
 * Group's acceptance readout folds it into the books (group-operations reach-readout).
 */

/** The Neocities sites her presences name. */
export function reachSitesOf(dir) {
  const path = join(dir, "data", "records", "presences", "neocities.json");
  if (!existsSync(path)) return [];
  const { platform, site } = JSON.parse(readFileSync(path, "utf8"));
  return platform === "neocities" && typeof site === "string" && site !== "" ? [site] : [];
}

/**
 * One turn of reading her sites' reach: a row per site, `read` (and recorded when `publish`, otherwise only
 * reported, as the rest of the turn is), `absent` when no site has that name, or an error. `read` is injected.
 */
// The Neocities client takes its network as a capability; the turn's is the process's own fetch.
const readReach = (site, options) => readSiteReach(site, { fetch, ...options });

export async function tendReach(dir, { publish = false, now = () => new Date(), read = readReach } = {}) {
  const rows = [];
  for (const site of reachSitesOf(dir)) {
    try {
      const reading = await read(site, { now });
      if (reading === null) { rows.push({ site, state: "absent" }); continue; }
      if (publish) {
        const directory = join(dir, "data", "records", "reach");
        mkdirSync(directory, { recursive: true });
        appendFileSync(join(directory, `${reading.site}.jsonl`), `${JSON.stringify(reading)}\n`);
      }
      rows.push({ site, state: publish ? "recorded" : "read", views: reading.views, hits: reading.hits });
    } catch (error) {
      rows.push({ site, error: error.message });
    }
  }
  return rows;
}
