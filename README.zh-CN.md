# time-mcp-worker

[![CI](https://github.com/Kerry1020/time-mcp-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/Kerry1020/time-mcp-worker/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-6E56CF)](https://modelcontextprotocol.io)

[English](README.md) | 简体中文

一个运行在 Cloudflare Workers 上的小型 [MCP](https://modelcontextprotocol.io)（Model Context Protocol）服务，为大模型客户端提供可靠的时间工具：查询当前时间、时区换算、计算时间差。

## 功能特性

- 三个工具：`get_time`、`convert_time`、`time_diff`，支持任意 IANA 时区。
- 传输方式：`POST /mcp` 上的 MCP **Streamable HTTP**（只返回 JSON，无状态，不提供 SSE 流），支持 JSON-RPC 批量请求。
- 支持的协议版本：`2025-06-18`、`2025-03-26`、`2024-11-05`。
- 无运行时依赖、无存储、无密钥，也不发起任何外部请求。
- 旧版 REST 接口（`GET /`、`POST /tools/get_time`）继续可用。

## 快速开始

```sh
git clone https://github.com/Kerry1020/time-mcp-worker.git
cd time-mcp-worker
npm install
npx wrangler login   # once, opens the browser
npm run deploy
claude mcp add --transport http time https://time-mcp-worker.<your-subdomain>.workers.dev/mcp
```

部署完成后，可以问问 Agent：“上海早上 9:30 时，东京是几点？”

## 接口

| Method | Path              | 说明                                         |
| ------ | ----------------- | -------------------------------------------- |
| POST   | `/mcp`            | MCP JSON-RPC 2.0 端点                         |
| GET    | `/`               | 服务发现文档（旧版）                          |
| POST   | `/tools/get_time` | 旧版 REST 工具接口                            |
| GET    | `/health`         | 存活探针，返回 `OK`                           |

- 未知路径返回 `404`；方法不匹配返回 `405`，并带 `Allow` 头。`GET` 路由同样接受 `HEAD`。
- `OPTIONS` 预检请求返回宽松的 CORS 头（`Access-Control-Allow-Origin: *`）。
- 请求体上限为 64 KiB，超出返回 `413`。
- 如果 `Mcp-Protocol-Version` 头携带了不支持的版本，返回 `400`。
- 请求中只有通知或客户端响应时，返回 `202` 且 body 为空。

## 工具列表

| 工具           | 作用                                                         | 主要参数 |
| -------------- | ------------------------------------------------------------ | -------- |
| `get_time`     | 获取一个或多个 IANA 时区的当前时间（unix、ISO 8601、当地时间） | `timezone`、`timezones` |
| `convert_time` | 把 ISO 8601 字符串或 unix 时间戳换算到其他时区                 | `time`（必填）、`from_timezone`、`to_timezone` / `to_timezones` |
| `time_diff`    | 计算两个时间点之差（`end` 默认为当前时间）                     | `start`（必填）、`end`、`timezone` |

### `get_time`

| 参数        | 类型       | 说明                                         |
| ----------- | ---------- | -------------------------------------------- |
| `timezone`  | `string`   | 可选，IANA 时区名，如 `Asia/Shanghai`         |
| `timezones` | `string[]` | 可选，IANA 时区名列表（最多 20 个）           |

不传参数时，返回 UTC 以及 `Asia/Shanghai`、`America/New_York`、`Europe/London`、`Asia/Tokyo` 的时间。

### `convert_time`

| 参数            | 类型               | 说明                                                                 |
| --------------- | ------------------ | -------------------------------------------------------------------- |
| `time`          | `string \| number` | **必填。** ISO 8601（`2026-06-11T16:00:00Z`、`2026-06-12 09:30`）或 unix 秒 / 毫秒（`>= 1e11` 视为毫秒） |
| `from_timezone` | `string`           | 用于解释**不带**偏移量的 ISO 字符串的时区，默认 `UTC`                 |
| `to_timezone`   | `string`           | 目标时区                                                             |
| `to_timezones`  | `string[]`         | 多个目标时区，最多 20 个（`to_timezone` 和 `to_timezones` 至少给一个） |

### `time_diff`

| 参数       | 类型               | 说明                                              |
| ---------- | ------------------ | ------------------------------------------------- |
| `start`    | `string \| number` | **必填。** 开始时间                                |
| `end`      | `string \| number` | 结束时间，默认为当前时间                           |
| `timezone` | `string`           | 用于解释不带偏移量的 ISO 字符串的时区，默认 `UTC`   |

以 `{"start": "2026-06-12 09:30", "end": "2026-06-13T18:45:10Z", "timezone": "Asia/Shanghai"}` 为例，返回：

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

### 返回格式与错误处理

`get_time` 和 `convert_time` 会返回 `unix`、`unix_ms`、`iso`、`utc`，以及各时区的当地时间（`get_time` 放在 `timezones` 中，`convert_time` 放在 `source` 和 `targets` 中）。每条当地时间的结构如下：

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

结果会同时以 JSON 文本内容和 `structuredContent` 返回。

输入有误（未知时区、无法解析的时间、缺少参数）时，会以带 `isError: true` 的工具结果返回，并附上可读的错误信息，方便模型自行修正。协议层面的问题使用标准 JSON-RPC 错误码：`-32700` 解析错误、`-32600` 无效请求、`-32601` 方法不存在、`-32602` 参数无效 / 未知工具、`-32603` 内部错误。

### curl 示例

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

旧版 `POST /tools/get_time` 的返回：

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

## 配置

无需任何配置。Worker 不读取环境变量、secret 或绑定。`wrangler.toml` 里只有 Worker 名称、入口文件、`compatibility_date`、`workers_dev = true` 和 observability 设置。

## MCP 客户端配置

把 URL 换成你自己的部署地址（如 `https://time-mcp-worker.<your-subdomain>.workers.dev/mcp`）。

**Claude Code**

```sh
claude mcp add --transport http time https://time-mcp-worker.<your-subdomain>.workers.dev/mcp
```

**支持在 JSON 配置中添加 HTTP 服务的客户端**（Cursor、VS Code、Claude Code 的 `.mcp.json` 等）：

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

**Claude Desktop 等只支持 stdio 的客户端**可以通过 [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) 桥接：

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

## 安全说明

- 没有内置鉴权：所有接口都是公开的，CORS 允许任意来源。
- Worker 只做时间计算，不存储任何数据、不保存密钥、也不发起外部请求，主要风险是别人消耗你的 Workers 额度。
- 如需限制访问，可以放在 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) 之后，或在 `src/index.js` 中加一段 Bearer Token 校验（Token 用 `npx wrangler secret put AUTH_TOKEN` 保存，切勿提交到仓库）。

## 开发

需要 Node.js 20 或更新版本。

```sh
npm install      # installs wrangler (dev dependency only)
npm test         # node:test, no extra dependencies
npm run dev      # local server on http://localhost:8787
```

CI（GitHub Actions）会在 Node 20 和 22 上运行测试，并执行一次 `wrangler deploy --dry-run` 打包检查。

目录结构：

```
src/index.js   HTTP routing, CORS, legacy REST endpoints
src/mcp.js     MCP JSON-RPC handling
src/time.js    time zone helpers and tool implementations
test/          node:test suite (calls worker.fetch with Request objects)
```

## 部署

```sh
npx wrangler login   # once, opens the browser
npm run deploy
```

Worker 会以 `time-mcp-worker` 为名部署到你的 `workers.dev` 子域名下。如需自定义域名，可在 `wrangler.toml` 中添加 `routes`，或在 Cloudflare 控制台中配置。

## 相关项目

- [geo-mcp-worker](https://github.com/Kerry1020/geo-mcp-worker) — 基于 OpenStreetMap 服务的地理编码、POI 搜索和路线规划
- [memory-mcp-worker](https://github.com/Kerry1020/memory-mcp-worker) — 基于 KV 的 Agent 持久化记忆
- [webhook-inbox-mcp-worker](https://github.com/Kerry1020/webhook-inbox-mcp-worker) — 把 Webhook 收进 KV，再通过 MCP 工具读取
- [summarize-mcp-worker](https://github.com/Kerry1020/summarize-mcp-worker) — 网页正文提取与抽取式摘要
- [image-mcp-worker](https://github.com/Kerry1020/image-mcp-worker) — 对接任意 OpenAI 兼容图像接口的图片生成
- [calc-mcp-worker](https://github.com/Kerry1020/calc-mcp-worker) — 数学计算：表达式、微积分、矩阵、统计
- [search-mcp-worker](https://github.com/Kerry1020/search-mcp-worker) — 多引擎网页搜索，排序规则公开可审计

## 许可证

GNU 通用公共许可证 v3.0（GPL-3.0），详见 [LICENSE](LICENSE)。
