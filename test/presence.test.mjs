import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LIVE_STATES, presenceUrl } from "../src/presence.mjs";

const source = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("a presence's address and live states", () => {
  assert.equal(presenceUrl({ platform: "neocities", site: "x" }), "https://x.neocities.org/");
  assert.equal(presenceUrl({ platform: "email" }), null);
  assert.deepEqual([...LIVE_STATES], ["held", "created"]);
});

test("the author site's derivation does not load the provisioning stack", () => {
  // A site build runs from the working tree, whose installed packages may trail the code: it was failing every
  // tend turn on a package persona.mjs reaches through her mark (inference, image generation). It needs only
  // what a presence is.
  assert.doesNotMatch(source("author-site.mjs"), /from "\.\/(persona|avatar|providers)\.mjs"/u);
  assert.doesNotMatch(source("presence.mjs"), /^import .* from "(?!node:)/mu);
  assert.match(source("persona.mjs"), /export \{ LIVE_STATES, presenceUrl \}/u);
});
