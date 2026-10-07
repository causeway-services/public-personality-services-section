import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const PROPERTY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadDivinerConfig() {
  const path = join(PROPERTY_ROOT, "diviner.config.json");
  return normalizeDivinerConfig(JSON.parse(readFileSync(path, "utf8")));
}

export function normalizeDivinerConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("diviner config must be an object");
  }
  const block = input;
  return Object.freeze({
    persona: String(block.persona),
    chartHourUtc: Number(block.chartHourUtc ?? 16),
    seedSalt: String(block.seedSalt ?? "routine-read"),
    atomicsProvider: String(block.atomicsProvider ?? "nim"),
    atomicsModel: String(block.atomicsModel ?? "meta/llama-3.3-70b-instruct"),
    imageProvider: String(block.imageProvider ?? "nim"),
    imageModel: String(block.imageModel ?? "stabilityai/stable-diffusion-3-medium"),
    synthesisModel: String(block.synthesisModel ?? "opus"),
    minWords: Number(block.minWords ?? 600),
    maxWords: Number(block.maxWords ?? 1200),
  });
}

/** Today's date (UTC) as YYYY-MM-DD, or the date given on the command line. */
export function dateArgument(argv) {
  const given = argv.find((argument) => /^\d{4}-\d{2}-\d{2}$/.test(argument));
  return given ?? new Date().toISOString().slice(0, 10); // law-allow: wall-clock-as-data — "today" is the cycle's input default, not an ordering
}
