#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { assistedPerson } from "@red-cup-engineering/assisted-browser-services-section/person";
import { personaCast } from "../src/cast.mjs";
import { provisionPersona } from "../src/persona.mjs";
import { providers } from "../src/providers.mjs";
import { generateMark } from "../src/avatar.mjs";

const USAGE = "usage: persona-provision <persona-dir> [--only <platform>[,<platform>]] [--dry-run] [--unattended]\n"
  + "  Brings each presence in <persona-dir>/persona.json to what it declares (a Neocities site, a Hive account,\n"
  + "  a Mastodon account, a Buttondown newsletter with its key held, and the email address they need, made ready to\n"
  + "  send from), each showing her mark (persona.json `avatar`, generated from its prompt when it is not there yet),\n"
  + "  and records public receipts in <persona-dir>/data/records/presences/. Steps only a person may do open the assisted browser;\n"
  + "  --unattended stops those steps instead. Safe to run again. Her presences are her hands, so only a persona\n"
  + "  an accountable bearer wears (her mask in the agency) is provisioned.";

export async function main(argv, { output = process.stdout } = {}) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { only: { type: "string" }, "dry-run": { type: "boolean" }, unattended: { type: "boolean" } },
  });
  if (positionals.length !== 1) throw new Error(USAGE);
  const cast = personaCast(resolve(positionals[0]));
  const notify = (message) => process.stderr.write(`${message}\n`);
  const person = values.unattended || values["dry-run"] ? null : assistedPerson({ notify });
  try {
    const result = await provisionPersona(resolve(positionals[0]), {
      providers: providers({ person }), generate: generateMark, dryRun: values["dry-run"], only: values.only?.split(","), notify,
    });
    output.write(`${JSON.stringify({ ...result, cast: { by: cast.by, bearer: cast.bearer, captains: cast.captains } }, null, 2)}\n`);
    if (result.results.some((r) => r.error)) process.exitCode = 1;
    return result;
  } finally {
    await person?.close();
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message ?? error); process.exitCode = 1; }
}
