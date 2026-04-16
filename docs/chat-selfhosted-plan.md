# Chat — Self-hosted (WebSocket + Redis) Implementation Plan

**Date:** 2026-04-07

Purpose: implement a self-hosted, production-safe realtime customer<>staff chat using a WebSocket server and Redis for horizontal delivery and presence.

1. High-level architecture

- apps/chat-service: Node.js + TypeScript service (WebSocket server + REST API) that persists conversations/messages to Postgres and uses Redis pub/sub for cross-instance broadcasts.
- apps/storefront: lightweight chat widget that authenticates customers and connects to chat-service via WebSocket.
- apps/backend (admin): minimal admin inbox UI for staff to view/respond to conversations (either integrated into Medusa admin or a small admin app).
- Postgres: persistent store for conversations/messages.
- Redis: pub/sub for message distribution and presence; optional Redis Streams for durability.

2. Data model (example SQL)

```sql
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NULL,
  status text NOT NULL DEFAULT 'open', -- open|closed|archived
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  client_message_id text NULL, -- client-supplied for idempotency
  sender text NOT NULL, -- 'customer' | 'staff' | 'system'
  sender_id uuid NULL,
  body text,
  metadata jsonb DEFAULT '{}'::jsonb,
  delivered boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX ux_messages_conversation_client ON messages(conversation_id, client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX ix_messages_conversation_created ON messages(conversation_id, created_at DESC);
```

3. WebSocket protocol (events)

- Client -> Server

  - `auth` { token }
  - `join` { conversation_id }
  - `send_message` { client_message_id, conversation_id?, body, metadata }
  - `typing` { conversation_id, is_typing }

- Server -> Client
  - `ack` { client_message_id, server_message_id, created_at }
  - `message` { server_message_id, conversation_id, sender, body, metadata, created_at }
  - `presence` { conversation_id, online_staff_count }

Workflow: client sends `send_message`. Server verifies/authenticates, persists message within a DB transaction (using unique constraint on client_message_id to ensure idempotency), publishes to Redis channel `conversation:{id}`, then responds with `ack` to the origin and broadcasts `message` to all connected clients for that conversation.

4. REST API endpoints (examples)

- `POST /api/chat/token` — exchange session cookie for a short-lived chat JWT.
- `GET /api/chat/conversations` — list customer's conversations (paginated).
- `GET /api/chat/conversations/:id/messages?cursor=` — message pagination.
- `POST /api/chat/conversations` — create conversation (optional; server can create on first message).
- Admin: `GET /api/admin/chat/conversations`, `POST /api/admin/chat/conversations/:id/assign`, `POST /api/admin/chat/conversations/:id/close`.

5. Redis usage

- Use pub/sub channels named `conversation:{id}`. Each chat-service instance subscribes to channels for active conversations it is serving.
- On message write, publish to the channel. Instances receive published messages and forward to their connected WebSocket clients.
- Optionally use Redis Streams for persistent event backlog and consumer groups for reliability across restarts.

6. Idempotency & delivery guarantees

- Client-provided `client_message_id` dedupes duplicate sends (network retries). Use unique index and return existing row if conflict.
- Guarantee at-most-once persistence; delivery is best-effort with retry and ack semantics. Mark `delivered=true` when a staff client acknowledges.

7. Authentication & authorization

- Customer connections: validate session via Medusa (call backend `/store/customers/me`) or issue short-lived signed chat JWT from `POST /api/chat/token` after validating session cookie.
- Staff/admin: require admin JWT or API key; admin UI calls must be authorized via Medusa admin auth.

8. Scaling considerations

- Run multiple chat-service replicas behind a load balancer. Because Redis pub/sub routes messages, sticky sessions are not required, but a stateless token-based auth is recommended.
- Monitor number of open sockets, memory usage, and Redis pub/sub throughput. Consider Redis Streams if message durability and replay are required.

9. Persistence/cleanup

