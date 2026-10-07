import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { errorLine, releaseSiteScript, said } from "../src/site-runner.mjs";
import { refreshSites } from "../src/sites.mjs";

const fixture = async () => {
  const tree = await mkdtemp(join(tmpdir(), "tend-tree-"));
  const release = await mkdtemp(join(tmpdir(), "tend-release-"));
  const site = join(tree, "persona", "sites", "her.example");
  await mkdir(site, { recursive: true });
  await writeFile(join(site, "package.json"), JSON.stringify({ scripts: { derive: "x", "derive:check": "x", publish: "x" } }));
  return { tree, release, site, persona: join(tree, "persona") };
};

test("no step of a turn spawns with a cwd inside the working tree, and the site is named, never entered", async () => {
  const { tree, release, site, persona } = await fixture();
  const spawns = [], published = [];
  const run = releaseSiteScript({
    release, workingTree: tree, env: {},
    derive: async ({ check }) => { if (check) throw new Error("pages are stale (run npm run derive): content/index.md"); },
    toolPath: () => join(release, "tool.mjs"),
    spawn: (command, args, options) => (spawns.push({ command, args, options }), { status: 0, stdout: "built", stderr: "" }),
    publishToNeocities: async (args) => { published.push(args); },
  });
  assert.equal((await run(site, "derive:check")).status, 1);
  assert.equal((await run(site, "derive")).status, 0);
  // publish re-checks the pages first; a stale site does not build.
  assert.equal((await run(site, "publish")).status, 1);
  const fresh = releaseSiteScript({
    release, workingTree: tree, env: {}, derive: async () => {}, toolPath: () => join(release, "tool.mjs"),
    spawn: (command, args, options) => (spawns.push({ command, args, options }), { status: 0, stdout: "built", stderr: "" }),
    publishToNeocities: async (args) => { published.push(args); },
  });
  assert.deepEqual(await fresh(site, "publish"), { status: 0, said: "" });
  assert.deepEqual(await refreshSites(persona, { run: fresh }), [{ site: "her.example", state: "current" }]);
  assert.equal(spawns.length, 1);
  for (const { options } of spawns) {
    assert.equal(options.cwd, release);
    assert.ok(!options.cwd.startsWith(tree), "cwd is under the working tree");
  }
  assert.equal(spawns[0].options.env.AUTHOR_SITE_DIR, site);
  assert.ok(spawns[0].args.includes(`--config=${join(release, "scripts", "author-site-config.mjs")}`));
  assert.deepEqual(published, [[site]]);
});

test("a release inside the working tree is refused rather than spawned from", async () => {
  const { tree, site } = await fixture();
  const run = releaseSiteScript({ release: join(tree, "release"), workingTree: tree, derive: async () => {}, spawn: () => assert.fail("spawned") });
  await assert.rejects(run(site, "publish"), /inside the working tree/u);
});

test("the first Error line survives in what a step said, and a crash is not a stale site", async () => {
  const noise = ["Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'x'", "    at a", "    at b", "    at c", "Node.js v24"].join("\n");
  assert.equal(said(noise).split("\n")[0], "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'x'");
  assert.equal(errorLine("derive failed: Error: boom\n    at x"), "Error: boom");
  assert.equal(errorLine("all fine"), null);
  const { release, site, persona } = await fixture();
  const crash = releaseSiteScript({ release, workingTree: null, derive: async () => { throw new Error("Cannot find package 'organizing'"); } });
  const rows = await refreshSites(persona, { publish: false, run: crash });
  assert.match(rows[0].error, /derive:check failed: Error: Cannot find package 'organizing'/u);
  assert.equal(errorLine(rows[0].error), "Error: Cannot find package 'organizing'");
  assert.ok(site);
});
