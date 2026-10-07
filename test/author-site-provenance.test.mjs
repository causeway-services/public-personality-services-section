import assert from "node:assert/strict";
import test from "node:test";
import { bookPage } from "../src/author-site.mjs";

test("a published book page names its manifest by a path without the owner directory under lib/", () => {
  const page = bookPage({
    manifest: { title: "T", date: "2026-01-01", slug: "t", description: "d", publisher: "P" },
    manifestPath: "lib/owner/services/example/ebook.json",
    manifestDigest: "sha256:0",
    storefronts: [],
    hasCover: false,
  });
  assert.match(page, /^generated-from: "services\/example\/ebook\.json"$/mu);
  assert.doesNotMatch(page, /lib\/owner/u);
});
