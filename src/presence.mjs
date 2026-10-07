// What a presence is, without the machinery that provisions it: the author site derives pages from these, and a site
// build must not load the inference and browser stacks that persona.mjs reaches through her mark.

/** Each presence's public address, for the others to link to. */
export function presenceUrl(presence) {
  switch (presence.platform) {
    case "neocities": return `https://${presence.site}.neocities.org/`;
    case "hive": return `https://peakd.com/@${presence.account}`;
    case "mastodon": return `https://${presence.server}/@${presence.username}`;
    case "buttondown": return `https://buttondown.com/${presence.newsletter}`;
    default: return null;
  }
}

/** The receipt states of a presence that exists for a reader to follow. */
export const LIVE_STATES = Object.freeze(["held", "created"]);
