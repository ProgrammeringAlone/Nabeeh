# Running and operating Nabeeh

For the user's free Render + Neon pilot, follow [launch.md](launch.md). The repository includes a Free Render Blueprint, Node 24 Docker image and pending original release pack. There is no automatic editorial approval and no paid model call in the pilot configuration.

## Local/cloud development

Use Node 24+, the npm lockfile and Chromium. The prepared checkout is `/workspace/Nabeeh`; use it without a worktree unless requested.

```sh
bash scripts/setup.sh
npm run db:local      # separate terminal if SQL is not already running
npm run dev           # separate terminal
```

The install script installs locked dependencies, starts a temporary local database if necessary, applies migrations, refreshes development fixtures, indexes facts, prepares review drafts and builds the frontend. It reuses an existing DATABASE_URL when configured and refuses to replace an unreachable external database. Stop development app processes before npm ci refreshes node_modules, then restart them. Preserve existing .env files.

Local PostgreSQL lives in ignored `.local/postgres`, listening only on 127.0.0.1:54329. Its documented password is local-only. Never use it publicly. No environment file is needed for local defaults. `RUN_WORKER=true npm run dev` starts the embedded event-driven worker; alternatively use `npm run worker` separately, with RUN_WORKER=false on the app. Arithmetic proposals require review; model calls additionally require a server key and positive budget.

```sh
npm run build
npm test
npm run test:e2e
npm run test:game-load
```

Integration/browser/load runners reset only their isolated `_test`, `_e2e` or `_load` databases. Never target production. The local role needs CREATE DATABASE. Browser tests start their own server and database; they do not need the development app running. Use `/usr/bin/chromium`, or CHROMIUM_PATH for another executable. Test scaling against a local Redis instance, vector retrieval against a separate pgvector PostgreSQL database, and restore with a PostgreSQL 18 Docker client; scripts refuse remote destinations. Runtime processes do not survive environment snapshots.

## Production configuration

The Docker default startup runs migrations, prepares release drafts and optionally provisions an operator-specified admin, then serves the compiled frontend/API. HTTPS, secure cookies and DATABASE_URL are required. APP_ORIGIN must be the exact HTTPS origin; Render's trusted RENDER_EXTERNAL_URL supplies it when unset. A custom domain needs an explicit APP_ORIGIN.

Use Neon's pooled PostgreSQL URI with verified TLS; DATABASE_SSL_REQUIRED=true is provided in render.yaml. Optional DATABASE_MIGRATION_URL can use the direct endpoint. Database pools default to 10 connections; the pilot sets 5 and a 15-second statement timeout. Across replicas/workers, budget total connections with headroom for migrations/operators. Keep secrets in provider environment settings, never browser bundles or chat.

TRUST_PROXY_HOPS is bounded and must match the verified topology. The Render Blueprint sets 1 for its public proxy. Review this if adding a CDN or another proxy. A single pilot instance uses memory quotas. Before adding replicas, configure Redis and REQUIRE_SHARED_LIMITS=true; shared quotas have passed a real two-process Redis check and fail closed on store errors.

To grant an existing account admin, set ADMIN_USERNAME to its exact username and run npm run admin:create, or redeploy the Render service with that variable temporarily. Its password remains unchanged. Creating a new account through the CLI also needs a securely supplied ADMIN_PASSWORD of 14+ characters. Remove the deployment variable after provisioning. Public endpoints cannot grant initial admin. Subsequent audited role management protects the final administrator.

Optional private S3-compatible editorial uploads use MEDIA_BUCKET, MEDIA_ENDPOINT, MEDIA_REGION, MEDIA_ACCESS_KEY_ID and MEDIA_SECRET_ACCESS_KEY. Bundled originals require no account. Authenticated game/editor routes protect media, check immutable byte identity and support ranges. External object-store credentials have not been exercised yet.

Compose uses pgvector PostgreSQL 17 and a separate worker after app health/migrations. It binds the app to host loopback and expects a TLS reverse proxy. Set a strong URI-safe password or a properly encoded DATABASE_URL. For larger deployments run migrations as a release job before starting the worker. The local Docker smoke check establishes packaging, not hosted HTTPS behavior.

Docker builds behind the platform proxy can use ephemeral BuildKit secrets for build_proxy and build_ca. scripts/docker-build.py resolves the existing proxy hostname and supplies those secrets. They are not build arguments or image layers. Package integrity and TLS checks remain enabled.

## Recovery and operations

Accounts have private single-use recovery keys valid for one year. Signup, password recovery and authenticated regeneration issue fresh keys. Recovery revokes old sessions while preserving games and exposures. There is no email reset unless a verified email/OIDC integration is added.

Use the managed database's available recovery/PITR, encrypted logical backups and restricted access. Provision a PostgreSQL service/passfile securely rather than exposing a connection URI in logs/process arguments. Restore into an isolated database first, then check migrations, records, exposure history, game resume and score uniqueness before switching traffic. Never truncate exposures to refill content. npm run test:restore exercised a real consistent pg_dump snapshot and pg_restore into an isolated local database.

Monitor /health, HTTP failures, query latency, connections, job leases/backlog, review backlog, approved inventory and generation costs. The editor shows durable replenishment requests. Set provider-side spend limits before any paid model activation. Free Render suspension limits unattended work; durable jobs resume while the service is awake. Define support contact, terms and data/backup retention before broad registration.

Live Arabic model quality, external S3, real hosted traffic, provider billing behavior and paid autoscaling remain unvalidated. See status.md for measured local results and launch.md for the next external steps.
