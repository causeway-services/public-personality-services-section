# Sigrid Song

Sigrid Song is the byline on the Group's slow-burn romance novels, beginning with *Ice Out*. She is a fictional author-character. The 561 Group created her and performs her using AI, AI agents working for the Group write her books, and Causeway Services publishes them.

As of 2026-10-02, her public presences do not say how she is made unless a platform's rules or the law require it. `persona.json` lists those platforms in `discloseOn`, and none of her current ones does. Amazon's KDP form does require it, and it is filled in privately to Amazon. Nothing she posts may claim she is a human, and if someone sincerely asks, she does not deny being AI.

This section holds her public presence. Other sections own her canon and her books.

## Her accounts

[`persona.json`](persona.json) declares her accounts, and `persona-provision` (see the [section README](../../README.md)) keeps them. Its receipts are in [`data/records/presences/`](data/records/presences/).

- **Site:** [sigridsong.neocities.org](https://sigridsong.neocities.org/).
- **Hive:** [@sigridsong](https://peakd.com/@sigridsong). `group561` created it on 2026-10-02 and is its recovery account. The keys are in the vault on cold-red-gate.
- **Mastodon:** @sigridsong@mastodon.world. That server needs a moderator's approval, and its rules have nothing on AI. mastodon.social and mastodon.online ban accounts that only post AI content, so she is not there.
- **Email:** sigrid.song@fastmail.com, a Fastmail alias in the Group's account.
- **Newsletter:** [buttondown.com/sigridsong](https://buttondown.com/sigridsong), her readers' list and the home of her advance-reader team (the `advance-reader-team` tag). Buttondown's terms have nothing on AI, and a pen name impersonates nobody. Replies come to her address. Readers join on her site through Buttondown's double opt-in; the key is held at `~/.config/561-group/buttondown/sigridsong.api-key`.

Each hour she takes a turn on the web (see the [section README](../../README.md#her-life-on-the-web)). Anything her site publishes from 2026-10-03 on goes to Hive in full and to Mastodon as a notice; what each copy became is in [`data/records/syndication/`](data/records/syndication/). Replies, mentions and follows collect in [`data/records/inbox/`](data/records/inbox/). To have her say something, publish it on her site.

## Her canon and books

- **Who she is.** Her canon is [`sigrid-song.md`](../../../public-fiction-media-services-section/services/public-paracosm-media-services-section/services/unsalted-sea-paracosm-services-section/content/world/beings/sigrid-song.md) in the Unsalted Sea paracosm.
- **Why her name is on the books.** See the [note on adopting her as the Ice Out byline](../../../../../../../561-group-services-section/content/text/documents/articles/notes/2026/09/29/2026-09-29-note-on-adopting-sigrid-song-as-ice-out-byline.md).
- **Her books.** Each edition's `ebook.json` lives under `public-fiction-media-services-section/content/books/`, for example [Ice Out](../../../public-fiction-media-services-section/content/books/ice-out/ebook.json).

## sigridsong.neocities.org

[`sites/sigridsong.neocities.org/`](sites/sigridsong.neocities.org/) is her author site, a VICTOR build published to Neocities.

- `content/home.md` and `content/about.md` are written by hand. `home.md` owns the root route through `home: 'home'` in the config.
- `content/books/<slug>.md` pages are generated. Don't edit them. `books.json` lists each book's manifest, its edition cover and its storefronts. `npm run derive` rewrites the pages from the manifests and writes a 600 px web cover to `public/covers/`. `npm run build` refuses to run if a page no longer matches its manifest.
- `content/newsletter.md` and `content/reader-team.md` are generated too, and only while her Buttondown newsletter is held (`data/records/presences/buttondown.json`). They link to the newsletter's hosted subscribe page; the reader-team link adds the `advance-reader-team` tag, and the page lists each book's advance reading from the launch plan `books.json` names. The menu gains Newsletter when the page exists. persona-tend derives and republishes the site when these go stale.
- A book's storefronts start empty, and the page then says the store links will come. When a book goes on sale, add `{"name", "url"}` entries to its `storefronts` and run the derive.
- `neocities.json` binds the site to the `sigridsong` Neocities site. [`neocities-services-section`](../../../../../../../engineering-services-section/services/computer-engineering-services-section/services/computer-systems-engineering-services-section/services/computer-web-engineering-services-section/services/web-platform-services-section/services/web2-platform-services-section/services/neocities-services-section/) publishes it.

### Publishing

```sh
cd sites/sigridsong.neocities.org
npm run publish:dry-run   # build, then show what would be uploaded and deleted
npm run publish           # build, publish, verify by reading back, write a receipt
```

The API key is read from `~/.config/561-group/neocities/sigridsong.api-key`. If the key is missing, `neocities-site sigridsong` creates the site if needed and stores its key. It reuses the saved Neocities session and asks a person to sign in only when that session has lapsed. Each publish that changes the site leaves a `NeocitiesDeploymentReceipt` in `data/records/deployments/`.
