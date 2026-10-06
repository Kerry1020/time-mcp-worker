import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const BASE = 'https://time.example.test';

function call(path, init = {}) {
  return worker.fetch(new Request(BASE + path, init), {}, {});
}

function rpc(body, headers = {}) {
  return call('/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function rpcJson(body, headers) {
  const res = await rpc(body, headers);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  return res.json();
}

async function callTool(name, args) {
  const body = await rpcJson({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  assert.equal(body.id, 1);
  assert.ok(body.result, JSON.stringify(body));
  return body.result;
}

describe('legacy REST API', () => {
  test('GET / returns discovery document', async () => {
    const res = await call('/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.json();
    assert.equal(body.name, 'time-mcp');
    assert.equal(body.mcp_endpoint, '/mcp');
    const names = body.tools.map((t) => t.name);
    assert.ok(names.includes('get_time'));
    for (const t of body.tools) assert.equal(t.parameters.type, 'object');
  });

  test('POST /tools/get_time keeps the original response shape', async () => {
    const before = Date.now();
    const res = await call('/tools/get_time', { method: 'POST' });
    assert.equal(res.status, 200);
    const { result } = await res.json();
    assert.equal(typeof result.unix, 'number');
    assert.equal(result.unix, Math.floor(result.unix_ms / 1000));
    assert.ok(result.unix_ms >= before && result.unix_ms <= Date.now());
    assert.equal(result.iso, new Date(result.unix_ms).toISOString());
    assert.equal(result.utc, new Date(result.unix_ms).toUTCString());
    assert.deepEqual(Object.keys(result.timezones), ['Asia/Shanghai', 'America/New_York', 'Europe/London', 'Asia/Tokyo']);
  });

  test('POST /tools/get_time accepts optional timezone args', async () => {
    const res = await call('/tools/get_time', { method: 'POST', body: JSON.stringify({ timezones: ['UTC', 'Asia/Kolkata'] }) });
    assert.equal(res.status, 200);
    const { result } = await res.json();
    assert.deepEqual(Object.keys(result.timezones), ['UTC', 'Asia/Kolkata']);
  });

  test('POST /tools/get_time rejects invalid timezone and invalid JSON', async () => {
    let res = await call('/tools/get_time', { method: 'POST', body: JSON.stringify({ timezone: 'Mars/Olympus' }) });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_argument');
    res = await call('/tools/get_time', { method: 'POST', body: '{nope' });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'invalid_json');
  });

  test('GET /health', async () => {
    const res = await call('/health');
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'OK');
  });
});

describe('HTTP handling', () => {
  test('unknown path returns 404 JSON', async () => {
    const res = await call('/nope');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'not_found');
  });

  test('wrong method returns 405 with Allow header', async () => {
    let res = await call('/tools/get_time');
    assert.equal(res.status, 405);
    assert.match(res.headers.get('allow'), /POST/);
    res = await call('/mcp');
    assert.equal(res.status, 405);
    res = await call('/', { method: 'DELETE' });
    assert.equal(res.status, 405);
  });

  test('OPTIONS preflight returns CORS headers', async () => {
    const res = await call('/mcp', { method: 'OPTIONS', headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' } });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('access-control-allow-methods'), /POST/);
    assert.match(res.headers.get('access-control-allow-headers'), /Mcp-Protocol-Version/);
  });

  test('trailing slash is tolerated', async () => {
    const res = await call('/health/');
    assert.equal(res.status, 200);
  });

  test('oversized body is rejected', async () => {
    const res = await rpc('x'.repeat(70 * 1024));
    assert.equal(res.status, 413);
  });
});

describe('MCP JSON-RPC', () => {
  test('initialize negotiates protocol version', async () => {
    const body = await rpcJson({
      jsonrpc: '2.0', id: 'init-1', method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
    });
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.id, 'init-1');
    assert.equal(body.result.protocolVersion, '2025-03-26');
    assert.ok(body.result.capabilities.tools);
    assert.equal(body.result.serverInfo.name, 'time-mcp-worker');

    const unknown = await rpcJson({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    assert.equal(unknown.result.protocolVersion, '2025-06-18');
  });

  test('notifications/initialized returns 202 with no body', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(res.status, 202);
    assert.equal(await res.text(), '');
  });

  test('ping', async () => {
    const body = await rpcJson({ jsonrpc: '2.0', id: 3, method: 'ping' });
    assert.deepEqual(body.result, {});
  });

  test('tools/list', async () => {
    const body = await rpcJson({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
    const names = body.result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['convert_time', 'get_time', 'time_diff']);
    for (const t of body.result.tools) {
      assert.equal(typeof t.description, 'string');
      assert.equal(t.inputSchema.type, 'object');
      assert.equal(t.handler, undefined);
    }
  });

  test('parse error -32700', async () => {
    const res = await rpc('{"jsonrpc": "2.0", ');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error.code, -32700);
    assert.equal(body.id, null);
  });

  test('invalid request -32600', async () => {
    for (const bad of [{ id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1 }, 42, { jsonrpc: '2.0', id: { x: 1 }, method: 'ping' }]) {
      const body = await rpcJson(bad);
      assert.equal(body.error.code, -32600, JSON.stringify(bad));
    }
    const empty = await rpcJson([]);
    assert.equal(empty.error.code, -32600);
  });

  test('method not found -32601', async () => {
    const body = await rpcJson({ jsonrpc: '2.0', id: 5, method: 'resources/list' });
    assert.equal(body.error.code, -32601);
    assert.equal(body.id, 5);
  });

  test('invalid params -32602', async () => {
    let body = await rpcJson({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } });
    assert.equal(body.error.code, -32602);
    body = await rpcJson({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {} });
    assert.equal(body.error.code, -32602);
    body = await rpcJson({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'get_time', arguments: [1] } });
    assert.equal(body.error.code, -32602);
    body = await rpcJson({ jsonrpc: '2.0', id: 9, method: 'tools/list', params: [1] });
    assert.equal(body.error.code, -32602);
  });

  test('unsupported MCP-Protocol-Version header returns 400', async () => {
    const res = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '1999-01-01' });
    assert.equal(res.status, 400);
    const ok = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'mcp-protocol-version': '2025-06-18' });
    assert.equal(ok.status, 200);
  });

  test('batch requests', async () => {
    const body = await rpcJson([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'nope' },
    ]);
    assert.equal(body.length, 2);
    assert.deepEqual(body[0], { jsonrpc: '2.0', id: 1, result: {} });
    assert.equal(body[1].error.code, -32601);

    const res = await rpc([{ jsonrpc: '2.0', method: 'notifications/initialized' }]);
    assert.equal(res.status, 202);
  });
});

