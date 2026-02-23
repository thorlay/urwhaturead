# Local PostgreSQL for RSS News Aggregator

## Prerequisites

- Docker Desktop installed and running
- `docker compose` available in shell

## Quick Start

```bash
./scripts/db-up.sh
docker compose ps
```

Architecture quickstart for agents:

- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT_ONE_VPS.md`
- `deploy/Caddyfile.urwhaturead.com`
- `deploy/quick-api.service`
- `deploy/.env.prod.example`
- `deploy/.env.prod.urwhaturead.example`

`docker-compose.yml` uses `pgvector/pgvector:pg16` so vector similarity dedupe works out of the box.

When healthy, connect with:

```bash
./scripts/db-psql.sh
```

Open pgAdmin:

- URL: `http://localhost:5050`
- Email: `admin@example.com`
- Password: `quickadmin`
- A preset server `quick-postgres` is auto-loaded on startup.

Connection string:

```text
postgresql://quick:quickpass@localhost:5432/news_dev
```

## What gets initialized

On first startup, SQL files in `sql/init/` run automatically:

- `users`
- `sources`
- `user_source_subscriptions`
- `articles`
- `source_fetch_logs`
- indexes for dedup and feed queries

## Common Commands

```bash
./scripts/db-down.sh   # stop services
./scripts/db-reset.sh  # destroy and recreate DB data
./scripts/dev-up.sh    # start DB then run API (foreground)
./scripts/dev-up.sh --detach  # start DB + API in background
./scripts/dev-down.sh  # stop API + DB
./scripts/cluster-backfill.sh  # backfill event clusters for historical articles
```

## Environment Variables

Copy example env if needed:

```bash
cp .env.example .env
```

Main vars:

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `POSTGRES_PORT`
- `TZ`
- `DB_HOST`
- `DB_SSL_MODE`
- `DB_TIMEZONE`
- `SERVER_PORT`
- `ADMIN_AUTH_ENABLED`
- `ADMIN_TOKEN` (or `ADMIN_API_KEY`)
- `WORKER_TICK_SEC`
- `WORKER_REQUEST_RETRIES`
- `WORKER_RETRY_BASE_SEC`
- `WORKER_BACKOFF_MAX_FACTOR`
- `CLUSTER_VECTOR_ENABLED`
- `CLUSTER_VECTOR_MAX_DISTANCE`
- `CLUSTER_VECTOR_MIN_TOKENS`
- `CLUSTER_VECTOR_IVFFLAT_LISTS`
- `AI_SUMMARY_ENABLED`
- `AI_SUMMARY_BASE_URL`
- `AI_SUMMARY_API_KEY`
- `AI_SUMMARY_MODEL`
- `AI_SUMMARY_TIMEOUT_SEC`
- `AI_SUMMARY_MAX_INPUT_CHARS`
- `AI_SUMMARY_MAX_OUTPUT_TOKENS`
- `AI_SUMMARY_API_STYLE` (`auto` / `openai_chat` / `messages`)
- `AI_SUMMARY_API_KEY_HEADER`
- `AI_SUMMARY_API_KEY_PREFIX`
- `PGADMIN_PORT`
- `PGADMIN_DEFAULT_EMAIL`
- `PGADMIN_DEFAULT_PASSWORD`

Admin read-only mode (recommended for public deployment):

- Set `ADMIN_AUTH_ENABLED=true`
- Set `ADMIN_TOKEN=<a strong secret>`
- All write APIs (`POST` / `PATCH` / `DELETE`) require admin token
- Send token with either:
  - `Authorization: Bearer <ADMIN_TOKEN>`, or
  - `X-Admin-Token: <ADMIN_TOKEN>`
- Frontend management calls also support token from browser localStorage key: `quick_admin_token`

## If docker command is missing

Install Docker Desktop, then reopen terminal:

```bash
brew install --cask docker
open -a Docker
```

## Go Backend (Gin + GORM)

Run API server:

```bash
./scripts/api-up.sh
```

Run frontend:

```bash
cd frontend
npm install
npm run dev
```

Frontend dev server:

- `http://localhost:5173`
- `/api` is proxied to `http://localhost:8080`

Health check:

```bash
curl http://localhost:8080/healthz
```

Feed API:

- `GET /api/v1/feed`
- `POST /api/v1/feed/briefing`
- `GET /api/v1/articles/:id`
- `GET /api/v1/articles/:id/cluster-diagnosis`
- `GET /api/v1/articles/:id/summary`
- `POST /api/v1/articles/:id/summary`
- `POST /api/v1/articles/:id/track-thread`
- `GET /api/v1/admin/source-status`

Article detail enrichment:

- For forum topic links (`USCardForum`, `V2EX`), `GET /api/v1/articles/:id` will best-effort fetch thread RSS and return `thread` data (full post + comments) in the detail payload.
- For Hacker News RSS items with external article URLs, `GET /api/v1/articles/:id` will best-effort fetch and extract external page content into `external`.
- `POST /api/v1/articles/:id/track-thread` can turn a forum topic into a continuously polled source (for ongoing comment tracking).

