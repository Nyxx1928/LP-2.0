# Project structure & how to start

This document explains the repository layout and shows how to start the frontend and backend locally.

---

## Overview

- Monorepo managed with `pnpm` and `turbo` (see root `package.json`).
- Node engine requirement: `>=20` (the backend declares this in `apps/backend/package.json`).
- Workspaces are under `apps/` and shared code/packages live under `packages/` and other top-level folders.

## Top-level structure

- `package.json` (root): monorepo scripts using `turbo` (e.g. `dev`, `build`).
- `apps/` - main applications
  - `apps/backend/` - Medusa backend (APIs, services, scripts). See `apps/backend/package.json` and `apps/backend/medusa-config.ts`.
  - `apps/storefront/` - Next.js frontend. See `apps/storefront/package.json` and `apps/storefront/README.md`.
- `packages/` - shared packages (config, types, ui, utils, etc.).
- `docs/` - documentation (this file).
- `infra/` - infrastructure and deployment manifests (docker, environments).
- `scripts/` - repository helper scripts.

(There are additional folders such as `ui/`, `types/`, and `utils/` which contain shared code used across apps.)

## Prerequisites

- Node >= 20
- pnpm (>= 7, repo uses pnpm@9 recommended)
- Optional: Docker / a database service if you prefer not to use SQLite for Medusa

Install dependencies from the repo root:

```bash
pnpm install
```

## Backend (Medusa) - quick start

1. Create an `.env` file inside `apps/backend/` (Medusa reads `process.env.*` in `medusa-config.ts`). Example minimal `.env`:

```env
# apps/backend/.env (example)
DATABASE_URL=sqlite:./medusa-db.sqlite
STORE_CORS=http://localhost:3000
ADMIN_CORS=http://localhost:7000
AUTH_CORS=http://localhost:3000
JWT_SECRET=supersecret
COOKIE_SECRET=supersecret
```

2. From the repo root you can run the backend alone or via workspace commands.

- Run backend from within its folder:

```bash
cd apps/backend
pnpm dev
# or to run production start
pnpm start
```

- Or run using pnpm workspace filtering (from repo root):

```bash
pnpm --filter @likhang/backend dev
```

3. Seed the database (optional):

```bash
cd apps/backend
pnpm seed
```

By default Medusa's development server runs on port `9000` (check `apps/backend` output).

## Frontend (Next.js) - quick start

1. From the storefront folder:

```bash
cd apps/storefront
pnpm dev
```

2. Or run via pnpm filter from repo root:

```bash
pnpm --filter @likhang/storefront dev
```

Next.js typically serves the app on `http://localhost:3000`.

## Run both frontend and backend together

The root `package.json` includes a `dev` script that uses `turbo` to run `dev` across workspaces in parallel:

```bash
# from repo root
pnpm dev
```

This will run `dev` scripts for packages that define them (for example `apps/backend` and `apps/storefront`).

## Build & production

- Build all workspaces:

```bash
pnpm build
```

- Build a single app (example storefront):

```bash
pnpm --filter @likhang/storefront build
```

## Notes & troubleshooting

- Check `apps/backend/medusa-config.ts` for which environment variables are required by the backend.
- If using Postgres or another DB, set `DATABASE_URL` accordingly and ensure DB is reachable.
- If a port is already in use, change the appropriate env or pass flags as supported by the underlying tool.
- See `apps/backend/README.md` and `apps/storefront/README.md` for app-specific details.

---

If you'd like, I can:

- Add a sample `.env.example` to `apps/backend/`.
- Add `run` scripts to the root to start only storefront/backend with clearer names.
