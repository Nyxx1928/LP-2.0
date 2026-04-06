# Setup

## Prerequisites

- Node.js LTS
- pnpm
- Docker Desktop

## Local bootstrap

1. Install dependencies from repository root.
2. Start local data services via Docker compose.
3. Scaffold and run backend and storefront apps.

## Commands

- pnpm install
- docker compose -f infra/docker/docker-compose.dev.yml up -d
- pnpm dev
