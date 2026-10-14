# Nabeeh cloud runtime startup

Use the existing checkout at /workspace/Nabeeh. Cloud tasks are isolated; do not create a worktree unless requested. Preserve user changes and .env files. Read README.md, docs/deployment.md and docs/status.md. Use Node 24+ (tested 24.19). Dependencies, migrations, frontend output and local PostgreSQL files are retained in the prepared filesystem; processes must be restarted after snapshots.

1. Use an existing DATABASE_URL binding without printing it. Otherwise test the local database with:
   node --import tsx --input-type=module -e 'import {pool} from "./server/db.ts"; await pool.query("SELECT 1"); await pool.end();'
   If local SQL is down and DATABASE_URL is unset, start node --import tsx scripts/local-db.ts in a background terminal with logs in .local/postgres.log. It reuses .local/postgres and listens only on 127.0.0.1:54329. Wait for SQL readiness. Do not replace an unreachable configured external database.
2. Run npm run db:migrate, npm run db:index-facts and npm run release:prepare. Do not reset schemas or exposure history. npm run db:seed is idempotent development-only and refuses production. Release preparation creates pending drafts, never approves them.
3. Start RUN_WORKER=true GENERATION_DAILY_BUDGET_CENTS=0 npm run dev in a background terminal. Check logs and /health for status ok, then /api/me and /api/categories with a cookie-preserving client. The embedded event-driven worker prepares original arithmetic proposals while awake. Do not run a second worker unless testing that behavior deliberately. Optional model bindings are server-only; free-pilot AI budget remains zero.
4. npm run build checks TypeScript and packaging; npm test resets only the isolated nabeeh_test database. npm run test:e2e owns an isolated nabeeh_e2e database/server and tests games, recovery, all formats, editing and axe at three sizes. npm run test:game-load owns nabeeh_load and records a local benchmark. Never point tests at production. Shared-limit/vector/restore scripts need their documented local Redis/pgvector/Docker prerequisites.
5. Before npm ci refreshes dependencies, stop app processes you started and restart afterward. scripts/setup.sh installs dependencies, applies migrations, prepares content and builds; it does not leave a runtime server running.

For hosting follow docs/launch.md: Free Render + Neon, verified database TLS, HTTPS secure cookies, exact proxy topology and human-reviewed release content. Redis is required before multiple web replicas. No paid model/storage/scaling resource is authorized by the current free budget. Never print keys, connection strings, recovery codes or proxy credentials.

The user explicitly approved the platform proxy CA ending 56:CD:7F:C3, and verified browser research succeeded using Chromium's NSS trust store. Keep TLS verification enabled. Persistent NSS access may require task-scoped filesystem permission if Chromium reports a read-only store; existing trust does not authorize importing a different certificate. docs/research.md distinguishes public rendered screens, described features and untested account/payment behavior.

Do not offer loopback preview links through the onboarding UI. Saved environment configuration is separate from publication and a fresh-task restore; neither is established by a draft save.
