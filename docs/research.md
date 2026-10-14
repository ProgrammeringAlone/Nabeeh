# Public-reference research — 13–14 October 2026

All six supplied origins were inspected with verified HTTPS, then rendered in Chromium after the user explicitly approved the platform proxy CA. The active root fingerprint ends `56:CD:7F:C3`. No TLS checks were disabled. The earlier certificate block is resolved.

Evidence comprises 43 rendered page captures, including a desktop and mobile landing capture for each site, plus public HTML/rules/policy collection and limited public-control exploration. Raw text, controls and screenshots remain in ignored `.local/research/settled/evidence.json` and related files. Counts include repeated roots/hash routes; this is not 43 unique product flows. External YouTube embeds failed on Seen Jeem and Jam3aa; some Asbghm resources also failed. These observations do not establish an origin outage.

**B** means a rendered public screen/control was observed. **D** means a feature, price or rule was described by the site's public copy. **U** means execution or persistence was unverified. Inventory totals are marketing claims. No reference account or purchase was created, no authentication was bypassed, and no question bank, code, artwork or distinctive layout was imported into Nabeeh. No full authenticated competitor game is claimed.

## Six-site findings

| Reference | Observed public structure (B) | Described experience (D) | Gate/limits (U) |
| --- | --- | --- | --- |
| [Jawabha](https://jawabha.ae/) | Main application is within a same-origin/srcdoc frame; hero, grouped categories, setup/control templates, how-to anchor, terms/privacy | Two teams; six categories; three selected helpers; first game free; 17 groups and 15,000+ questions | Full game, QR media, purchase, authenticated history and exact no-repeat scope untested |
| [Seen Jeem](https://seenjeemkw.com/) | Landing, public start-game category selector, contact and login; carousel of special-category explanations | Six categories, 36 questions, three helpers/team; tournament CTA; gift codes; 200+ category claim | Saving/starting an authenticated game, scoring, timers and cross-device behavior untested |
| [Asbghm](https://www.asbghm.com/) | Landing/demo board, category cards/catalog, how-to, FAQ, login, contact, terms/privacy; light/dark/device controls and cookie/banner overlays | Two teams, six categories × six questions; 200/400/600 points; first game free; packages/subscriptions and tournaments | Clicking a public demo tile does not establish a durable live game; authenticated play/payment/persistence untested |
| [Befateen](https://befateen.com/) | Landing, my-games empty state, login redirect, about, FAQ, contact, terms/privacy | Three categories/team; helper examples; 341+ categories, 2,000+ questions, seven-country claim | Start route redirects to login; actual bank size, saved games, prices and rules enforcement untested |
| [Jam3aa](https://jam3aa.com/) | Landing/category descriptions, how-to, login/register, contact, terms/privacy; public rankings | Six categories/36 questions; reading/answer/opposing phases; varied audio/video/order/charades formats; cross-device resume guide | Play CTA leads to login; full gameplay, media, accounting, ranking computation and purchased codes untested |
| [Seen So2al](https://seenso2al.com/) | Landing, category carousel, helpers, FAQ, AR/EN controls and account/start entry; `/new` returns to root with next parameter | Six categories/36 questions; helpers, gifts and 200+ category claim | Account start gate; no authenticated board, purchase, full English experience or history test |

## Rules, discovery and monetization details

Jawabha public setup templates provide search, random/clear selection, grouped category expansion, team names and three helper choices. Reveal, skip, award-to-either-team/neither and manual score controls are present in HTML; hidden templates are not exercised game states. Described media includes blurred images, flags, logos and team-private QR charades. Public terms list AED 19/one game, 34/two and 72/five, processed through Ziina; this was not a checkout quote. Copy disagrees between 168/169/171 category totals. History/reset controls do not prove canonical freshness or secure persistence.

Seen Jeem's rendered start-game route explains three categories per team, random category selection and a 36-question board. Public helper cards describe call-a-friend, subtracting the earned points from the opposing team, two answers, resting an opposing participant and a trap. Timing restrictions appear on the cards, but enforcement is U. Login/recovery/register affordances and tournament/gifting entry points are visible. An unavailable embedded video limits instruction-media assessment.

Asbghm's public board displays pairs of 200/400/600 tiles per category. Its homepage explains category choice, team names, helpers and turns, and includes a selectable package summary. Rendered examples included 10 games for SAR 49 and longer packages/subscriptions; pricing remains an attributed screen observation, not a purchase. Optional-cookie choices and promotional overlays can obscure the first screen. The demo tile was clicked, but no durable board/API behavior or full scoring flow was verified.

Befateen has illustrated category cards, discover-all entry, previous-games navigation and a clear three-step explanation. Helpers describe double points, a friend and a penalty applied to the other team. The page's many helper/category counters are claims, not measurements. The public start CTA resolves to `/login?redirect=%2Fstart-game`. The contact page contained Seen Jeem contact details; this is an observed inconsistency, not evidence about shared ownership or copied internals.

Jam3aa exposes 37 category descriptions in collected landing HTML, including observation, audio, ordering, football careers and charades. Its guide describes 30 seconds reading + 30 answering + 10 for an opposing opportunity, captain confirmation and numeric tolerance. Helpers include a friend, double points and two answers. The guide explains creating on one device and resuming through the user's saved items on another. Login/register collects more details than guest-first entry; policies describe credits, XP and external activation codes. None of these backend guarantees was independently tested.

Seen So2al explains two answers, a friend, opposing-point subtraction, extra points and resting an opponent; gifts and FAQ entry points are visible. The root/next redirect was observed, without completing account creation. Category/pricing availability, freshness and helper timing remain U.

## Visual/mobile/accessibility observations

Jawabha uses a red/orange illustrated hero and framed application; Seen Jeem uses red/orange branding, illustrated special-category cards and horizontal carousels. Asbghm uses purple/lime, spacious editorial sections, a demo board, package selector and theme controls. Befateen uses dark/orange sections with illustrated cards; its mobile layout stacks tiles and simplifies navigation. Jam3aa's mobile landing is a very long category list, with partially unavailable image/video regions in the captured environment. Seen So2al stacks navy/orange cards and helpers on mobile and exposes a collapsed menu.

These are screenshot observations. There was no complete competitor keyboard/screen-reader/contrast audit, performance benchmark, or authenticated game responsiveness assessment. Asbghm's skip link and theme controls are present; their presence alone does not establish accessibility compliance. Popup/cookie layers and missing third-party media affect the captured first impressions. Nabeeh has its own tested keyboard/focus, contrast, reduced-motion, RTL and media equivalents, with an original forest/ivory/ochre identity.

## Visited public routes

- Jawabha: `/`, `/#how`, `/terms.html`, `/privacy.html`; additionally collected HTML overview/editorial routes `/lo3bat-jawabha`, `/asilah-amma`, `/alaab-jamaia`, `/masrahiyat-kuwaitiya`.
- Seen Jeem: `/`, `/start-game`, `/contact-us`, `/login`.
- Asbghm: `/`, `/#about`, `/#categories`, `/login`, `/howtoplay`, `/categories`, `/faq`, `/contact`, `/terms-and-conditions`, `/privacy-policy`, `/terms-and-conditions/community`. Earlier sitemap HTML collection also covered `/our-story` and `/helpcenter`.
- Befateen: `/`, `/login?redirect=%2Fstart-game`, `/contact-us`, `/my-games`, `/about`, `/faq`, `/terms`, `/privacy`.
- Jam3aa: `/`, `/login`, `/register`, `/how-to-play`, `/contact`, `/terms`, `/privacy`; `/dmca` additionally collected as HTML.
- Seen So2al: `/`, `/?next=%2Fnew`, with public landing/account/start controls inspected. No successful authenticated `/new` flow.

## Original product decisions

Nabeeh adopts the broadly shared gathering pattern: clear categories, shared-screen teams, graduated points, host adjudication, bounded helpers and persistent resume. It improves the specified freshness requirement through stable canonical IDs, permanent exposure records and atomic multi-participant reservations, rather than inferring competitor guarantees from marketing claims. Guest entry reduces setup friction; account linking supports cross-device continuity without requiring a phone/email for the pilot.

Original image/audio/video/word/ordering drafts extend the finite release pack without reusing reference content. Human review, source/rights records, expiry for changing facts, review revisions, budgets and visible replenishment support controlled growth. Empty inventory is reported honestly, never reset automatically. Licensed external packs, tournaments, payments, email/OIDC and live Arabic semantic evaluation remain future work requiring additional product/provider decisions.
