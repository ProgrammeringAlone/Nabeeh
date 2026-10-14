# Delivery status — 2026-10-14

Nabeeh is implemented and prepared for a free Render + Neon pilot. No public service URL has been deployed or verified yet. The user has created both provider accounts and will review the release pack. Production currently has **zero approved release questions**; all 36 original release proposals remain drafts.

## Implemented

- Original Arabic RTL discovery, setup, classic/rapid two-team games, timers, lifelines, host scoring, results, favorites and persisted resume.
- HTTP-only guest/account sessions, asynchronous scrypt, cross-device account history, consent-based participants, export/deletion and single-use private recovery keys.
- Canonical IDs and permanent exposure exclusion across modes/categories; sorted participant locks, atomic reservations, indexed bounded selection and matching for overlapping pools. Display records exposure; score retries remain idempotent.
- Text, choice, ordering, word, image, audio and video question presentation. Choice/order responses persist. Protected media supports byte ranges and equivalents; answers/aliases/order solutions stay hidden until reveal.
- Editorial JSON import, draft editing with revision checks, exact/structured/media-byte duplicate signals, indexed lexical retrieval, human approval, canonical corrections, source verification, retirement, media previews, audit and admin access controls.
- Durable arithmetic/model jobs, budgets, lease tokens rejecting stale workers, replenishment requests and an event-driven embedded worker for the free pilot. Generated content always waits for review.
- Optional shared Redis quotas, verified database TLS, bounded connection pools/timeouts, conditional pgvector HNSW indexing and private S3-compatible upload interfaces.
- Free Render Blueprint, Node 24 Docker image, isolated database checks, GitHub CI workflow, tested installation and deployment/recovery runbooks.

The finite pack contains 36 original drafts: six each image, audio, video, ordering, Arabic word and arithmetic. Its 18 bundled assets were created for Nabeeh. The older 48 development questions remain development-only and are excluded from production. Review notes/source quality and rights are editorial responsibilities.

## Validation

| Check | Observed result | Scope |
| --- | --- | --- |
| Locked installation, migrations, draft preparation and TypeScript/Vite build | Passed | Existing local checkout/database |
| PostgreSQL integration suite | 27 passed, no failures/skips | Isolated real database |
| Chromium browser suite | 18 passed | Desktop 1440×1000, tablet 820×1180, mobile 390×844 |
| Browser gameplay/content/accessibility | Complete games, reload, accounts/recovery, editor edit/approve/access, six formats and protected media; no axe violations in tested screens | Automated checks plus screenshot inspection, not a complete human accessibility audit |
| Concurrent game workload | 30 players, 60 completed games, 900 requests, 0 failures; p50 16 ms, p95 37 ms | Local isolated DB, concurrency 10; no hosted capacity guarantee |
| Shared rate limits | Two separate app processes shared one real Redis quota; fourth request blocked after three allowed | Local Redis |
| Semantic index | Real pgvector/HNSW nearest-neighbor and query-plan check passed with 80 synthetic fixtures | No live Arabic provider/recall evaluation |
| Backup restoration | Consistent real PostgreSQL snapshot restored with matching records and exposure digest | Isolated local destination |
| Runtime dependency audit | 0 reported vulnerabilities | Check time; not a security certification |
| Production Docker runtime | Fresh schema, 36 pending drafts/18 media assets, compiled RTL frontend, secure sessions and nonroot process | Local container; hosted HTTPS still pending |

Research covers rendered public pages at all six supplied origins, with desktop/mobile captures and public navigation. Your explicit platform-CA authorization resolved the browser trust block. Login, checkout, live scoring persistence and paid flows remain untested where unavailable without an account/payment; see research.md. No proprietary question bank was imported.

## Remaining launch steps

1. Deploy the prepared branch to a Free Render web service with a secret Neon Free pooled DATABASE_URL.
2. Create the owner's account, keep its recovery key privately, and provision admin through the trusted startup variable.
3. Review and approve individual release drafts; verify any additional factual content with exact citations. Approval never clears exposure history.
4. Validate the public URL, HTTPS/cookies, editor, complete games, refresh and second-browser resume on the actual host.
5. Before broad launch, decide support contact, terms/retention, monitoring and backup policy. Enable shared Redis before multiple replicas and measure real hosted capacity before selecting paid scale bounds.

Live model/embedding/judge calls and external S3 remain unvalidated without secure provider bindings. The free deployment has no model key and a zero AI budget. Payments, tournaments and email/OIDC are future work. Universal semantic paraphrase detection cannot be guaranteed by lexical checks or a model; consistent canonical facts and human review remain essential.

The cloud installation/startup configuration is saved separately for environment review. Saving a draft does not publish it or prove a fresh-task restoration.
