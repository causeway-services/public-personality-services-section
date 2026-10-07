#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { workingTreeOf } from "@red-cup-engineering/computer-code-development-engine/git/working-tree";
import { remoteInferenceMarketFromEnv } from "@red-cup-engineering/computer-inference-engine/dispatch/remote-inference-market";
import { channels } from "../src/channels.mjs";
import { houseAgency, personaCast } from "../src/cast.mjs";
import { provisionPersona } from "../src/persona.mjs";
import { providers } from "../src/providers.mjs";
import { tendAnswers } from "../src/answers.mjs";
import { tendNotes } from "../src/notes.mjs";
import { tendReach } from "../src/reach.mjs";
import { refreshSites } from "../src/sites.mjs";
import { platformRulesOf, tendPersona } from "../src/tend.mjs";
import { generateMark } from "../src/avatar.mjs";

const USAGE = "usage: persona-tend (<persona-dir>... | --all) [--publish] [--retain] [--only <platform>[,<platform>]] [--per-turn <n>]\n"
  + "  One turn of each persona's life on the web (--all: every persona in this section): reconciles her\n"
  + "  presences as persona-provision --unattended does (so an account a server has just approved gets its\n"
  + "  profile), derives and republishes each of her sites whose derived pages the reconciling left stale (a newsletter now held),\n"
  + "  drafts, gates and publishes a note when her notes' cadence has run (asking the inference market on MCP_ORIGIN as\n"
  + "  MCP_CLIENT_ID), carries entries her site's feed published since\n"
  + "  persona.json's syndicate.since to each presence (at most --per-turn per platform, default 1),\n"
  + "  records what reached her since the last turn in <persona-dir>/data/records/inbox/, appends a dated reading of each\n"
  + "  Neocities site's public views and hits to data/records/reach/<site>.jsonl, and answers each\n"
  + "  public reply or mention (or passes it, with the reason) under the same gate as her notes.\n"
  + "  Each persona is played by the bearer that wears her and answers for her (her mask in the agency): one\n"
  + "  no accountable bearer wears takes no turn, and every act recorded names its player.\n"
  + "  Without --publish it only says what it would post. --retain commits and pushes the records the turn\n"
  + "  wrote, and nothing else. Needs nobody at the node.";

// The repository a turn reads and writes: the node's working tree under its job's custody, or the checkout it runs in.
const TREE = workingTreeOf(import.meta.url);
/** Every persona in this section: services/<persona>/ with a persona.json. */
const SECTION = join(TREE.here, "..", "services");
const everyPersona = () => readdirSync(SECTION).map((name) => join(SECTION, name)).filter((dir) => existsSync(join(dir, "persona.json"))).sort();

/**
 * The turn's records under each persona (presences, notes, syndication, inbox, answers, her mark and its generation
 * receipt, and a republished site's pages, covers, icons and deployment receipts), committed and pushed by exact path.
 */
// Glob pathspecs: a bare "sites/*/content" matches only a file of that exact name, never what is under it.
const RECORDS = ["data/records/presences", "data/records/avatar", "data/records/notes", "data/records/syndication", "data/records/inbox", "data/records/answers", "data/records/reach", "sites/*/content", "sites/*/public", "sites/*/data/records/deployments"]
  .map((path) => `:(glob)${path}/**`);
function retain(dirs) {
  const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const repository = TREE.root;
  const mark = (dir) => { const { avatar } = JSON.parse(readFileSync(join(dir, "persona.json"), "utf8")); return avatar?.image ? [`:(literal)${avatar.image}`] : []; };
  const paths = dirs.flatMap((dir) => git(dir, ["ls-files", "-z", "--modified", "--others", "--exclude-standard", "--", ...RECORDS, ...mark(dir)])
    .split("\0").filter(Boolean).map((file) => relative(repository, join(dir, file)).split(sep).join("/")));
  if (paths.length === 0) return { committed: false };
  const { committed, pushed, obstructions } = TREE.retain({ paths, message: "Personas' web turn: what they syndicated and what reached them" });
  return { committed, pushed, ...(obstructions ? { obstructions } : {}) };
}

export async function main(argv, { output = process.stdout } = {}) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { all: { type: "boolean" }, publish: { type: "boolean" }, retain: { type: "boolean" }, only: { type: "string" }, "per-turn": { type: "string" } },
  });
  if (values.all ? positionals.length > 0 : positionals.length === 0) throw new Error(USAGE);
  const perTurn = values["per-turn"] === undefined ? 1 : Number(values["per-turn"]);
  if (!Number.isInteger(perTurn) || perTurn < 0) throw new Error(USAGE);
  const notify = (message) => process.stderr.write(`${message}\n`);
  const shared = channels(), unattended = providers({ person: null });
  const market = values.publish && process.env.MCP_ORIGIN ? remoteInferenceMarketFromEnv() : null;
  const results = [];
  let agency;
  // One persona's failure is hers alone; the others still take their turn.
  const dirs = values.all ? everyPersona() : positionals.map((path) => resolve(path));
  for (const dir of dirs) {
    try {
      const only = values.only?.split(",");
      // Played as cast, or not at all: her turn is her bearer's play wearing her, through her presences.
      agency ??= houseAgency(dir);
      const cast = personaCast(dir, { agency });
      const { results: presences } = await provisionPersona(dir, { providers: unattended, generate: generateMark, dryRun: !values.publish, only, notify });
      const sites = await refreshSites(dir, { publish: values.publish });
      const reach = await tendReach(dir, { publish: values.publish });
      let notes, platformRules = {};
      try {
        platformRules = await platformRulesOf(dir, shared, { only, notify });
        notes = await tendNotes(dir, { market, cast, publish: values.publish, platformRules });
      } catch (error) {
        notify(`${dir}: notes: ${error.message}`);
        notes = { error: error.message };
      }
      const turn = await tendPersona(dir, { channels: shared, cast, publish: values.publish, only, perTurn, notify });
      let answers;
      try {
        answers = await tendAnswers(dir, { channels: shared, market, cast, publish: values.publish, platformRules, only });
      } catch (error) {
        notify(`${dir}: answers: ${error.message}`);
        answers = [{ error: error.message }];
      }
      results.push({ ...turn, cast: { by: cast.by, bearer: cast.bearer, captains: cast.captains }, presences: presences.map(({ platform, state, profile, error }) => ({ platform, state, profile, error })), sites, reach, notes, answers });
    } catch (error) {
      notify(`${dir}: ${error.message}`);
      results.push({ dir, error: error.message });
    }
  }
  output.write(`${JSON.stringify(results.length === 1 ? results[0] : results, null, 2)}\n`);
  if (values.retain) output.write(`${JSON.stringify({ retained: retain(dirs) })}\n`);
  if (results.some((result) => result.error || [...result.presences, ...result.sites, ...result.reach, result.notes, ...result.out, ...result.inbox, ...result.answers].some((row) => row.error))) process.exitCode = 1;
  return results;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message ?? error); process.exitCode = 1; }
}
