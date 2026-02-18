# Local PostgreSQL for RSS News Aggregator

## Prerequisites

- Docker Desktop installed and running
- `docker compose` available in shell

## Quick Start

```bash
./scripts/db-up.sh
docker compose ps
```

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
- `WORKER_TICK_SEC`
- `WORKER_REQUEST_RETRIES`
- `WORKER_RETRY_BASE_SEC`
- `WORKER_BACKOFF_MAX_FACTOR`
- `AI_SUMMARY_ENABLED`
- `AI_SUMMARY_BASE_URL`
- `AI_SUMMARY_API_KEY`
- `AI_SUMMARY_MODEL`
- `AI_SUMMARY_TIMEOUT_SEC`
- `AI_SUMMARY_MAX_INPUT_CHARS`
- `PGADMIN_PORT`
- `PGADMIN_DEFAULT_EMAIL`
- `PGADMIN_DEFAULT_PASSWORD`

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
- `GET /api/v1/articles/:id`
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
- Calls OpenAI-compatible chat completion API configured by `AI_SUMMARY_*`.
- Returns structured Chinese summary for long-form content (article body + optional thread content/comments for enriched items).
- Summary is cached in DB table `article_summaries` by `article_id` to avoid repeated generation.
- Optional query param: `refresh=1` to force regeneration and overwrite cache.
- Response includes `cache_hit` (`true` when loaded from cache, `false` when newly generated).

Feed query params:

- `limit` (1-100, default 20)
- `cursor` (pagination cursor from previous response)
- `category` (source category)
- `source_ids` (comma-separated source IDs, e.g. `1,2,3`)
- `q` (keyword in title/summary/content)

Source status query params:

- `window_hours` (1-168, default 24)

Source APIs:

- `GET /api/v1/sources`
- `GET /api/v1/sources/:id`
- `POST /api/v1/sources`
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

Create source example:

```bash
curl -X POST http://localhost:8080/api/v1/sources \
  -H "Content-Type: application/json" \
  -d '{
    "name": "BBC World",
    "rss_url": "https://feeds.bbci.co.uk/news/world/rss.xml",
    "category": "world"
  }'

# name 可省略，后端会尝试用 RSS 的 <title> 自动填充来源名称
curl -X POST http://localhost:8080/api/v1/sources \
  -H "Content-Type: application/json" \
  -d '{
    "rss_url": "https://hnrss.org/best",
    "category": "tech"
  }'

curl "http://localhost:8080/api/v1/feed?limit=20&category=world&q=economy"

# Use next_cursor from the previous response
curl "http://localhost:8080/api/v1/feed?limit=20&cursor=<NEXT_CURSOR>"

curl "http://localhost:8080/api/v1/articles/138"

curl -X POST http://localhost:8080/api/v1/sources/1/refresh
```
