import { openAccount } from "@red-cup-engineering/assisted-browser-services-section/accounts";
import { stepGuide } from "@red-cup-engineering/assisted-browser-services-section/assist";

/**
 * The person at the node, met in the assisted browser. The window opens on
 * the Group's mail (Fastmail) the first time it is needed, since the steps a
 * person does for a persona's accounts happen there: making her address,
 * clicking a platform's confirmation link. Every step shows in the guide's
 * panel; a value the person gives is typed into the panel, never read from
 * the portal.
 */
export function assistedPerson({ account = "fastmail", notify = (message) => process.stderr.write(`${message}\n`) } = {}) {
  let opened = null, guide = null;
  const ready = async () => {
    if (!guide) {
      opened = await openAccount(account, { visible: true, notify });
      guide = await stepGuide(opened.context, { notify });
    }
    return guide;
  };
  return Object.freeze({
    async ask({ text, input, values = [] }) {
      return (await (await ready()).show(text, { values, input, labels: ["Done"] })).value;
    },
    async confirm(text, { values = [] } = {}) {
      await (await ready()).show(text, { values, labels: ["Done"] });
    },
    async close() {
      await opened?.close();
      opened = null; guide = null;
    },
  });
}
