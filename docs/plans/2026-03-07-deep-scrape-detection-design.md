# Deep Scrape Detection & UX Refinement

**Goal:** Auto-detect JS-heavy artist pages during initial scrape and conditionally show deep scrape with pre-populated URL.

**Detection:** Add `hasShowMore` boolean to `ScrapeResult` by checking for Show More/Load More buttons via cheerio. In `crawlFestival`, when a lineup page has `hasShowMore`, set `deepScrapeCandidate: { url, reason }` on the result.

**UI:** Only show deep scrape section after initial scrape completes. If `deepScrapeCandidate` is present, pre-fill the URL and show a hint message. Applies to both new festival form and edit page.

**Data flow:** `scrapeUrl() → hasShowMore → crawlFestival() → deepScrapeCandidate → SSE complete → UI conditional render`