describe('tools', () => {
  test('get_time default', async () => {
    const r = await callTool('get_time', {});
    assert.equal(r.isError, false);
    assert.equal(r.content[0].type, 'text');
    assert.deepEqual(JSON.parse(r.content[0].text), r.structuredContent);
    const zones = r.structuredContent.timezones.map((z) => z.timezone);
    assert.ok(zones.includes('UTC'));
  });

  test('get_time with timezone and timezones', async () => {
    const r = await callTool('get_time', { timezone: 'Asia/Shanghai', timezones: ['Asia/Kathmandu', 'Asia/Shanghai'] });
    const tz = r.structuredContent.timezones;
    assert.deepEqual(tz.map((z) => z.timezone), ['Asia/Shanghai', 'Asia/Kathmandu']);
    assert.equal(tz[0].utc_offset, '+08:00');
    assert.equal(tz[1].utc_offset, '+05:45');
    assert.match(tz[0].local, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/);
    // local string must round-trip to the same instant
    assert.equal(new Date(tz[0].local).getTime(), r.structuredContent.unix_ms);
  });

  test('get_time with invalid timezone returns isError', async () => {
    const r = await callTool('get_time', { timezone: 'Not/AZone' });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Invalid timezone/);
    const r2 = await callTool('get_time', { timezones: 'UTC' });
    assert.equal(r2.isError, true);
  });

  test('convert_time from ISO with Z', async () => {
    const r = await callTool('convert_time', { time: '2026-06-11T16:00:00Z', to_timezones: ['Asia/Shanghai', 'America/New_York'] });
    assert.equal(r.isError, false);
    const s = r.structuredContent;
    assert.equal(s.unix, 1781193600);
    assert.equal(s.targets[0].local, '2026-06-12T00:00:00.000+08:00');
    assert.equal(s.targets[1].local, '2026-06-11T12:00:00.000-04:00');
  });

  test('convert_time from unix seconds and milliseconds', async () => {
    const a = await callTool('convert_time', { time: 1781193600, to_timezone: 'Asia/Tokyo' });
    const b = await callTool('convert_time', { time: '1781193600000', to_timezone: 'Asia/Tokyo' });
    assert.equal(a.structuredContent.iso, '2026-06-11T16:00:00.000Z');
    assert.equal(b.structuredContent.iso, '2026-06-11T16:00:00.000Z');
    assert.equal(a.structuredContent.targets[0].local, '2026-06-12T01:00:00.000+09:00');
  });

  test('convert_time naive ISO interpreted in from_timezone (incl. DST)', async () => {
    const r = await callTool('convert_time', { time: '2026-06-12 09:30', from_timezone: 'Asia/Shanghai', to_timezone: 'Europe/London' });
    assert.equal(r.structuredContent.iso, '2026-06-12T01:30:00.000Z');
    assert.equal(r.structuredContent.targets[0].local, '2026-06-12T02:30:00.000+01:00');
    // New York winter (EST, -05:00)
    const w = await callTool('convert_time', { time: '2026-01-15T08:00:00', from_timezone: 'America/New_York', to_timezone: 'UTC' });
    assert.equal(w.structuredContent.iso, '2026-01-15T13:00:00.000Z');
  });

  test('convert_time errors', async () => {
    let r = await callTool('convert_time', { time: 'yesterday-ish', to_timezone: 'UTC' });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Invalid time/);
    r = await callTool('convert_time', { time: '2026-02-30 10:00', to_timezone: 'UTC' });
    assert.equal(r.isError, true);
    r = await callTool('convert_time', { time: 0 });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /to_timezone/);
    r = await callTool('convert_time', { time: 0, to_timezone: 'Bad/Zone' });
    assert.equal(r.isError, true);
    r = await callTool('convert_time', { to_timezone: 'UTC' });
    assert.equal(r.isError, true);
  });

  test('time_diff', async () => {
    const r = await callTool('time_diff', { start: '2026-01-01T00:00:00Z', end: '2026-01-02T01:02:03Z' });
    const s = r.structuredContent;
    assert.equal(s.seconds, 90123);
    assert.equal(s.human, '1d 1h 2m 3s');
    const neg = await callTool('time_diff', { start: 1781193600, end: 1781190000 });
    assert.equal(neg.structuredContent.seconds, -3600);
    assert.equal(neg.structuredContent.human, '-0d 1h 0m 0s');
    const now = await callTool('time_diff', { start: Math.floor(Date.now() / 1000) - 60 });
    assert.ok(now.structuredContent.seconds >= 59 && now.structuredContent.seconds < 120);
    const bad = await callTool('time_diff', { start: 'garbage' });
    assert.equal(bad.isError, true);
  });
});
