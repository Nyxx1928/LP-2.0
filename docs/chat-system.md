# Chat System — Design & Implementation Plan

**Date:** 2026-04-07

This document describes a recommended approach to add a real-time chat (customer <> staff) system to the monorepo. It covers MVP scope, architecture options, data model, security & privacy considerations, and step-by-step implementation tasks.

## Purpose & Scope

- Provide a lightweight, production-safe customer support chat embedded in the storefront.
- Support persistent conversations, offline messages (email fallback), staff/admin UI, basic moderation, and scalability for low-to-medium traffic.
- MVP goal: one-on-one chat between a customer and a staff operator (not a multi-room group system or fully-featured chat app).

## MVP Features

- Real-time messaging between customer and support staff (WebSocket or managed real-time provider).
- Conversation persistence in Postgres for audit and recovery.
- Basic admin UI for staff to view/respond to conversations (integrate into Medusa admin or simple UI under `apps/backend`).
- Message delivery guarantees: at-most-once with simple ack + retry; idempotency for message writes.
- Offline handling: store messages and send email notification to staff when customer sends a message and no staff is online.
- Attachment support (images) via existing file storage (UploadThing/S3-compatible) — optional for MVP.

## Architecture Options

1. Managed provider (Pusher, Ably, Supabase Realtime, Firebase Realtime):

   - Pros: fast to implement, hosted scaling, built-in reliability and presence.
   - Cons: external dependency, cost, potential feature limits.

2. Self-hosted realtime service (WebSocket server + Redis pub/sub):
   - Pros: full control, no 3rd-party costs, integrates with existing infra (Postgres/Redis).
   - Cons: more implementation and operational effort (scaling, connection management).

Recommendation for MVP: Use a lightweight self-hosted WebSocket service that reuses existing Postgres and Redis (already present in repo). This keeps stack simple and aligns with the monorepo goals while keeping costs minimal. If you prefer the fastest route, use a managed provider (Supabase or Pusher) and keep server-side event validation.

## Recommended MVP Implementation (self-hosted)

- Add a new `chat` service under `apps/chat-service/` (Node + TypeScript). Responsibilities:

  - WebSocket server (Socket.IO or ws) to accept connections from storefront and admin clients.
  - REST API endpoints to list conversations, fetch messages, mark as read, and moderate messages.
  - Persist conversations and messages to Postgres using the same DB as Medusa (new tables/migrations).
  - Redis pub/sub for horizontal scaling across chat service instances (deliver messages to connected sockets).

- Frontend: store chat UI components in `apps/storefront` (`/app/chat` and a small client using `useWebSocket` or Socket.IO client).

- Admin: Add a minimal admin UI under `apps/backend/admin-chat` or integrate into Medusa admin UI using `@medusajs/admin-sdk`.

## Data Model (example)

-- Conversations table (simplified)

```sql
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid, -- nullable for guest conversations
  status text NOT NULL DEFAULT 'open', -- open|closed|archived
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  sender text NOT NULL, -- 'customer' | 'staff' | 'system'
  sender_id uuid NULL, -- user id if available
  body text,
  metadata jsonb DEFAULT '{}'::jsonb,
  delivered boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX ON messages(conversation_id, created_at DESC);
```

## Authentication & Authorization

- Reuse Medusa customer sessions: frontend will connect to chat-service using authenticated cookies (same-origin) — chat-service should validate the session token with Medusa or accept a signed JWT issued by Medusa.
- Admin staff auth: require admin API key or leverage Medusa admin authentication to gate staff UI.

## Message Delivery & Idempotency

- Assign client-side message IDs (client_message_id) for dedup and idempotency. When server persists a message, respond with canonical message ID.
- Use Redis streams or simple retry logic with exponential backoff for delivery attempts to offline staff clients; when delivery fails, the message remains persisted.

## Moderation, Sanitization & Safety

