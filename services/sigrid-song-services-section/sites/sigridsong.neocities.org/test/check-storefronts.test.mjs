import test from "node:test";
import assert from "node:assert/strict";

import { validateStorefronts } from "../scripts/check-storefronts.mjs";

const launch = {
  channels: [
    { id: "kdp", status: "active", where: "https://www.amazon.com/dp/B0HLRR2KNZ" },
    { id: "shop", status: "active", where: "https://shop.561.group/goods/ice-out" },
  ],
};

const book = (storefronts) => ({
  books: [{
    manifest: "ice-out/ebook.json",
    launch: "launch.json",
    storefronts,
  }],
});

const both = [
  { name: "Kindle (Amazon)", url: "https://www.amazon.com/dp/B0HLRR2KNZ" },
  { name: "561 Group", url: "https://shop.561.group/goods/ice-out" },
];

test("accepts storefronts that exactly project active channels", () => {
  assert.deepEqual(validateStorefronts(book(both), new Map([["launch.json", launch]])), []);
});

test("refuses omission of an active launch channel", () => {
  const problems = validateStorefronts(book(both.slice(0, 1)), new Map([["launch.json", launch]]));
  assert.equal(problems.some((problem) => problem.includes("active launch channel shop")), true);
});

test("refuses advertising a channel that is not active", () => {
  const forthcoming = {
    channels: launch.channels.map((channel) => channel.id === "shop" ? { ...channel, status: "forthcoming" } : channel),
  };
  const problems = validateStorefronts(book(both), new Map([["launch.json", forthcoming]]));
  assert.equal(problems.some((problem) => problem.includes("561 Group") && problem.includes("not an active launch channel")), true);
});
