# time-mcp-worker

A simple MCP server on Cloudflare Workers that returns the current timestamp.

## Usage

### MCP Discovery
```
GET /
```

### Get Time
```
POST /tools/get_time
```

Response:
```json
{
  "result": {
    "unix": 1781193600,
    "unix_ms": 1781193600000,
    "iso": "2026-06-11T16:00:00.000Z",
    "utc": "Wed, 11 Jun 2026 16:00:00 GMT",
    "timezones": {
      "Asia/Shanghai": "2026/6/12 00:00:00",
      "America/New_York": "6/11/2026, 12:00:00 PM",
      "Europe/London": "11/06/2026, 17:00:00",
      "Asia/Tokyo": "2026/6/12 01:00:00"
    }
  }
}
```

### Health
```
GET /health
```


## License

This project is licensed under the GNU General Public License v3.0 — see the [LICENSE](LICENSE) file for details.
