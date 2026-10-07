import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { releaseSiteScript } from "./site-runner.mjs";

/**
 * Her sites say what the house's records say. A site under <persona>/sites/ whose package.json has `derive` and
 * `derive:check` scripts derives some pages from records outside its content (book manifests, launch plans, her
 * presence receipts). When `derive:check` finds them stale, a publishing turn runs `derive` and then `publish`, so a
 * presence that changes (a newsletter that now exists) reaches her site in the same turn.
 */

/** Each site of the persona that derives pages. */
export function derivedSites(dir) {
  const root = join(dir, "sites");
  if (!existsSync(root)) return [];
  return readdirSync(root).map((name) => join(root, name)).filter((site) => {
    const manifest = join(site, "package.json");
    if (!existsSync(manifest)) return false;
    const { scripts = {} } = JSON.parse(readFileSync(manifest, "utf8"));
    return Boolean(scripts.derive && scripts["derive:check"] && scripts.publish);
  }).sort();
}

/**
 * One turn over her sites: `current` when nothing is stale, `would-republish` without publish, `republished` after
 * deriving and publishing, or an error naming the step that failed.
 */
export async function refreshSites(dir, { publish = false, run = releaseSiteScript() } = {}) {
  const rows = [];
  for (const site of derivedSites(dir)) {
    const row = { site: site.slice(join(dir, "sites").length + 1) };
    try {
      const checked = await run(site, "derive:check");
      if (checked.status === 0) { rows.push({ ...row, state: "current" }); continue; }
      if (checked.status === 2) throw new Error(`derive:check failed: ${checked.said}`);
      if (!publish) { rows.push({ ...row, state: "would-republish" }); continue; }
      for (const script of ["derive", "publish"]) {
        const step = await run(site, script);
        if (step.status !== 0) throw new Error(`${script} failed: ${step.said}`);
      }
      rows.push({ ...row, state: "republished" });
    } catch (error) {
      rows.push({ ...row, error: error.message });
    }
  }
  return rows;
}
