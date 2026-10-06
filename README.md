# time-mcp-worker

[![CI](https://github.com/Kerry1020/time-mcp-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/Kerry1020/time-mcp-worker/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-6E56CF)](https://modelcontextprotocol.io)

English | [简体中文](README.zh-CN.md)

A small [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server on Cloudflare Workers that gives LLM clients reliable time utilities: current time, time zone conversion and time differences.

## Features

- Three tools: `get_time`, `convert_time`, `time_diff`, working with any IANA time zone.
- Transport: MCP **Streamable HTTP** at `POST /mcp` (JSON responses, stateless, no SSE stream). JSON-RPC batches are supported.
- Protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05`.
- No runtime dependencies, no storage, no secrets, no outbound requests.
- The original REST API (`GET /`, `POST /tools/get_time`) still works.

## Quick start

```sh
git clone https://github.com/Kerry1020/time-mcp-worker.git
cd time-mcp-worker
npm install
npx wrangler login   # once, opens the browser
npm run deploy
claude mcp add --transport http time https://time-mcp-worker.<your-subdomain>.workers.dev/mcp
```

Then ask your agent something like "What time is it in Tokyo when it's 09:30 in Shanghai?".

## Endpoints

| Method | Path              | Description                                  |
| ------ | ----------------- | -------------------------------------------- |
| POST   | `/mcp`            | MCP JSON-RPC 2.0 endpoint                    |
| GET    | `/`               | Discovery document (legacy)                  |
| POST   | `/tools/get_time` | Legacy REST tool                             |
| GET    | `/health`         | Liveness probe, returns `OK`                 |

- Unknown paths return `404`. Wrong methods return `405` with an `Allow` header. `GET` routes also accept `HEAD`.
- `OPTIONS` preflight is answered with permissive CORS (`Access-Control-Allow-Origin: *`).
- Request bodies are limited to 64 KiB (`413` otherwise).
- A `Mcp-Protocol-Version` header with an unsupported version is rejected with `400`.
- Requests that contain only notifications or client responses get `202` with an empty body.

## Tools

| Tool           | What it does                                                                 | Key parameters |
| -------------- | ---------------------------------------------------------------------------- | -------------- |
| `get_time`     | Current time (unix, ISO 8601, local wall-clock) in one or more IANA zones     | `timezone`, `timezones` |
| `convert_time` | Convert an ISO 8601 string or unix timestamp between time zones              | `time` (required), `from_timezone`, `to_timezone` / `to_timezones` |
| `time_diff`    | Difference between two timestamps (end defaults to now)                      | `start` (required), `end`, `timezone` |

### `get_time`

| Argument    | Type       | Description                                         |
| ----------- | ---------- | --------------------------------------------------- |
| `timezone`  | `string`   | Optional IANA zone, e.g. `Asia/Shanghai`            |
| `timezones` | `string[]` | Optional list of IANA zones (max 20)                |

With no arguments it returns UTC plus `Asia/Shanghai`, `America/New_York`, `Europe/London`, `Asia/Tokyo`.

### `convert_time`

| Argument        | Type               | Description                                                                   |
| --------------- | ------------------ | ----------------------------------------------------------------------------- |
| `time`          | `string \| number` | **Required.** ISO 8601 (`2026-06-11T16:00:00Z`, `2026-06-12 09:30`) or unix seconds / milliseconds (values `>= 1e11` are treated as ms) |
| `from_timezone` | `string`           | Zone used for ISO strings **without** an offset. Default `UTC`                |
| `to_timezone`   | `string`           | Target zone                                                                   |
| `to_timezones`  | `string[]`         | Multiple target zones, max 20 (at least one of `to_timezone` / `to_timezones`) |

### `time_diff`

| Argument   | Type               | Description                                                 |
| ---------- | ------------------ | ----------------------------------------------------------- |
| `start`    | `string \| number` | **Required.** Start time                                    |
| `end`      | `string \| number` | End time, defaults to now                                   |
| `timezone` | `string`           | Zone used for ISO strings without an offset. Default `UTC`  |

Example result for `{"start": "2026-06-12 09:30", "end": "2026-06-13T18:45:10Z", "timezone": "Asia/Shanghai"}`:

```json
{
  "start": "2026-06-12T01:30:00.000Z",
  "end": "2026-06-13T18:45:10.000Z",
  "milliseconds": 148510000,
  "seconds": 148510,
  "minutes": 2475.1666666666665,
  "hours": 41.25277777777778,
  "days": 1.7188657407407408,
  "human": "1d 17h 15m 10s"
}
```

### Output and errors

`get_time` and `convert_time` return `unix`, `unix_ms`, `iso` and `utc`, plus local-time entries (`timezones` for `get_time`; `source` and `targets` for `convert_time`). Each local-time entry looks like:

```json
{
  "timezone": "Asia/Shanghai",
  "local": "2026-06-12T00:00:00.000+08:00",
  "date": "2026-06-12",
  "time": "00:00:00",
  "weekday": "Friday",
  "utc_offset": "+08:00",
  "utc_offset_minutes": 480
}
```

Results are returned both as JSON text content and as `structuredContent`.

Invalid input (unknown time zone, unparseable time, missing argument) is returned as a tool result with `isError: true` and a readable message, so the model can correct itself. Protocol-level problems use standard JSON-RPC errors: `-32700` parse error, `-32600` invalid request, `-32601` method not found, `-32602` invalid params / unknown tool, `-32603` internal error.

### curl examples

```sh
URL=https://time-mcp-worker.<your-subdomain>.workers.dev   # or http://localhost:8787 with `npm run dev`

# initialize
curl -s "$URL/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# list tools
curl -s "$URL/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# current time in Shanghai and New York
curl -s "$URL/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_time","arguments":{"timezones":["Asia/Shanghai","America/New_York"]}}}'

# 09:30 in Shanghai -> London
curl -s "$URL/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"convert_time","arguments":{"time":"2026-06-12 09:30","from_timezone":"Asia/Shanghai","to_timezone":"Europe/London"}}}'

# legacy REST API (unchanged; optional JSON body {"timezones":[...]})
curl -s -X POST "$URL/tools/get_time"
```

Legacy `POST /tools/get_time` response:

```json
{
  "result": {
    "unix": 1781193600,
    "unix_ms": 1781193600000,
    "iso": "2026-06-11T16:00:00.000Z",
    "utc": "Thu, 11 Jun 2026 16:00:00 GMT",
    "timezones": {
      "Asia/Shanghai": "2026/6/12 00:00:00",
      "America/New_York": "6/11/2026, 12:00:00 PM",
      "Europe/London": "11/06/2026, 17:00:00",
      "Asia/Tokyo": "2026/6/12 1:00:00"
    }
  }
}
```

## Configuration

None. The worker reads no environment variables, secrets or bindings. `wrangler.toml` only sets the worker name, entry point, `compatibility_date`, `workers_dev = true` and observability.

## MCP client config

Replace the URL with your own deployment (e.g. `https://time-mcp-worker.<your-subdomain>.workers.dev/mcp`).

**Claude Code**

```sh
claude mcp add --transport http time https://time-mcp-worker.<your-subdomain>.workers.dev/mcp
```

**Clients that accept a JSON config with HTTP servers** (Cursor, VS Code, Claude Code `.mcp.json`, ...):

```json
{
  "mcpServers": {
    "time": {
      "type": "http",
      "url": "https://time-mcp-worker.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

**Claude Desktop and other stdio-only clients** can use the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge:

```json
{
  "mcpServers": {
    "time": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://time-mcp-worker.<your-subdomain>.workers.dev/mcp"]
    }
  }
}
```

## Security notes

- There is no built-in authentication: every endpoint is public and CORS allows any origin.
- The worker only performs time calculations. It stores nothing, holds no secrets and makes no outbound requests, so the main exposure is someone else using your Workers quota.
- To restrict access, put it behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) or add a bearer-token check in `src/index.js` (store the token with `npx wrangler secret put AUTH_TOKEN`, never in the repo).

## Development

Requires Node.js 20+.

```sh
npm install      # installs wrangler (dev dependency only)
npm test         # node:test, no extra dependencies
npm run dev      # local server on http://localhost:8787
```

CI (GitHub Actions) runs the tests on Node 20 and 22 and does a `wrangler deploy --dry-run` bundle check.

Project layout:

```
src/index.js   HTTP routing, CORS, legacy REST endpoints
src/mcp.js     MCP JSON-RPC handling
src/time.js    time zone helpers and tool implementations
test/          node:test suite (calls worker.fetch with Request objects)
```

## Deploy

```sh
npx wrangler login   # once, opens the browser
npm run deploy
```

The worker is deployed as `time-mcp-worker` on your `workers.dev` subdomain. To use a custom domain, add a `routes` entry in `wrangler.toml` or configure it in the Cloudflare dashboard.

## Related projects

- [geo-mcp-worker](https://github.com/Kerry1020/geo-mcp-worker) — geocoding, POI search and routing via OpenStreetMap services
- [memory-mcp-worker](https://github.com/Kerry1020/memory-mcp-worker) — persistent KV-backed memory for agents
- [webhook-inbox-mcp-worker](https://github.com/Kerry1020/webhook-inbox-mcp-worker) — receive webhooks into KV and read them as MCP tools
- [summarize-mcp-worker](https://github.com/Kerry1020/summarize-mcp-worker) — web page extraction and extractive summarization
- [image-mcp-worker](https://github.com/Kerry1020/image-mcp-worker) — image generation via any OpenAI-compatible images API
- [calc-mcp-worker](https://github.com/Kerry1020/calc-mcp-worker) — math: expressions, calculus, matrices, statistics
- [search-mcp-worker](https://github.com/Kerry1020/search-mcp-worker) — multi-engine web search with open, auditable ranking

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
