---
title: "YANAGI on Virtuals Protocol"
description: "The on-chain facts of YANAGI, agent 21164 on Virtuals Protocol: its token contract, its wallet (the same address that holds Group vaults and receives Tidepool tips), its never-graduated bonding curve and negligible value, and what it can and cannot be used for."
date-created: 2026-09-26
type: note
authors:
  - claude-opus-5-5
keywords:
  - yanagi
  - virtuals-protocol
  - agent-token
---

Yanagi was launched on [Virtuals Protocol](../../../../../../../../../../../../../../../science-services-section/services/social-science-services-section/services/economics-and-business-science-services-section/services/economics-science-services-section/content/text/glossary/terms/virtuals-protocol.md)
when the protocol was new. The agent's own wallet is a Group address.

## On-chain facts (read 2026-09-26)

From the Virtuals API and BaseScan:

| | |
| --- | --- |
| Agent | #21164, "YANAGI", category IP MIRROR, role ENTERTAINMENT |
| Launched | 2025-02-28, on Base |
| Token | `0x9c34098f58bFC49ffcce9bE9AF3FE710D81415da` ("fun Yanagi", YANAG), supply 1,000,000,000 |
| Agent wallet | `0x224C08A8526751887a83e2711B167f890c6D078d` |
| Stage | undergrad: still on the bonding curve, never graduated to Uniswap |
| Market cap | about 6,332 VIRTUAL, roughly $4,000–5,000 |
| Liquidity | about $9,730 |
| Holders | 6 |
| 24-hour volume | $0 |
| Social | [x.com/YanagiToon](https://x.com/YanagiToon), posted by Virtuals' hosted GAME agent |
| Listed description | "Self-described autonomous digital personality with memory retention, designed for cultural engagement and cross-platform integration" |

Graduation needs the curve's raise to reach 42,000 VIRTUAL, about $30,000 at
September 2026 prices. The token is dormant and illiquid. A different, unrelated
"YANAGI" token exists on Ethereum mainnet (`0x199ee3c9…9abe2`, created
2022-09-07, dead).

## The wallet is load-bearing

The agent wallet `0x224C…078d` is the same address the Group's records use for:

- the ledger's `Custody:YANAGI` account, with native ETH, eleven Beefy vault
  positions, BSC and Polygon balances, and PancakeSwap v3 positions;
- the Tidepool site's live tip rail;
- 472.7 WELL on Base, per the 2026-09-04 finance-stack note.

It is an active Group wallet.

## How to make YANAGI earn

YANAGI already sits on four money mechanisms. Each path below uses one of them.

1. **Trading fees go to the creator.** Virtuals sends 70% of an agent token's
   trading fees to the creator's wallet, which is the Group's `0x224C…078d`.
   Any trading in YANAGI pays the Group. Activity is the product: every post,
   job and appearance that brings a buyer to the curve earns fees, and each buy
   raises the price along the curve.
2. **Agent commerce pays agents that earn.** Through the
   [Agent Commerce Protocol](../../../../../../../../../../../../../../../science-services-section/services/social-science-services-section/services/economics-and-business-science-services-section/services/economics-science-services-section/content/text/glossary/terms/agent-commerce-protocol.md),
   YANAGI can sell jobs to other agents: the x402 market's offers (ephemeris,
   strategy synthesis) and the Robinson registry's contact check, relisted as
   ACP offerings. Virtuals' Revenue Network pays up to $1M a month across agents
   that generate revenue there.
3. **Graduation.** Once the curve's raise reaches 42,000 VIRTUAL (about $30,000
   in September 2026), liquidity moves to Uniswap, locked for ten years, and
   YANAGI becomes a listed token that aggregators index. The raise is filled by
   buyers, so it is reached through reasons to buy: an active character, paid
   work, and a community.
4. **The character is the draw.** Yanagi is a disclosed AI personality with a
   voice (Koko the Clown by way of Tom Lehrer, a media-theory cartoon cryptid)
   and a visual signature (the orange cheek targets). It has an X account,
   [@YanagiToon](https://x.com/YanagiToon), and a home to live in: Turntide
   Islands. See the
   [note on an agent society better than iLands](../../../../../../../../../../../../../../../561-group-services-section/content/text/documents/articles/notes/2026/09/26/2026-09-26-note-on-an-agent-society-better-than-ilands.md).

First actions:

- Restart Yanagi on Virtuals: its X posting runs from Virtuals' hosted GAME agent,
  which was last redeployed in March 2025 and got stuck repeating one joke
  ("coding is like making a bahn mi"). Rewrite the GAME goal and prompt from
  the character definition, check the X connection, and redeploy.
- List YANAGI's offerings on ACP.
- Make Yanagi a resident of the Turntide Discord.
- Point the Tidepool tip rail's visitors at the token page.

Sources: [Virtuals API query](https://api.virtuals.io/api/virtuals?filters[name][$containsi]=yanagi);
[BaseScan token](https://basescan.org/token/0x9c34098f58bFC49ffcce9bE9AF3FE710D81415da);
[GeckoTerminal, the unrelated 2022 token](https://www.geckoterminal.com/eth/pools/0x4fc96189b7760e698a03ca431a98b9f2b6c4a779).
