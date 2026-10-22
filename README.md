# Public personalities

<!-- 561-group-standards:badges:start -->
[![Causeway Services](https://img.shields.io/badge/561%20Group-Causeway%20Services-115e69)](https://github.com/causeway-services)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-115e69)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/causeway-services/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

The Group's public personas, one section each under `services/`, the tool that sets up their accounts, and the turn that keeps them alive on the web.

## A persona's accounts

A persona that holds accounts has a `persona.json`. It records:

- **Who she is:** `name`, `summary`, `home`, `publisher`.
- **How she is made:** `disclosure`. This is said only on the platforms listed in `discloseOn`, which are the ones whose rules or law require it. Every other platform gets no disclosure.
- **Her email address:** `email`, holding a provider and the addresses she would take, in order of preference. An address on the house's mail domain (`@561.group`) is assigned: the email step makes its alias, and every account registered with it waits (`waits-on-email`) until the house can send as it, so no confirmation mail goes to an address that does not exist yet. An address on a provider's shared domain (`@fastmail.com`, one per account) is made by a person.
- **Her mark:** `avatar`, an `image` beside persona.json and the `prompt` it is made from. Every presence shows the same mark: Mastodon gets the image uploaded, her site serves it at `/avatar.<ext>` with `favicon.ico` and `apple-touch-icon.png` made from it, and her Hive `profile_image` is the site's copy. When the image is missing, provisioning generates it from the prompt with the house's image generation and records the generation receipt, prompt included, in `data/records/avatar/<version>.json`. The prompt asks for a non-figurative or illustrated emblem, never a photographic face. To make a new mark, delete the image.
- **Her presences:** one per platform account.

```sh
persona-provision services/<persona>-services-section --dry-run   # what it would do
persona-provision services/<persona>-services-section             # do it
persona-provision services/<persona>-services-section --only hive
```

Each presence is reconciled, so running it again is safe. It does only what is missing and records what it saw in `<persona>/data/records/presences/<platform>.json`. Those receipts hold public facts only. The `neocities` step also derives and republishes her site when its derived pages or icons are stale. Hive gets a profile image only once the site serves the mark. Mastodon re-encodes the avatar it is sent, so its receipt records the digest that was sent and the address the server serves; the image is uploaded again only when either one changes.

| Platform | Provider | Private store on the node |
| --- | --- | --- |
| `neocities` | `neocities-services-section` (`neocities-site`) | `~/.config/561-group/neocities/<site>.api-key` |
| `hive` | `hive-account-provisioning-service`; the `creator` pays the 3 HIVE fee and becomes the recovery account. With `rc: { comments, ceiling }`, the creator also lends her RC, up to `ceiling`, whenever she can't afford that many comments a day | Hive key vault, named by the presence's `keys` (`ssh:cold-red-gate`), plus its sealed replica on the node, `~/.config/561-group/keys-backup/hive`, under `key-passphrase.env` |
| `mastodon` | `mastodon-services-section`; pick a server whose rules allow the persona | `~/.config/561-group/mastodon/<server>/<username>.json` |
| email | `fastmail-services-section`: an alias in the Group's Fastmail account (561.group's mail is Fastmail), with a sending identity in her name. Reconciled first, since the accounts after it are registered with it. Its receipt's `state` is `sends` once the house can send as her | the account's API token, `~/.config/561-group/fastmail/fastmail.json` |

Some steps need a person: making the email alias, making the Fastmail API token (once, for the whole account), a server's date-of-birth question, and clicking a confirmation link. For those, the [assisted browser](../../../../../engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-web-engineering-services-section/services/assisted-browser-services-section/) opens on Fastmail and shows each step in its panel. `--unattended` skips any step that needs a person and says which ones were skipped.

## Her life on the web

Once her accounts exist, `persona-tend` gives every persona one turn each hour (the node's `persona-tend` job, `lib/emsenn/services/561-group/services/561-group-services-section/services/561-group-operations-services-section/services/bare-cedar-fog-services-section/data/records/machine-deployment-service-records/metroplat/deployments/bare-cedar-fog-host/deploy/jobs/persona-tend.json`, run from its release with working-tree custody of `services/`). A turn does six things:

1. **Reconcile her presences.** This is `persona-provision --unattended`. When a server approves an account, the next turn sets its profile.
2. **Keep her sites current.** A site under `sites/` whose `package.json` has `derive`, `derive:check` and `publish` scripts derives some pages from records outside its content, her presence receipts among them. When `derive:check` finds those pages stale, the turn runs `derive` and `publish` (`src/sites.mjs`). So when her Buttondown newsletter comes to be held, her site gains its newsletter and reader-team pages in the same turn.
3. **Say a note when one is due.** `persona.json`'s `notes` names her voice document (`voice`), how often she speaks (`cadence`, an ISO 8601 duration such as `P2D`) and the site that carries her notes (`site`). When the cadence has run since her last draft, the turn asks the house inference market (on `MCP_ORIGIN`, as the node's machine client) for one note in her voice, puts it through the gate (`src/gate.mjs`), and publishes it at `/notes/<date>-<slug>/` on her site, or withholds it with the rule it broke. Every draft is recorded in `data/records/notes/`, and every delivery is judged back to the market. A withheld draft still uses up its cadence.
4. **Carry out what her site published.** Entries in the feed named by `syndicate.feed`, published on or after `syndicate.since`, go to each presence:
   - **Hive:** the whole entry, with the site as `canonical_url`. The permlink is the entry's path, so an entry always lands on the same post.
   - **Mastodon:** a short notice (title, first real paragraph, link). Retries send the same idempotency key.

   Each platform gets at most one entry per turn, oldest first. Each copy is recorded in `data/records/syndication/<entry>.json` and never sent twice. A platform still waiting on its account is tried again next turn.
5. **Read what reached her.** Replies, mentions, follows and boosts since the last turn are appended to `data/records/inbox/<platform>.jsonl`. Direct and followers-only messages are recorded as having arrived, but their text is not kept.
6. **Answer who spoke to her** (`src/answers.mjs`). Each public reply or mention gets an answer drafted in her voice, or a deliberate pass with its reason (spam, nothing addressed to her, a draft the gate withheld). An answer passes the same gate as her notes and is posted where she was spoken to: a Hive comment, or a Mastodon status in reply. Anyone who asks what she is gets her `disclosure`, never a draft. A direct or followers-only message is never answered in public. Each decision is recorded in `data/records/answers/<platform>/<inbox id>.json`, and a posted answer is never posted again. A turn answers at most five entries.

The gate withholds anything that claims she is human or has a human life, denies AI, names a private person, or breaks a platform's rules. It reads twice: its own patterns first, then a model assay that also holds the text to each platform's stated rules (a Mastodon server's own, Hive's norms). An assay that cannot be read withholds.

The job runs `persona-tend --all --publish`. It does not retain: a turn's records stay in the node's runtime state, where the next turn reads them back, and no turn opens a pull request. A pull request is a review of a change to source, and an hourly receipt of acts already done is not one. `--retain` commits and pushes only the records the turn wrote, and a republished site's derived pages, covers and deployment receipts; it is for a person at a checkout. Leave off `--publish` to see what a turn would post.

This turn is the thinnest realization of the persona as a body with its own heartbeat. The requirements, specification and design of that body are in [the specification of persona bodies with their own heartbeats](../../../../../engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/agent-computer-system-engineering-services-section/services/multi-agent-computer-system-engineering-services-section/services/multi-agent-computer-platform-engineering-services-section/services/agentic-enterprise-computer-platform-engineering-services-section/apps/metroplat/content/text/documents/specifications/persona-bodies-with-heartbeats.md).

```sh
persona-tend services/<persona>-services-section             # what it would post; reads the inbox
persona-tend --all --publish                                   # what the job does, minus retaining
```

So she speaks by publishing on her own site, and everything else follows from that. A turn posts nothing her site has not published, except her answers to those who spoke to her, which pass the same gate. She never claims to be human and never denies being AI when someone sincerely asks.

## Adding a persona

```sh
persona-new <persona-id> --name "<Her Name>" --summary "<one sentence>" [--newsletter] [--mastodon <server> --reason "<why>"] [--dry-run]
pnpm install                                        # links her site into the workspace
persona-provision services/<persona-id>-services-section
```

`persona-new` writes her section: `persona.json`, a README and her author site at `sites/<handle>.neocities.org/`. One handle, made from her name, serves her Neocities site, her Hive account and any Mastodon account or newsletter. Hive's 3 to 16 lowercase characters are the narrowest rule, so a long name needs `--handle`. Her address is `<first>.<last>@561.group`. The `avatar` prompt asks for a non-figurative emblem, and her first provisioning makes the mark from it. `discloseOn` starts empty. Nothing that exists is overwritten.

Her site's config is `authorSiteConfig` from `./author-site`: her name, summary, home and other presences (`discovery.me`, so profile links verify) all come from persona.json. `author-site derive` writes what the site derives from the house's records: book pages from `books.json`, the newsletter and reader-team pages while her Buttondown presence is held, and her mark as the site's icons. Write her home and about pages, then add `syndicate` (her feed and the date to start from), `notes` and Hive `tags` to her persona. The hourly turn picks her up by itself.

Hive account names follow protocol rules: 3 to 16 characters, lowercase. Mastodon usernames allow letters, digits and `_`. Mastodon servers that ask for a reason get the presence's `reason`. Moderators approve accounts in hours to days, and a later run then fills in the profile.