- Input validation: validate all inbound messages and API payloads using a schema validator (Zod, Joi, or Ajv). Enforce types, max lengths, allowed characters, and reject oversized or malformed payloads.
- SQL / query injection prevention: never build SQL via string concatenation. Use parameterized queries or an ORM/query builder (Prisma, TypeORM, Knex) and least-privilege DB accounts. Sanitize and validate identifiers (table/column names) server-side.
- XSS prevention: store plain text where possible. If HTML or rich text is allowed, sanitize on the server (sanitize-html or DOMPurify via JSDOM) and whitelist tags/attributes. When rendering, prefer text nodes over innerHTML and apply output encoding for the rendering context. Add a strict Content-Security-Policy (CSP) to limit script execution and risky sources.
- CSRF and session security: protect REST endpoints with SameSite cookies or CSRF tokens for state-changing requests. For WebSocket handshakes, validate `Origin`/`Sec-WebSocket-Protocol` and use short-lived signed chat JWTs instead of relying solely on cookies.
- File upload safety: validate file MIME types and magic bytes, enforce file size limits, virus-scan attachments, store uploads in S3-like storage with private ACLs, and serve via signed URLs. Never render or execute uploaded content in the browser without sanitization.
- Redis / NoSQL safety: avoid interpolating user input into Redis commands or raw query objects. Validate keys and values and use typed APIs to prevent injection-like attacks against non-SQL datastores.
- Command / OS injection: avoid executing shell commands with user input. If unavoidable, strictly validate and whitelist allowed values and use safe child-process APIs without a shell.
- Rate limiting & abuse prevention: apply per-user and per-IP rate limits, incremental backoff, captchas for suspicious patterns, and automated blocks for abusive behavior. Integrate WAF/Cloudflare rules to block common attack patterns.
- Secrets & config: keep secrets out of source control; use a hosted secret store for production and environment-specific `.env` files for local development only.
- Logging, detection & response: log suspicious inputs, SQL errors, and WAF events; add alerts for injection patterns and repeated sanitization failures. Include test cases (SQLi/XSS) in integration/security tests.

## Observability & Monitoring

- Trace chat events (message.sent, message.delivered, message.failed) via existing instrumentation (enable `apps/backend/instrumentation.ts` or register chat service with OTLP).
- Add metrics: active connections, messages/sec, message latency, undelivered messages.

## Privacy & Retention

- Add retention policy (configurable via env var) to delete messages older than X days.
- Escalate PII rules: do not store payment card data in chat, redact sensitive fields if detected, and require consent for storing messages if required by PIPA/BIR.

## Environment variables (examples)

- `CHAT_SERVICE_PORT`=4000
- `CHAT_REDIS_URL`=redis://localhost:6379
- `CHAT_DATABASE_URL`=postgres://...
- `CHAT_MESSAGE_RETENTION_DAYS`=365

## Implementation Steps (high level)

1. Add docs and schema (this file).
2. Create DB migrations for `conversations` and `messages` (use `pnpm --filter @likhang/backend` migration tooling or run SQL against DB).
3. Scaffold `apps/chat-service` (Node + TypeScript) with WebSocket server and REST API.
4. Implement message persistence and Redis pub/sub delivery.
5. Add storefront UI components under `apps/storefront/app/chat` and wire authentication.
6. Add admin UI (simple inbox) and authorize via admin keys.
7. Add tests: unit tests for persistence, integration tests for message delivery, and an E2E smoke test for user->staff message roundtrip.
8. Add observability instrumentation and configure retention job/cron to prune old messages.

## Files to add / modify (suggested)

- Add: `apps/chat-service/` (service code, package.json, Dockerfile)
- Add migration: `apps/backend/migrations/2026xxxx_create_chat_tables.sql`
- Modify: `apps/storefront` UI to include chat widget and connection client
- Add: `apps/backend/admin-chat` (staff UI) or plugin into existing admin UI
- Add env example entries to `.env.example`

## Quick local run (dev)

```bash
# from repo root
pnpm --filter @likhang/backend dev    # run medusa (auth/session)
pnpm --filter @likhang/chat-service dev # run chat service (will connect to Redis/Postgres)
pnpm --filter @likhang/storefront dev # run storefront and test chat widget
```

## Estimated effort (rough)

- Documentation + schema: 1 day
- Chat-service prototype + storefront UI (MVP): 2–4 days
- Admin UI + tests + hardening: 2–3 days

## Next steps

- Choose architecture (managed vs self-hosted). If you want speed, use Supabase Realtime or Pusher for the first iteration.
- If self-hosted, I can scaffold `apps/chat-service` with WebSocket + Redis and a simple storefront widget. Which approach do you prefer?
