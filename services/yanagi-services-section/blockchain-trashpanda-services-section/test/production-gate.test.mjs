import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { requireCoinbaseProductionGate } from "../src/production-gate.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "trashpanda-coinbase-gate-"));
  const paths = Object.fromEntries(["pricing", "distributionContract"].map((name) => [name, join(root, name)]));
  writeFileSync(paths.pricing, JSON.stringify({ type: "TrashpandaServicesCurrentMarketPricingEvidence", pricingPrinciple: "Current comparable market prices and attributable delivery costs determine production price; pilot conversion does not.", admittedPrices: { coinbaseDirectUsdc: "0.03", coinbaseMarketActionUsdc: "0.04" } }));
  writeFileSync(paths.distributionContract, '(map ("boundaryEnterprise" "urn:ame:trashpanda-services") ("brand" "Trashpanda Services"))');
  return paths;
}

test("admits Coinbase production at current market prices", () => {
  const admission = requireCoinbaseProductionGate(fixture());
  assert.deepEqual(admission.prices, { preSignUsdc: "0.03", marketActionUsdc: "0.04" });
  assert.equal(admission.brand, "Trashpanda Services");
});

test("refuses a non-Trashpanda public contract", () => {
  const clean = fixture();
  writeFileSync(clean.distributionContract, '(map ("brand" "Yanagi"))');
  assert.throws(() => requireCoinbaseProductionGate(clean), /distribution contract/u);
});
