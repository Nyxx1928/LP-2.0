# Project Status

**Last updated:** 2026-05-24

## Overview

This document summarizes the overall project status, including what is done, what remains, current plans, repository structure, and the high-level architecture.

## Done / Implemented

- Monorepo scaffolded with `pnpm` workspaces and Turborepo.
- Medusa v2 backend scaffold present and runnable.
- Next.js 15 storefront scaffold with basic pages.
- CI pipeline includes lint, typecheck, tests, builds, and scans.
- Local dev Docker compose for Postgres and Redis.
- Seed script and example env file.

## In Progress / Partial

- Seed localization (needs Philippines region and PHP default).
- Observability wiring exists but is not enabled.
- Storefront cart/product/checkout flows are placeholders.
- Payment wiring envs exist, but webhooks and plugin wiring are not implemented.

## To Do (Priority)

High priority

- Implement Stripe integration with webhook verification and idempotency.
- Implement one Philippines payment gateway integration.
- Build product detail, cart, checkout, and order flows in the storefront.
- Add Philippines region, currency, and shipping zones to seed.
- Remove fallback secrets and document dev env usage.

Medium priority

- Enable instrumentation and structured logging.
- Integrate search (Meilisearch or alternative) and indexing lifecycle.
- Add security headers, CSP, secure cookie policy, and rate limiting.
- Implement chat system per design document.

Low priority

- Courier integration for Philippines carrier.
- Ops runbooks: backup/restore drills, alerting, on-call.

## Plans (Phases)

- Phase A: Product and compliance definition.
- Phase B: Architecture and environment baseline.
- Phase C: Core platform bootstrapping.
- Phase D: Commerce domain setup.
- Phase E: Payments and order reliability.
- Phase F: Storefront implementation.
- Phase G: Security hardening and observability.
- Phase H: Quality engineering and launch readiness.
- Phase I: Post-launch operations and scaling.

## Architecture (MVP)

- Backend: Medusa v2 (TypeScript)
- Storefront: Next.js 15 (TypeScript)
- Monorepo: Turborepo + pnpm workspaces
- Data: PostgreSQL + Redis

## Repository Structure (Top-Level)

- apps/backend
- apps/storefront
- packages/types
- packages/ui
- packages/utils
- packages/config
- infra/docker
- infra/environments
- infra/scripts
- docs

## Key Risks / Gaps

- Payment flows are not implemented end-to-end yet.
- Checkout flow is not wired to backend order creation.
- Observability and security hardening are not enabled.
- Seed data does not yet reflect Philippines defaults.

## Suggested Next Steps (1-3)

1. Implement Stripe webhook handler with idempotency and wire Medusa payment plugin.
2. Update seed script for Philippines region and PHP currency defaults; validate with seed run.
3. Implement minimal checkout flow end-to-end for smoke tests.

## References

- docs/current-progress.md
- docs/plan.md
- docs/ARCHITECTURE.md
