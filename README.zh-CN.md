# time-mcp-worker（中文说明）

运行在 Cloudflare Workers 上的小型 MCP（Model Context Protocol）服务器，为大模型客户端提供可靠的时间工具。完整文档见 [README.md](README.md)。

## 工具

- `get_time`：获取当前时间（unix、ISO 8601、各时区本地时间）。可选参数 `timezone`（IANA 时区名，如 `Asia/Shanghai`）或 `timezones`（数组，最多 20 个）。
- `convert_time`：把 ISO 8601 字符串或 unix 时间戳转换到目标时区。`time` 必填；不带偏移量的 ISO 字符串按 `from_timezone`（默认 `UTC`）解释；目标为 `to_timezone` 或 `to_timezones`。
- `time_diff`：计算两个时间之差，`end` 省略时取当前时间。

无效时区、无法解析的时间等会以 `isError: true` 的工具结果返回，并附带清晰的错误信息。

## 端点

- `POST /mcp`：MCP Streamable HTTP（JSON-RPC 2.0，无状态，仅 JSON 响应）
- `GET /`、`POST /tools/get_time`：旧版 REST 接口，保持向后兼容
- `GET /health`：健康检查，返回 `OK`

## 接入 MCP 客户端

```sh
claude mcp add --transport http time https://time-mcp-worker.<your-subdomain>.workers.dev/mcp
```

或在支持 HTTP 的客户端配置中：

```json
{ "mcpServers": { "time": { "type": "http", "url": "https://time-mcp-worker.<your-subdomain>.workers.dev/mcp" } } }
```

## 开发与部署

```sh
npm install
npm test          # 使用 node:test，无额外依赖
npm run dev       # 本地 http://localhost:8787
npx wrangler login
npm run deploy
```

注意：该端点公开且无鉴权。如需限制访问，可使用 Cloudflare Access，或通过 `wrangler secret put` 配置 token 校验，切勿把密钥提交到仓库。

## 许可证

GPL-3.0，见 [LICENSE](LICENSE)。