AI summary endpoint:

- `GET /api/v1/articles/:id/summary`
- Reads cached summary only; returns `404` if cache does not exist.
- `POST /api/v1/articles/:id/summary`
- Calls AI API configured by `AI_SUMMARY_*` (supports both `openai_chat` and `messages` style).
- Returns structured Chinese summary for long-form content (article body + optional thread content/comments for enriched items).
- Summary is cached in DB table `article_summaries` by `article_id` to avoid repeated generation.
- Optional query param: `refresh=1` to force regeneration and overwrite cache.
- Response includes `cache_hit` (`true` when loaded from cache, `false` when newly generated).

Feed AI briefing endpoint:

- `POST /api/v1/feed/briefing`
- Uses the same configured AI API (`AI_SUMMARY_*`) to generate a stream-level briefing.
- Caches by content digest in DB table `feed_briefings`.
- Supports `refresh: true` to force regeneration.

Gemini OAuth messages style example:

```env
AI_SUMMARY_BASE_URL=http://localhost:3000/gemini-cli-oauth/v1/messages
AI_SUMMARY_API_KEY=YOUR_API_KEY
AI_SUMMARY_MODEL=gemini-2.0-flash-exp
AI_SUMMARY_API_STYLE=messages
AI_SUMMARY_API_KEY_HEADER=X-API-Key
AI_SUMMARY_API_KEY_PREFIX=
AI_SUMMARY_MAX_OUTPUT_TOKENS=1000
```

Feed query params:

- `limit` (1-100, default 20)
- `cursor` (pagination cursor from previous response)
- `tag` (source tag)
- `source_ids` (comma-separated source IDs, e.g. `1,2,3`)
- `q` (keyword in title/summary/content)
- `dedupe` (`1`/`true` enable event-level dedupe, default enabled; `0`/`false` returns raw stream)

Source status query params:

- `window_hours` (1-168, default 24)

Source APIs:

- `GET /api/v1/sources`
- `GET /api/v1/sources/:id`
- `POST /api/v1/sources`
- `POST /api/v1/sources/discover`
- `PATCH /api/v1/sources/:id`
- `DELETE /api/v1/sources/:id`
- `POST /api/v1/sources/:id/test`
- `POST /api/v1/sources/:id/refresh`

Background worker:

- Polls enabled sources on `WORKER_TICK_SEC` interval.
- Respects per-source `poll_interval_sec`.
- Retries transient request failures with exponential backoff (`WORKER_REQUEST_RETRIES`, `WORKER_RETRY_BASE_SEC`).
- Increases effective source poll interval after consecutive failures (capped by `WORKER_BACKOFF_MAX_FACTOR`).
- Uses `ETag` and `Last-Modified` for conditional fetch.
- Writes deduplicated items into `articles`.
- Writes fetch results into `source_fetch_logs`.

Event clustering and dedupe:

- New articles are normalized (`canonical_link`, `normalized_title`) and grouped into `event_clusters`.
- If `pgvector` is available, the backend also uses vector similarity fallback to merge same-event variants with different links/titles.
- Vector behavior can be tuned by env:
  - `CLUSTER_VECTOR_ENABLED` (`true`/`false`)
  - `CLUSTER_VECTOR_MAX_DISTANCE` (smaller = stricter, default `0.2`)
  - `CLUSTER_VECTOR_MIN_TOKENS` (minimum token count before building vector, default `3`)
  - `CLUSTER_VECTOR_IVFFLAT_LISTS` (index list count for new DB/index creation, default `100`)
- `GET /api/v1/feed` defaults to representative-per-event output with `duplicate_count`.
- Use `dedupe=0` to inspect raw item stream.
- Run `./scripts/cluster-backfill.sh` once to backfill clusters for existing historical rows.

Create source example:

```bash
curl -X POST http://localhost:8080/api/v1/sources \
  -H "Content-Type: application/json" \
  -d '{
    "name": "BBC World",
    "rss_url": "https://feeds.bbci.co.uk/news/world/rss.xml",
    "tags": ["world"]
  }'

# name 可省略，后端会尝试用 RSS 的 <title> 自动填充来源名称
curl -X POST http://localhost:8080/api/v1/sources \
  -H "Content-Type: application/json" \
  -d '{
    "rss_url": "https://hnrss.org/best",
    "tags": ["tech"]
  }'

curl "http://localhost:8080/api/v1/feed?limit=20&tag=world&q=economy"

# Use next_cursor from the previous response
curl "http://localhost:8080/api/v1/feed?limit=20&cursor=<NEXT_CURSOR>"

curl "http://localhost:8080/api/v1/articles/138"

curl -X POST http://localhost:8080/api/v1/sources/1/refresh

# Discover RSS/Atom feeds from a site URL
curl -X POST http://localhost:8080/api/v1/sources/discover \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.uscardforum.com"}'
```
