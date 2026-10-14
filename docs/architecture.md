# Nabeeh product and architecture

## Product and flows

Arabic-first shared-screen party game, two teams, no registration required. Home → category discovery → mode/team/timer/lifeline configuration → persistent game board → question → reveal → host adjudication → result. Resume opens the same server-owned board. Account registration/login merges guest exposures by union; authenticated sessions on another browser share the same profile. Anonymous history follows a secure persistent cookie, not a fingerprint; deleting that cookie loses access unless linked to an account.

Original identity: forest green, warm ivory, ochre accent, coral/purple team colors, large Arabic headings, clean tile geometry. Semantic controls, visible focus, descriptive status, reduced motion, mobile scrollable board and large question display. No copied imagery. Player labels do not impersonate authenticated participants.

## Decisions

TypeScript React/Vite + Express + PostgreSQL. One origin serves frontend/API, so cookies and CSRF checks have clear scope. Direct parameterized SQL makes locking and invariants reviewable. Plain SQL migrations, real PostgreSQL integration tests; local embedded PostgreSQL is a development convenience only. Production uses a maintained external PostgreSQL service. No worktree is needed.

Canonical question identity is global. Categories join canonical questions; variants share one canonical ID. Exact normalized hashes and structured fact keys reject obvious duplicates; lexical retrieval finds uncertain similarities. Optional external embeddings and model adjudication are interfaces, not claimed mathematical semantic equivalence. Human reviewers own uncertain matches; adversarial/paraphrased facts cannot be guaranteed by string matching alone. Never auto-approve model output.

## Persistence and concurrency

Profiles (guest or account), users, opaque hashed sessions; categories, canonical questions, variants, answers, evidence; games, teams, players, selected categories, board instances, score events, lifeline usage; exposures; favorites; candidates, review tasks, duplicate candidates, generation jobs, reports and audit logs. Foreign keys, unique profile+canonical exposure, unique score event per instance, partial unique active reservation per profile+canonical. Store authoritative question text only on server until a tile is opened; return answers only after reveal.

Game creation locks every participant profile in sorted UUID order, selects approved/current canonical questions excluding exposures and active reservations for all participants, then reserves under those same locks. Indexed UUID rotation bounds the candidates per slot; bipartite matching handles categories that share questions without greedy false exhaustion. Selection fails transactionally if inventory is insufficient. Opening locks the game and records exposures for all relevant profiles before returning text. Game close releases unopened reservations; displayed questions remain permanently excluded. Scoring locks the game, uses the instance ID as an idempotency boundary, and commits score/turn/status atomically. Lifeline usage is unique by game/team/kind. Timers store server timestamps; clients render remaining time, and server checks deadlines.

Shared policy defaults to the host plus explicitly linked authenticated participants. A participant authorizes their involvement with a short-lived one-use join credential; a typed player name is display metadata only. This prevents a host from reading arbitrary users' histories.

## API contract

`GET /api/me`, `POST /api/auth/register|login|logout|recover`, `POST /api/participants/token`, `GET /api/categories?q=&region=&difficulty=`, `POST /api/favorites`, `GET|POST /api/games`, `GET /api/games/:id`, `POST /api/games/:id/open|respond|reveal|score|lifeline|abandon`, `GET /api/games/:id/media/:instance`, `GET /api/account/export`, `DELETE /api/account`. Mutations require a same-origin request and `X-Nabeeh-Request: 1`. Zod rejects malformed requests. Errors have Arabic messages and stable codes.

Admin APIs enforce the database role, expose candidate review/generation/import/export and audit metrics. Seed administration is provisioned via a CLI, never a public privilege toggle. Rate limits supplement authorization, not replace it. Cookies are HTTP-only, same-site lax, secure in production. Passwords use scrypt + per-password salts. Session tokens are random and only SHA256 digests persist. Production requires HTTPS, proxy topology configuration, external DB backups and secret management.

## Content lifecycle

Generate/import → validate shape → normalize/hash → structured fact lookup → semantic candidate retrieval → pending review or reject → evidence verification + human approval → canonical approved pool. Approval never clears exposures. Sources/provenance/date are mandatory for factual candidates; sensitive/time-dependent questions require stronger manual review and expiration. Supported auto-verification is deliberately restricted to deterministically solved arithmetic; jobs still enter the review queue. Model provider failure does not affect gameplay.

Jobs use `FOR UPDATE SKIP LOCKED`, lease expiry and unique lease tokens that reject stale completions, bounded attempts, daily budget reservation, timeout, conservative cost ceilings and audit. Generation during gameplay is forbidden. Low inventory queues a replenishment request in the background and returns an explicit Arabic inventory error without repeats. Hard budget limits require provider-side budget controls too, because providers may charge failed requests.

## Verification

Real DB integration tests cover cross-category/variant exclusion, reservations under concurrency, exposure on display, refresh/resume, account history union/cross-device, no recycling, pending-content exclusion, score/lifeline idempotency, unauthorized access, independent users and shared participants. Browser tests play a complete game, resume after reload, exercise keyboard and axe accessibility, and inspect three viewport sizes. Load checks record latency rather than claim production capacity from local tests.

## Scope and remaining work

The release pack contains 36 original drafts with text, image, audio, video, ordering and word puzzles. Human approval is pending; production has no approved release bank yet. Accounts use private single-use recovery keys, not email reset. Choice and ordering responses persist in PostgreSQL. Bundled original media is immutable; optional private S3 uploads are served only to authorized games/editors.

One free instance uses memory rate limits. Optional shared Redis limits have been tested across two server processes and must be enabled before multiple replicas. Database TLS, pool bounds and statement timeouts are configurable. Optional pgvector HNSW retrieval was validated with synthetic vectors; live Arabic embeddings and external S3 credentials remain unvalidated. Payments, tournaments, email/OIDC, provider benchmarks and hosted capacity checks remain future work. Public-reference research is documented in research.md.
