import { join } from "node:path";
import { authorSiteConfig } from "../src/author-site.mjs";

// The static-site-publisher configuration of the author site AUTHOR_SITE_DIR names (set by src/site-runner.mjs): the
// site's data is read from the working tree, this code and what it imports from the release. Paths are absolute
// because the publisher resolves a relative publicDir against this file, which is in the release.
const site = process.env.AUTHOR_SITE_DIR;
if (!site) throw new Error("AUTHOR_SITE_DIR names the site to configure");
export default { ...authorSiteConfig(site), publicDir: join(site, "public") };
