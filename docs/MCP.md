# Source MCP

Optional Streamable HTTP endpoint, using the [official Go MCP SDK](https://github.com/modelcontextprotocol/go-sdk).
Only querying, probing and adding subscriptions are exposed, not the administrator API.

## Enable

1. Generate a separate secret: `openssl rand -hex 32`.
2. Set `MCP_API_KEY=<generated secret>` in the server `.env`. Do not reuse
   `ADMIN_TOKEN`. Empty means disabled; keys require at least 32 characters.
3. Restart the API: `sudo systemctl restart quick-api` on the VPS.
4. Configure an MCP client supporting Streamable HTTP with a Bearer header:

```json
{
  "url": "https://urwhaturead.com/api/v1/mcp",
  "headers": { "Authorization": "Bearer <MCP_API_KEY>" }
}
```

Client configuration formats vary. This uses a static secret, not OAuth; clients
requiring OAuth-only remote MCP connections are not supported. Keep keys out of Git.
The existing Caddy `/api/*` proxy covers the endpoint. Use HTTPS outside localhost.

## Tools

- `list_sources`: optional `query`, `limit` (default 50, max 100), `offset`.
- `probe_feed`: `rss_url`; checks RSS/Atom and returns name, sample content,
  suggested tags and item count, without saving or fetching full article pages.
- `add_source`: `rss_url`, optional `name` and `tags`, required `confirmed`.
  Show the proposed source and obtain user approval before setting `confirmed: true`.
  Existing URLs are returned unchanged. New subscriptions use normal polling defaults,
  with scheduled AI disabled.

`rsshub://v2ex/topics/hot` resolves using the server's `RSSHUB_BASE_URL`.
Only the configured RSSHub may use private networking. Other probes use a public-only
HTTP client checking DNS addresses and redirects. Normal administrator/worker network
permissions remain unchanged.

The shared key grants additive access to shared subscriptions, not a per-user account.
Possession of the key is authorization; `confirmed` is an interaction safeguard, not
cryptographic proof of human approval. Feed samples are untrusted text, not instructions.
Rotate the key and restart to revoke access. Browser Origin requests are rejected.
Requests are limited to 60/minute, 4 concurrent requests and 32 KiB bodies. Disabled endpoints return 404;
invalid keys return 401. No deletion, editing, refresh or AI-generation tool exists.

## Verify

```bash
curl -sS https://urwhaturead.com/api/v1/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

Expect exactly `list_sources`, `probe_feed`, `add_source`. Without Authorization,
expect 401, regardless of browser admin sessions.

Tests: `go test ./...`; PostgreSQL integration tests additionally use
`TEST_DATABASE_DSN` and create/drop isolated schemas.
