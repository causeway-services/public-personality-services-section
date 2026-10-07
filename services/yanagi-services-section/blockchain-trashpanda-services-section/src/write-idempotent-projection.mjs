import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { readFileText } from "@red-cup-engineering/file-services/read-file";
import { writeFileText } from "@red-cup-engineering/file-services/write-file";

/**
 * Writes text to path only if the path is absent; if the path already holds different text,
 * throws conflictMessage. Returns true when written, false when the existing content already
 * matched. This is the create-or-verify-identical admission every enterprise projection here
 * needs, so a re-run of an admission script never fails as long as the record has not changed.
 */
export async function writeIdempotentProjection(path, text, { mode, directoryMode, conflictMessage } = {}) {
  await mkdir(dirname(path), { recursive: true, mode: directoryMode });
  try {
    await writeFileText(path, text, { flag: "wx", mode });
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    if (await readFileText(path) !== text) throw new TypeError(conflictMessage);
    return false;
  }
}
