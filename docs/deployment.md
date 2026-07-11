# Deployment

**Status: not yet implemented.** Nothing in this repo currently deploys anywhere — there is no production environment, no app Dockerfile, and no deploy job. This document describes (1) what exists today, and (2) the target deployment approach (AWS + GitHub Actions), so implementation work has a clear direction instead of being decided ad hoc when the time comes. Treat section 2 as a proposal to confirm, not a decision already made.

## 1. Current State

* **CI**: `.github/workflows/ci.yml` runs on push to `main`/`develop` and on PRs into `main` — `npm ci`, `tsc --noEmit`, `npm run lint`, `prisma validate`. No build, test, or deploy step exists yet.
* **Local dev infra**: `docker-compose.yml` runs Postgres 16 and Redis 7 for local development only. The Next.js app itself runs via `npm run dev`/`next start`, not in a container.
* **Config**: `lib/config.ts` requires `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `NEXT_PUBLIC_APP_URL` at startup (throws immediately if any are missing) — see `.env.example`. Any deploy target must supply these.
* **Database migrations**: none exist yet (`prisma/migrations/` is absent — schema has only been applied via `prisma db push`). This must be resolved (switch to `prisma migrate deploy`-driven history) before there's a real production database to protect. See [database.md](database.md).
* **Background jobs**: BullMQ and `ioredis` are dependencies but no queue/worker is implemented yet, so there's currently nothing that needs a separate worker process.

## 2. Target Approach: AWS + GitHub Actions

This aligns with the project's stack (Next.js, Postgres, Redis/BullMQ) and the direction noted in the project roadmap. Proposed shape, minimal enough to run this app without over-building infrastructure for a system this size:

### Compute
* **App**: containerize the Next.js app (`next build` → `output: 'standalone'`, run behind a small Node process) and run it on **ECS Fargate** rather than raw EC2 — no servers to patch, scales to zero-effort for a project this size, and GitHub Actions can push directly to it. (EC2 is a reasonable fallback if ECS is judged unnecessary complexity, but it means owning OS patching, process supervision, and zero-downtime deploys by hand — worth deciding deliberately rather than defaulting to it.)
* **Background jobs** (once BullMQ workers exist): a second small ECS service/task running the worker process, sharing the same image, pointed at the same Redis.

### Data
* **Database**: **RDS for PostgreSQL** (matching the local `postgres:16` version), Multi-AZ only once there's a real availability requirement — start single-AZ to control cost.
* **Cache/queue**: **ElastiCache for Redis**, matching local `redis:7`.
* **File storage** (when needed — PDF exports, receipts, etc.): **S3**, accessed via presigned URLs rather than proxying files through the app server.

### Networking
* App and worker in private subnets; RDS and ElastiCache in private subnets with security groups scoped to the app's security group only (never publicly reachable).
* An Application Load Balancer (or ECS-managed ingress) in front of the app service for TLS termination.

### CI/CD (GitHub Actions)
Extend the existing `ci.yml` rather than replacing it — keep typecheck/lint/`prisma validate` as required checks, and add a deploy workflow gated on merge to `main`:

1. Run the existing CI checks (fail fast, same as today).
2. Build and push a Docker image to **ECR**, tagged with the commit SHA.
3. Run `prisma migrate deploy` against the target database as a distinct step *before* the new app version goes live — migrations and app deploys should not be bundled into one implicit step, so a failed migration blocks the deploy instead of partially rolling out.
4. Update the ECS service to the new image (`aws ecs update-service --force-new-deployment` or an action like `aws-actions/amazon-ecs-deploy-task-definition`), relying on ECS's rolling deployment for zero-downtime rollout.
5. Deploy the worker service (if/when it exists) the same way, from the same image.

### Environments
* At minimum: **staging** (auto-deploy on merge to `main`) and **production** (manual approval / tag-triggered), each with its own RDS instance, ElastiCache instance, and secrets — never share a database between environments.
* `develop`/`main` branch roles should be confirmed against the existing CI trigger (`ci.yml` already treats both as first-class branches) before wiring deploy triggers to either.

### Secrets
* Use **GitHub Actions environment secrets** (scoped per environment: staging/production) for `AWS_*` deploy credentials, and **AWS Secrets Manager** (or SSM Parameter Store) for runtime app secrets (`DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`) injected into the ECS task definition — never bake secrets into the Docker image or commit them.
* Rotate `JWT_SECRET` deliberately: rotating it invalidates all existing sessions (see `lib/auth.ts`), so treat it as a breaking action requiring a heads-up, not a routine rotation.

### Observability
* Ship container logs to **CloudWatch Logs** (default for ECS/Fargate) at minimum; the app already differentiates `NODE_ENV` for Prisma query logging (`lib/prisma.ts` logs `query`/`error`/`warn` in development, `error` only in production) — keep production log volume in mind before adding more verbose logging.
* Add basic uptime/error alerting (CloudWatch Alarms or a lighter tool) before this handles real orders — there is none today.

## 3. Rollback

* Because deploys are image-tagged by commit SHA, rolling back the app is redeploying the previous task definition/image — keep this fast and documented once the pipeline exists.
* Migrations are the harder part of rollback: since there's no migration history yet, establishing `prisma migrate deploy` with reviewed, additive-first migrations (per [database.md](database.md)) is what makes rollback actually feasible later — a destructive migration with no down-migration plan can make an app rollback pointless if the schema no longer matches.

## 4. Open Decisions

These need a decision before implementation starts, not assumptions baked into automation:

* ECS Fargate vs. plain EC2 (cost vs. operational simplicity trade-off).
* Whether `develop` deploys anywhere (a second staging-like environment) or is purely a pre-`main` integration branch.
* When to introduce a true migration history (`prisma migrate deploy`) — this should happen before any shared/production database exists, not after.
