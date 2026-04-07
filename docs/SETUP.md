# Setup

## Prerequisites

- Node.js LTS
- pnpm
- Docker Desktop

## Backend Environment

The backend uses Medusa and requires PostgreSQL + Redis.

- Backend env file: `apps/backend/.env`
- Test env file: `apps/backend/.env.test`
- Reference template: `apps/backend/.env.template`

Required values for local Docker setup:

- `DATABASE_URL=postgres://postgres:postgres@localhost:5432/likhang_pinas`
- `DB_HOST=localhost`
- `DB_PORT=5432`
- `DB_USERNAME=postgres`
- `DB_PASSWORD=postgres`
- `REDIS_URL=redis://localhost:6379`
- `STORE_CORS=http://localhost:3000,http://localhost:8000,https://docs.medusajs.com`
- `ADMIN_CORS=http://localhost:5173,http://localhost:9000,https://docs.medusajs.com`
- `AUTH_CORS=http://localhost:3000,http://localhost:5173,http://localhost:9000,http://localhost:8000,https://docs.medusajs.com`
- `JWT_SECRET=supersecret`
- `COOKIE_SECRET=supersecret`

## Local bootstrap

1. Install dependencies from repository root.
2. Start local data services via Docker compose.
3. Start backend and storefront apps.

## Backend-first Start Flow

1. Install deps.
2. Start Postgres and Redis.
3. Start backend.
4. (Optional) seed demo data.
5. Start storefront.

## Commands

- pnpm install
- docker compose -f infra/docker/docker-compose.dev.yml up -d
- pnpm --filter @likhang/backend dev
- pnpm --filter @likhang/backend seed
- pnpm --filter @likhang/storefront dev

## Verification

- Backend health check should return `200` on `GET /health`.
- Backend integration health test:
  - `pnpm --filter @likhang/backend test:integration:http`

If startup logs show DB connection retries, verify Docker is running and that `DATABASE_URL` in `apps/backend/.env` points to the same database credentials as `infra/docker/docker-compose.dev.yml`.
