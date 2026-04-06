# Architecture

## MVP stack

- Backend: Medusa v2 (TypeScript)
- Storefront: Next.js 15 (TypeScript)
- Monorepo: Turborepo + pnpm workspaces
- Data: PostgreSQL + Redis

## Repository layout

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

## Scope notes

- No separate admin app in MVP scaffold
- Payment target includes Stripe and PayMongo integration paths
- Search starts with built-in DB strategy for MVP
