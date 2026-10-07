#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { scaffoldPersona } from "../src/scaffold.mjs";

const SERVICES = resolve(fileURLToPath(new URL("../services", import.meta.url)));

const USAGE = "usage: persona-new <persona-id> --name <name> --summary <one sentence> [--publisher <imprint>] [--handle <handle>]\n"
  + "                   [--mastodon <server> --reason <why>] [--newsletter] [--avatar-prompt <prompt>] [--dry-run]\n"
  + "  Writes a new persona's section (persona.json, README) and author site under services/<persona-id>-services-section/.\n"
  + "  One handle, from her name, names her site, Hive account and any Mastodon account or newsletter; her email is\n"
  + "  <first>.<last>@561.group. Then: pnpm install (to link the site), and persona-provision on the section.";

export async function main(argv, { output = process.stdout, root = SERVICES, today = new Date().toISOString().slice(0, 10) } = {}) {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: {
      name: { type: "string" }, summary: { type: "string" }, publisher: { type: "string" }, handle: { type: "string" },
      mastodon: { type: "string" }, reason: { type: "string" }, newsletter: { type: "boolean" },
      "avatar-prompt": { type: "string" }, "dry-run": { type: "boolean" },
    },
  });
  if (positionals.length !== 1 || !values.name || !values.summary) throw new Error(USAGE);
  const result = await scaffoldPersona(root, {
    persona: positionals[0], name: values.name, summary: values.summary, publisher: values.publisher, handle: values.handle,
    mastodon: values.mastodon ? { server: values.mastodon, reason: values.reason } : null, newsletter: values.newsletter,
    avatarPrompt: values["avatar-prompt"], today,
  }, { dryRun: values["dry-run"] });
  const section = join(root, result.section);
  output.write(`${JSON.stringify({ ...result, next: ["pnpm install", `persona-provision ${relative(process.cwd(), section)}`] }, null, 2)}\n`);
  return result;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(error.message ?? error); process.exitCode = 1; }
}
