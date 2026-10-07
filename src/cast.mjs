import { resolve } from "node:path";
import { agencyRootFrom, readAgency } from "@red-cup-engineering/organizing/agency";
import { castPlay } from "@red-cup-engineering/organizing/agency/cast";
import { carrierSource, organsOf } from "@red-cup-engineering/organizing/agency/organs";

/**
 * Who plays a persona. A persona is a mask in the house's agency (pool `masks`) whose carrier is her
 * persona.json; each presence the carrier declares is one of her hands; and she is played by the
 * bearer that wears her and answers for her to a captain (organizing's `castPlay`). An account is
 * only a hand: Sigrid Song is Causeway Publishing's pen name, so her turn is Causeway Publishing's
 * play wearing her, through her Hive account or her site, never the play of whichever process
 * happened to run it.
 *
 * A persona no accountable bearer wears takes no turn: `personaCast` throws, naming who wears her and
 * why none may play her. Every act a turn records carries its `player` (`player(platform)`): the
 * mask it was played as (`by`), the bearer and the hand.
 */

/** The agency the house's records hold, read from the repository `from` sits in. */
export const houseAgency = (from) => readAgency(agencyRootFrom(from));

/** The mask whose carrier is `dir`'s persona.json, or undefined when none is recorded. */
export function personaMaskOf(agency, dir, root = agencyRootFrom(dir)) {
  const carrier = resolve(dir, "persona.json");
  return [...agency.masks.values()].find((mask) => typeof mask.carrier === "string" && resolve(root, carrierSource(mask)) === carrier);
}

/** The persona at `dir` cast: her mask, the bearer playing her, its captains, and `player(platform)`,
 *  the player record of an act through that presence. Throws when no accountable bearer wears her. */
export function personaCast(dir, { agency = houseAgency(dir), root = agencyRootFrom(dir) } = {}) {
  const mask = personaMaskOf(agency, dir, root);
  if (mask === undefined) throw new Error(`${dir}: no mask in the agency has this persona.json as its carrier, so no one may play her`);
  const play = castPlay(agency, mask.key);
  if (play.kind !== "organizing.agency.play") throw new Error(`${mask.name}: no accountable bearer wears her (${play.reason}; worn by ${play.wearers.join(", ") || "no one"})`);
  const hands = new Map(organsOf(agency, mask.key).map((organ) => [organ.platform, `${organ.platform}:${organ.account}`]));
  const player = (platform) => Object.freeze({ by: play.by, bearer: play.bearer, ...(hands.has(platform) ? { hand: hands.get(platform) } : {}) });
  return Object.freeze({ mask: mask.key, by: play.by, bearer: play.bearer, captains: play.captains, hands: Object.freeze(Object.fromEntries(hands)), player });
}

/** The `player` field an act's record carries when its turn is cast (`cast` from `personaCast`), else nothing. */
export const playedBy = (cast, platform) => (cast === undefined ? {} : { player: cast.player(platform) });
