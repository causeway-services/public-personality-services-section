#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PERFORMER_ROOT = ROOT;

export const COINBASE_PRODUCTION_GATE_PATHS = Object.freeze({
  pricing: join(ROOT, "data/evidence/2026-07-22-current-market-pricing.json"),
  distributionContract: join(PERFORMER_ROOT, "content/contracts/trashpanda-services-x402-distribution.rml"),
});

function objectAt(path, label) {
  if (!existsSync(path)) throw new TypeError(`${label} is absent`);
  let value;
  try { value = JSON.parse(readFileSync(path, "utf8")); }
  catch { throw new TypeError(`${label} is not valid JSON`); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}

export function requireCoinbaseProductionGate(paths = COINBASE_PRODUCTION_GATE_PATHS) {
  const pricing = objectAt(paths.pricing, "current-market pricing evidence");
  const distribution = readFileSync(paths.distributionContract, "utf8");

  if (pricing.type !== "TrashpandaServicesCurrentMarketPricingEvidence"
      || pricing.pricingPrinciple !== "Current comparable market prices and attributable delivery costs determine production price; pilot conversion does not."
      || pricing.admittedPrices?.coinbaseDirectUsdc !== "0.03"
      || pricing.admittedPrices?.coinbaseMarketActionUsdc !== "0.04") {
    throw new TypeError("Coinbase production prices lack exact current-market admission");
  }
  if (!/\("boundaryEnterprise" "urn:ame:trashpanda-services"\)/u.test(distribution)
      || !/\("brand" "Trashpanda Services"\)/u.test(distribution)) {
    throw new TypeError("Coinbase production distribution contract is absent or nonconforming");
  }
  return Object.freeze({
    type: "TrashpandaServicesCoinbaseProductionGateAdmission",
    admitted: true,
    prices: Object.freeze({ preSignUsdc: "0.03", marketActionUsdc: "0.04" }),
    brand: "Trashpanda Services",
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(requireCoinbaseProductionGate())}\n`); }
  catch (error) {
    process.stderr.write(`trashpanda-services production gate: REFUSE ${error.message}\n`);
    process.exitCode = 1;
  }
}
