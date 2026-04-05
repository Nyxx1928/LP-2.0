# Likhang Pinas Commerce Monorepo

This repository hosts the MVP ecommerce platform for Likhang Pinas.

## Architecture

- apps/backend: Medusa v2 backend service
- apps/storefront: Next.js 15 storefront
- packages/types: shared TypeScript contracts
- packages/ui: shared UI primitives and components
- packages/utils: shared utility helpers
- packages/config: shared configuration presets
- infra: local infrastructure and environment templates

## Current implementation status

- Monorepo folder architecture scaffolded
- Root workspace, Turbo, TypeScript baseline created
- CI and infra templates initialized

## Next implementation steps

1. Scaffold Medusa in apps/backend.
2. Scaffold Next.js app in apps/storefront.
3. Wire packages into both applications.
4. Add linting and test runners per app.
