# time-mcp-worker

[![CI](https://github.com/Kerry1020/time-mcp-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/Kerry1020/time-mcp-worker/actions/workflows/ci.yml)

A small [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server running on Cloudflare Workers that gives LLM clients reliable time utilities:

| Tool           | What it does                                                                 |
| -------------- | ---------------------------------------------------------------------------- |
| `get_time`     | Current time (unix, ISO 8601, local wall-clock) in one or more IANA zones     |
| `convert_time` | Convert an ISO 8601 string or unix timestamp between time zones              |
| `time_diff`    | Difference between two timestamps (end defaults to now)                      |

- Transport: MCP **Streamable HTTP** at `POST /mcp` (JSON responses, stateless, no SSE stream).
- Protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05`.
- No dependencies at runtime, no storage, no secrets.
- The original REST API (`GET /`, `POST /tools/get_time`) still works.

中文说明见 [README.zh-CN.md](README.zh-CN.md)。

## Endpoints

| Method | Path              | Description                                  |
| ------ | ----------------- | -------------------------------------------- |
| POST   | `/mcp`            | MCP JSON-RPC 2.0 endpoint                    |
| GET    | `/`               | Discovery document (legacy)                  |
| POST   | `/tools/get_time` | Legacy REST tool                             |
| GET    | `/health`         | Liveness probe, returns `OK`                 |

Unknown paths return `404`, wrong methods return `405` with an `Allow` header, and `OPTIONS` preflight is answered with permissive CORS (`Access-Control-Allow-Origin: *`).

## Connecting an MCP client

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

**Clients that only support stdio** (e.g. older Claude Desktop) can use the [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge:

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

## Tools

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
| `to_timezones`  | `string[]`         | Multiple target zones (at least one of `to_timezone` / `to_timezones`)        |

### `time_diff`

| Argument   | Type               | Description                                                 |
| ---------- | ------------------ | ----------------------------------------------------------- |
| `start`    | `string \| number` | **Required.** Start time                                    |
| `end`      | `string \| number` | End time, defaults to now                                   |
| `timezone` | `string`           | Zone used for ISO strings without an offset. Default `UTC`  |

Each local-time entry looks like:

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

Invalid input (unknown time zone, unparseable time, missing argument) is returned as a tool result with `isError: true` and a readable message, so the model can correct itself. Protocol-level problems use standard JSON-RPC errors: `-32700` parse error, `-32600` invalid request, `-32601` method not found, `-32602` invalid params / unknown tool.

## curl examples

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
      "Asia/Tokyo": "2026/6/12 01:00:00"
    }
  }
}
```

## Development

Requires Node.js 20+.

```sh
npm install      # installs wrangler (dev dependency only)
npm test         # node:test, no extra dependencies
npm run dev      # local server on http://localhost:8787
```

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

**Security note:** the endpoint is public and unauthenticated. It only returns time calculations and stores nothing, but if you want to restrict access, put it behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) or add a bearer token check (store the token with `wrangler secret put`, never in the repo).

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
