// Cloudflare Worker entry point.
//
// Routes:
//   POST /mcp             MCP Streamable HTTP endpoint (JSON-RPC 2.0, JSON responses)
//   GET  /                Legacy discovery document (kept for backward compatibility)
//   POST /tools/get_time  Legacy REST tool endpoint (kept for backward compatibility)
//   GET  /health          Liveness probe

import { handlePayload, listTools, ERR, SERVER_INFO, SUPPORTED_PROTOCOL_VERSIONS } from './mcp.js';
import { legacyGetTime, InputError } from './time.js';

const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'access-control-expose-headers': 'Mcp-Session-Id, Mcp-Protocol-Version',
  'access-control-max-age': '86400',
};

// path -> allowed methods (OPTIONS is always allowed)
const ROUTES = {
  '/': ['GET', 'HEAD'],
  '/health': ['GET', 'HEAD'],
  '/tools/get_time': ['POST'],
  '/mcp': ['POST'],
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8', ...extra },
  });
}

function empty(status, extra = {}) {
  return new Response(null, { status, headers: { ...CORS_HEADERS, ...extra } });
}

async function readBody(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY_BYTES) return { tooLarge: true };
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { tooLarge: true };
  return { text };
}

async function handleMcp(req) {
  const pv = req.headers.get('mcp-protocol-version');
  if (pv && !SUPPORTED_PROTOCOL_VERSIONS.includes(pv)) {
    return json({ jsonrpc: '2.0', id: null, error: { code: ERR.INVALID_REQUEST, message: `Unsupported MCP-Protocol-Version: ${pv}` } }, 400);
  }
  const { text, tooLarge } = await readBody(req);
  if (tooLarge) return json({ jsonrpc: '2.0', id: null, error: { code: ERR.INVALID_REQUEST, message: 'Request body too large' } }, 413);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: ERR.PARSE, message: 'Parse error' } }, 400);
  }

  const response = handlePayload(payload);
  // Only notifications / responses were sent: acknowledge with 202 and no body.
  if (response === null) return empty(202);
  return json(response);
}

function discovery() {
  return {
    name: 'time-mcp',
    version: SERVER_INFO.version,
    description: 'Time utilities over MCP (POST /mcp) and a legacy REST API.',
    mcp_endpoint: '/mcp',
    // Legacy shape: `parameters` mirrors the MCP `inputSchema`.
    tools: listTools().map((t) => ({ name: t.name, description: t.description, parameters: t.inputSchema })),
  };
}

async function handleLegacyGetTime(req) {
  const { text, tooLarge } = await readBody(req);
  if (tooLarge) return json({ error: 'payload_too_large' }, 413);
  let args = {};
  if (text && text.trim()) {
    try {
      args = JSON.parse(text);
    } catch {
      return json({ error: 'invalid_json', message: 'Request body must be JSON (or empty).' }, 400);
    }
  }
  try {
    return json({ result: legacyGetTime(args) });
  } catch (e) {
    if (e instanceof InputError) return json({ error: 'invalid_argument', message: e.message }, 400);
    throw e;
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const allowed = ROUTES[path];

    if (!allowed) return json({ error: 'not_found', path: url.pathname }, 404);
    if (req.method === 'OPTIONS') return empty(204);
    if (!allowed.includes(req.method)) {
      return json({ error: 'method_not_allowed', allowed }, 405, { allow: [...allowed, 'OPTIONS'].join(', ') });
    }

    try {
      switch (path) {
        case '/':
          return json(discovery());
        case '/health':
          return new Response('OK', { headers: { ...CORS_HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
        case '/tools/get_time':
          return await handleLegacyGetTime(req);
        case '/mcp':
          return await handleMcp(req);
      }
    } catch (e) {
      console.error('Unhandled error', e);
      return json({ error: 'internal_error' }, 500);
    }
  },
};
