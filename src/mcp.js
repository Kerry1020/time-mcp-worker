// Minimal MCP (Model Context Protocol) JSON-RPC 2.0 handler.
// Transport: Streamable HTTP, JSON responses only (no SSE streams).

import { TOOLS, InputError } from './time.js';

export const SERVER_INFO = { name: 'time-mcp-worker', title: 'Time MCP', version: '2.0.0' };

// Newest first. If the client asks for one of these we echo it, otherwise we offer the newest.
export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

const toolMap = new Map(TOOLS.map((t) => [t.name, t]));

export function listTools() {
  return TOOLS.map(({ handler, ...def }) => def);
}

const error = (id, code, message, data) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: data === undefined ? { code, message } : { code, message, data },
});
const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });

function isValidId(id) {
  return typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));
}

function callTool(params) {
  const tool = toolMap.get(params.name);
  if (!tool) return { error: [ERR.INVALID_PARAMS, `Unknown tool: ${params.name}`] };
  try {
    const out = tool.handler(params.arguments ?? {});
    return { result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false } };
  } catch (e) {
    if (e instanceof InputError) {
      // Tool-level failure: reported in the result so the model can see and correct it.
      return { result: { content: [{ type: 'text', text: e.message }], isError: true } };
    }
    throw e;
  }
}

/**
 * Handle one JSON-RPC message. Returns a response object, or null for notifications.
 */
export function handleMessage(msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    // A response object sent by the client (has result/error, no method) is accepted and ignored.
    if (msg && typeof msg === 'object' && msg.jsonrpc === '2.0' && !('method' in msg) && ('result' in msg || 'error' in msg)) return null;
    const id = msg && typeof msg === 'object' && isValidId(msg.id) ? msg.id : null;
    return error(id, ERR.INVALID_REQUEST, 'Invalid Request');
  }

  const isNotification = !('id' in msg);
  if (!isNotification && !isValidId(msg.id)) return error(null, ERR.INVALID_REQUEST, 'Invalid Request: id must be a string or number');
  if (isNotification) return null; // notifications/initialized, notifications/cancelled, etc.

  const { id, method } = msg;
  const params = msg.params ?? {};
  if (typeof params !== 'object' || Array.isArray(params)) return error(id, ERR.INVALID_PARAMS, 'params must be an object');

  try {
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0];
        return result(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: 'Time utilities: get the current time, convert timestamps between IANA time zones, and compute time differences.',
        });
      }
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, { tools: listTools() });
      case 'tools/call': {
        if (typeof params.name !== 'string') return error(id, ERR.INVALID_PARAMS, 'Missing or invalid tool name');
        if (params.arguments !== undefined && (params.arguments === null || typeof params.arguments !== 'object' || Array.isArray(params.arguments))) {
          return error(id, ERR.INVALID_PARAMS, 'arguments must be an object');
        }
        const r = callTool(params);
        return r.error ? error(id, ...r.error) : result(id, r.result);
      }
      default:
        return error(id, ERR.METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  } catch (e) {
    return error(id, ERR.INTERNAL, 'Internal error');
  }
}

/**
 * Handle a parsed JSON-RPC payload (single message or batch).
 * Returns the response body (object/array) or null when there is nothing to send back.
 */
export function handlePayload(payload) {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return error(null, ERR.INVALID_REQUEST, 'Invalid Request: empty batch');
    const out = payload.map(handleMessage).filter((r) => r !== null);
    return out.length ? out : null;
  }
  return handleMessage(payload);
}
