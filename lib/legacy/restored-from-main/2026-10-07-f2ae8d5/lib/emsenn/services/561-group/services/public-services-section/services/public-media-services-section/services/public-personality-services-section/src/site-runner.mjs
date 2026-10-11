import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A persona's site is data (her content, books, receipts) in the working tree a job holds custody of; the code that
 * derives, builds and publishes it is the release's. The runner therefore never shells out to `npm run` inside the
 * site: that resolves the site's own node_modules, which the working tree's install keeps (stale or not), and the
 * turn then runs whatever that install happens to link. It runs the three scripts a site declares from this package's
 * release: `derive` and `derive:check` in-process, `publish` as the release's static-site-publisher (its cwd the
 * release, its config the release's scripts/author-site-config.mjs, the site named by AUTHOR_SITE_DIR) followed by the
 * release's neocities-publish. Only the site's files are written.
 */

const RELEASE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ERROR_LINE = /\b(?:[A-Za-z]+)?Error\b.*$/mu;

/** What a step said: the tail of its output, led by its first `Error` line when the tail does not hold it. */
export function said(text) {
  const lines = text.trim().split("\n");
  const tail = lines.slice(-3);
  const first = lines.find((line) => ERROR_LINE.test(line));
  return (first && !tail.includes(first) ? [first, ...tail] : tail).join("\n");
}

/** The first `Error` line of what a step said, or null. */
export const errorLine = (text) => text?.match(ERROR_LINE)?.[0].trim() ?? null;

const sibling = (specifier, path) => fileURLToPath(new URL(path, import.meta.resolve(specifier)));
const staticSitePublisher = () => sibling("@red-cup-engineering/static-site-publisher/build", "../scripts/static-site-publisher.mjs");
const neocitiesPublish = async () => (await import(sibling("@red-cup-engineering/neocities-services-section", "../scripts/neocities-publish.mjs"))).publish;

const inside = (child, parent) => { const path = relative(parent, child); return path === "" || (!path.startsWith("..") && !path.startsWith("/")); };

/**
 * A site-script runner `(site, script) => { status, said }` for refreshSites and tendNotes.
 * `workingTree` is the tree the job holds (NODE_JOB_WORKING_TREE): nothing is spawned with a cwd inside it.
 */
export function releaseSiteScript({
  release = RELEASE, workingTree = process.env.NODE_JOB_WORKING_TREE || null, spawn = spawnSync, env = process.env,
  derive = async (options) => (await import("./author-site.mjs")).deriveAuthorSite(options),
  publishToNeocities = async (args, options) => (await neocitiesPublish())(args, options),
  toolPath = staticSitePublisher,
} = {}) {
  const assertOutside = () => {
    if (workingTree && inside(release, resolve(workingTree))) throw new Error(`refusing to spawn with cwd ${release}: it is inside the working tree ${workingTree}`);
  };
  const spawned = (command, args, extra = {}) => {
    assertOutside();
    const result = spawn(command, args, { cwd: release, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...extra });
    if (result.error) throw result.error;
    return { status: result.status, said: said(`${result.stdout ?? ""}${result.stderr ?? ""}`) };
  };
  const deriving = async (site, check) => {
    const log = [];
    try { await derive({ site, check, log: (line) => log.push(line) }); return { status: 0, said: said(log.join("\n")) }; }
    catch (error) {
      // Status 1 says the pages are stale; 2 says deriving could not be done at all.
      return { status: check && /pages are stale/u.test(error.message) ? 1 : 2, said: said(`${error.name ?? "Error"}: ${error.message ?? error}`) };
    }
  };
  return async (site, script) => {
    site = resolve(site);
    if (script === "derive") return deriving(site, false);
    if (script === "derive:check") return deriving(site, true);
    if (script !== "publish") throw new Error(`a persona's site has no script ${script}`);
    assertOutside();
    const checked = await deriving(site, true);
    if (checked.status !== 0) return checked;
    await rm(join(site, "dist"), { recursive: true, force: true });
    const built = spawned(process.execPath, [toolPath(), "build", join(site, "content"), join(site, "dist"), `--config=${join(release, "scripts", "author-site-config.mjs")}`], { env: { ...env, AUTHOR_SITE_DIR: site } });
    if (built.status !== 0) return built;
    const out = [];
    try { await publishToNeocities([site], { output: { write: (text) => out.push(text) }, env }); return { status: 0, said: said(out.join("")) }; }
    catch (error) { return { status: 1, said: said(`${error.name ?? "Error"}: ${error.message ?? error}`) }; }
  };
}
