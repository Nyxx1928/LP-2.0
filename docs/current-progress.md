# Current Progress — Implementation Status

**Date:** 2026-04-07

This document summarizes the repository's current implementation status, what's complete, what remains to be done, and recommended next actions to reach the MVP gate.

## Summary

- **Monorepo scaffolded** with `pnpm` and Turbo; apps live under `apps/` and shared packages under `packages/`.
- **Medusa backend** scaffold present and runnable (dev scripts, seed script, env-driven config).
- **Next.js storefront** scaffold with basic homepage, auth page, and Playwright E2E skeleton.
- **CI pipeline** includes lint/typecheck, unit/integration tests, Playwright E2E, Docker builds, and security scans.
- **Docker compose** for local Postgres + Redis is present for dev.

## Completed / Implemented

- **Repository & docs:** [docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md), [docs/plan.md](docs/plan.md), [docs/prd.md](docs/prd.md)
- **Backend scaffold (Medusa v2):** [apps/backend/package.json](apps/backend/package.json), [apps/backend/medusa-config.ts](apps/backend/medusa-config.ts)
- **Seed & demo data scripts:** [apps/backend/src/scripts/seed.ts](apps/backend/src/scripts/seed.ts)
- **Storefront scaffold (Next.js):** [apps/storefront/package.json](apps/storefront/package.json), [apps/storefront/app/page.tsx](apps/storefront/app/page.tsx), [apps/storefront/app/auth/page.tsx](apps/storefront/app/auth/page.tsx)
- **Dev compose:** [infra/docker/docker-compose.dev.yml](infra/docker/docker-compose.dev.yml)
- **CI pipeline:** [.github/workflows/ci.yml](.github/workflows/ci.yml)
- **Playwright E2E skeleton:** [apps/storefront/tests/e2e/home.spec.ts](apps/storefront/tests/e2e/home.spec.ts)
- **Environment example:** [.env.example](.env.example)

## In-Progress / Partial

- **Seed localization:** Seed script populates EU/USD region data; needs Philippines localization (currency, zones).
- **Observability:** `apps/backend/instrumentation.ts` is present but commented out (instrumentation not enabled).
- **Storefront checkout flows:** Homepage and auth are implemented; cart/product/checkout flows are placeholders.
- **Payment wiring:** env placeholders exist (`STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMONGO_*`) but no webhook handlers or payment-plugin wiring found.

## Missing / Needed Work (by priority)

High priority

- **Payments & Webhooks:** Implement Stripe (and chosen PH gateway) integration, webhook verification, and idempotency. Update `apps/backend/medusa-config.ts` and add webhook processors and retry/dead-letter handling. See [.env.example](.env.example) for env variables.
- **Secrets Management:** Remove fallback secrets (eg. `supersecret`), use a hosted secret store for production, and document local dev `.env` usage.
- **Checkout Implementation:** Build product detail, cart, and checkout pages and wire storefront to backend order creation and payment flows.
- **Seed Localization:** Update `apps/backend/src/scripts/seed.ts` to create Philippines region, set PHP currency by default, and run `pnpm --filter @likhang/backend seed` to validate computations.

Medium priority

- **Observability & Monitoring:** Enable `instrumentation.ts`, pick an exporter/OTLP destination, and add structured logs + tracing for payment/order flows.
- **Search Integration:** Choose and integrate Meilisearch (or alternative) and ensure product indexing lifecycle on create/update/archive.
- **Security Hardening:** Add CSP, secure cookie flags, rate limiting middleware for login/checkout/admin endpoints.
- **Chat system:** Design and implement real-time customer support chat (auth mapping, storage, moderation). See [docs/chat-system.md](docs/chat-system.md)

Low priority

- **Courier integration:** Integrate one Philippines courier provider and fallback shipping rates.
- **Runbooks & Ops:** Backup/restore drills, on-call runbook, and monitoring alerts for payment/order failures.

## Quick Local Commands

```bash
pnpm install
pnpm --filter @likhang/backend dev
pnpm --filter @likhang/storefront dev
# Seed backend (ensure env vars are set first)
pnpm --filter @likhang/backend seed
# Run dev services
docker compose -f infra/docker/docker-compose.dev.yml up -d
```

## Suggested next immediate steps (1–3)

1. Set local `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET`, then implement a minimal webhook handler in `apps/backend` that verifies signatures and marks events idempotently.
2. Update `apps/backend/src/scripts/seed.ts` to add a Philippines region, set PHP currency by default, and run `pnpm --filter @likhang/backend seed` to validate computations.
3. Implement a minimal server-side checkout endpoint and wire the storefront `Buy` flow to create an order and start payment (allows end-to-end smoke tests).

## Where to inspect code (quick links)

- PRD: [docs/prd.md](docs/prd.md)
- Plan: [docs/plan.md](docs/plan.md)
- Project start docs: [docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md)
- Backend config: [apps/backend/medusa-config.ts](apps/backend/medusa-config.ts)
- Seed script: [apps/backend/src/scripts/seed.ts](apps/backend/src/scripts/seed.ts)
- Storefront homepage/auth: [apps/storefront/app/page.tsx](apps/storefront/app/page.tsx), [apps/storefront/app/auth/page.tsx](apps/storefront/app/auth/page.tsx)
- CI: [.github/workflows/ci.yml](.github/workflows/ci.yml)
- Env example: [.env.example](.env.example)

- Chat system plan: [docs/chat-system.md](docs/chat-system.md)

---

If you'd like, I can start by implementing the Stripe webhook handler and updating `medusa-config.ts` to enable the payment plugin — shall I proceed with that?