- Implement a retention job (cron) that deletes messages older than `CHAT_MESSAGE_RETENTION_DAYS`.
- Ensure attachments are stored in S3-compatible storage and pruned per retention policy.

10. Observability

- Instrument chat-service with OpenTelemetry traces and Prometheus metrics: active_connections, messages_sent, messages_received, publish_latency, failed_publishes.

11. Security & privacy

- Input validation: use a strict validation layer (Zod/Joi/Ajv) on all chat REST endpoints and WebSocket payloads. Enforce maximum sizes, allowed characters, and types to reduce injection surface.
- SQL / query injection: persist data using parameterized queries or an ORM (Prisma, TypeORM, Knex). Never concatenate user input into SQL strings. Use DB users with least privileges and validate identifiers server-side.
- XSS mitigation: prefer storing plain text. If rendering rich text/HTML, sanitize server-side (sanitize-html, DOMPurify) and whitelist safe tags/attributes. Avoid rendering user HTML directly (no dangerouslySetInnerHTML) and add a strong Content-Security-Policy.
- CSRF & session handling: protect state-changing REST endpoints using SameSite cookie attributes or CSRF tokens. For WebSocket auth, require a signed short-lived JWT or validate the session cookie plus `Origin` header.
- File upload protections: validate MIME types and magic bytes, enforce size limits, scan uploads for malware, store files in a private bucket, and serve via signed URLs.
- Redis / NoSQL considerations: validate and sanitize keys/values; do not execute user-supplied commands. Use typed APIs and avoid creating commands from untrusted strings.
- Command injection prevention: never pass untrusted input to shell commands or use strict whitelisting and safe APIs if absolutely necessary.
- Rate limiting & abuse controls: apply per-user and per-IP throttling, device fingerprinting for abuse detection, and integrate with a WAF or Cloudflare for edge protections.
- Secrets & environment: use a hosted secret manager for production (do not commit secrets). Rotate keys and use short-lived tokens for chat authentication.
- Logging & monitoring: capture anomalous input patterns and injection errors, feed WAF/IDS findings into alerts, and include security tests (SQLi/XSS) in CI.

12. Tests

- Unit tests: message persistence, idempotency logic.
- Integration tests: multi-instance message delivery using two chat-service instances and Redis (simulate client connections).
- E2E smoke: simulate customer->staff roundtrip using a headless browser or node socket clients.

13. Deployment / Docker

- Add `apps/chat-service/Dockerfile` and include the service in `infra/docker/docker-compose.dev.yml` for local testing.

Example docker-compose snippet:

```yaml
chat-service:
  build: ./apps/chat-service
  environment:
    - CHAT_DATABASE_URL=${DATABASE_URL}
    - CHAT_REDIS_URL=${REDIS_URL}
    - CHAT_PORT=4000
  ports:
    - "4000:4000"
  depends_on:
    - postgres
    - redis
```

14. Environment variables

- `CHAT_PORT` (default 4000)
- `CHAT_DATABASE_URL`
- `CHAT_REDIS_URL`
- `CHAT_JWT_SECRET` (sign short-lived chat tokens)
- `CHAT_MESSAGE_RETENTION_DAYS`

15. Migration

- Add SQL migration to `apps/backend/migrations/` or use repo's preferred migration tooling to create tables above.

16. Estimated effort

- Docs + data model + simple admin API: 1 day
- Chat-service prototype + storefront widget (send/receive/ack): 2–4 days
- Admin UI + tests + hardening: 1–2 days

17. Next steps (recommended)

1) Decide library: `socket.io` (reconnects/presence) vs `ws` (lighter). Recommendation: `socket.io` for faster development.
2) Scaffold `apps/chat-service` with minimal server, REST token endpoint, and DB schema migration.
3) Add a minimal chat widget to `apps/storefront/app/chat` that authenticates and sends a test message.

If you want, I can scaffold `apps/chat-service` (package.json, Dockerfile, basic socket server, and a migration SQL) now — do you want me to proceed with scaffolding or prefer a managed provider instead?
