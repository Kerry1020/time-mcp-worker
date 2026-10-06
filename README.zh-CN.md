# time-mcp-worker

[![CI](https://github.com/Kerry1020/time-mcp-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/Kerry1020/time-mcp-worker/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-6E56CF)](https://modelcontextprotocol.io)

[English](README.md) | 简体中文

运行在 Cloudflare Workers 上的轻量 [MCP](https://modelcontextprotocol.io)（Model Context Protocol）服务器，为大模型客户端提供准确可靠的时间工具。

## 功能特性

- 三个工具：查询任意 IANA 时区的当前时间、时区换算、计算时间差。
- 在 `POST /mcp` 提供 MCP **Streamable HTTP** 传输（JSON-RPC 2.0，仅返回 JSON，无状态，不使用 SSE 流）。
- 支持协议版本 `2025-06-18`、`2025-03-26`、`2024-11-05`（在 `initialize` 时协商）。
- 零运行时依赖，不存储任何数据，也不需要任何密钥。
- 旧版 REST 接口（`GET /`、`POST /tools/get_time`）继续可用。

## 快速开始

需要 Node.js 20 及以上版本。

```sh
git clone https://github.com/Kerry1020/time-mcp-worker.git
cd time-mcp-worker
npm install
npm run dev          # 本地服务：http://localhost:8787/mcp
npx wrangler login   # 首次部署前登录一次
npm run deploy       # https://time-mcp-worker.<your-subdomain>.workers.dev/mcp
```

## 工具列表

| 工具           | 作用                                                     | 主要参数                                             |
| -------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| `get_time`     | 获取一个或多个 IANA 时区的当前时间（unix、ISO 8601、本地时间） | `timezone`、`timezones`                              |
| `convert_time` | 把 ISO 8601 字符串或 unix 时间戳换算到其他时区             | `time`（必填）、`from_timezone`、`to_timezone(s)`    |
| `time_diff`    | 计算两个时间点之差（`end` 默认为当前时间）                 | `start`（必填）、`end`、`timezone`                   |

### `get_time`

| 参数        | 类型       | 说明                                  |
| ----------- | ---------- | ------------------------------------- |
| `timezone`  | `string`   | 可选，IANA 时区名，如 `Asia/Shanghai` |
| `timezones` | `string[]` | 可选，IANA 时区列表（最多 20 个）     |

不传参数时返回 UTC 以及 `Asia/Shanghai`、`America/New_York`、`Europe/London`、`Asia/Tokyo` 的时间。

### `convert_time`

| 参数            | 类型               | 说明                                                                 |
| --------------- | ------------------ | -------------------------------------------------------------------- |
| `time`          | `string \| number` | **必填**。ISO 8601（如 `2026-06-11T16:00:00Z`、`2026-06-12 09:30`）或 unix 秒 / 毫秒（`>= 1e11` 视为毫秒） |
| `from_timezone` | `string`           | 用于解释**不带**偏移量的 ISO 字符串，默认 `UTC`                      |
| `to_timezone`   | `string`           | 目标时区                                                             |
| `to_timezones`  | `string[]`         | 多个目标时区，最多 20 个（`to_timezone` 与 `to_timezones` 至少填一个） |

### `time_diff`

| 参数       | 类型               | 说明                                          |
| ---------- | ------------------ | --------------------------------------------- |
| `start`    | `string \| number` | **必填**。开始时间                            |
| `end`      | `string \| number` | 结束时间，默认为当前时间                      |
| `timezone` | `string`           | 用于解释不带偏移量的 ISO 字符串，默认 `UTC`   |

每条本地时间结果的格式如下：

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

时区不存在、时间无法解析、缺少参数等输入错误，会以 `isError: true` 的工具结果返回，并附带易读的错误信息，方便模型自行修正。协议层面的问题使用标准 JSON-RPC 错误码：`-32700` 解析错误、`-32600` 无效请求、`-32601` 方法不存在、`-32602` 参数无效 / 未知工具。

### 端点

| 方法 | 路径              | 说明                      |
| ---- | ----------------- | ------------------------- |
| POST | `/mcp`            | MCP JSON-RPC 2.0 端点     |
| GET  | `/`               | 服务说明文档（旧版）      |
| POST | `/tools/get_time` | 旧版 REST 工具            |
| GET  | `/health`         | 健康检查，返回 `OK`       |

未知路径返回 `404`；方法不匹配返回 `405` 并带 `Allow` 头；`OPTIONS` 预检请求返回宽松的 CORS 头（`Access-Control-Allow-Origin: *`）。

### curl 示例

```sh
URL=https://time-mcp-worker.<your-subdomain>.workers.dev   # 或配合 `npm run dev` 使用 http://localhost:8787

# initialize
curl -s "$URL/mcp" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

# 列出工具
curl -s "$URL/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# 上海和纽约的当前时间
curl -s "$URL/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_time","arguments":{"timezones":["Asia/Shanghai","America/New_York"]}}}'

# 上海 09:30 换算成伦敦时间
curl -s "$URL/mcp" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"convert_time","arguments":{"time":"2026-06-12 09:30","from_timezone":"Asia/Shanghai","to_timezone":"Europe/London"}}}'

# 旧版 REST 接口（行为不变；可选 JSON 请求体 {"timezones":[...]}）
curl -s -X POST "$URL/tools/get_time"
```

## 配置

无需任何配置：没有环境变量、密钥或绑定。Worker 名称和兼容日期写在 `wrangler.toml` 中。

## MCP 客户端配置

请把 URL 换成你自己的部署地址。

**Claude Code**

```sh
claude mcp add --transport http time https://<your-worker>.workers.dev/mcp
```

**支持 HTTP 服务器的 JSON 配置**（Cursor、VS Code、Claude Code 的 `.mcp.json` 等）：

```json
{
  "mcpServers": {
    "time": {
      "type": "http",
      "url": "https://<your-worker>.workers.dev/mcp"
    }
  }
}
```

**Claude Desktop / 仅支持 stdio 的客户端**，可借助 [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) 桥接：

```json
{
  "mcpServers": {
    "time": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-worker>.workers.dev/mcp"]
    }
  }
}
```

## 安全说明

该端点公开且没有鉴权，Worker 本身不做 token 校验。它只做时间计算、不存储数据，一般问题不大。若想限制公网部署的访问，可以放在 [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) 之后，或自行加上 Bearer token 校验（token 用 `wrangler secret put` 保存，切勿提交到仓库）。

## 开发

```sh
npm install      # 只安装 wrangler（开发依赖）
npm test         # 使用 node:test，无额外依赖
npm run dev      # 本地服务 http://localhost:8787
```

CI（`.github/workflows/ci.yml`）会在 Node 20 和 22 上跑测试，并执行一次 `wrangler deploy --dry-run` 打包检查。

```
src/index.js   HTTP 路由、CORS、旧版 REST 接口
src/mcp.js     MCP JSON-RPC 处理
src/time.js    时区工具函数与工具实现
test/          node:test 测试（用 Request 对象直接调用 worker.fetch）
```

## 部署

```sh
npx wrangler login   # 首次使用，会打开浏览器
npm run deploy
```

Worker 会以 `time-mcp-worker` 的名字部署到你的 `workers.dev` 子域名下。如需自定义域名，可在 `wrangler.toml` 中添加 `routes`，或在 Cloudflare 控制台配置。

## 相关项目

- [geo-mcp-worker](https://github.com/Kerry1020/geo-mcp-worker) — 基于 OpenStreetMap 服务的地理编码、POI 搜索与路线规划
- [memory-mcp-worker](https://github.com/Kerry1020/memory-mcp-worker) — 基于 KV 的智能体持久记忆
- [webhook-inbox-mcp-worker](https://github.com/Kerry1020/webhook-inbox-mcp-worker) — 把 webhook 收进 KV，再通过 MCP 工具读取
- [summarize-mcp-worker](https://github.com/Kerry1020/summarize-mcp-worker) — 网页正文提取与抽取式摘要
- [image-mcp-worker](https://github.com/Kerry1020/image-mcp-worker) — 通过任意 OpenAI 兼容的图像接口生成图片
- [calc-mcp-worker](https://github.com/Kerry1020/calc-mcp-worker) — 数学计算：表达式、微积分、矩阵、统计
- [search-mcp-worker](https://github.com/Kerry1020/search-mcp-worker) — 多引擎聚合搜索，排序逻辑开源可审计

## 许可证

GNU General Public License v3.0，详见 [LICENSE](LICENSE)。
