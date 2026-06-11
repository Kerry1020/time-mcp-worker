export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: { ...cors, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type' } });
    }

    if (req.method === 'GET' && url.pathname === '/') {
      return new Response(JSON.stringify({
        name: 'time-mcp',
        version: '1.0.0',
        description: 'Returns current timestamp. One call per access.',
        tools: [{ name: 'get_time', description: 'Get current Unix timestamp and formatted time', parameters: { type: 'object', properties: {}, required: [] } }],
      }), { headers: cors });
    }

    if (req.method === 'POST' && url.pathname === '/tools/get_time') {
      const now = new Date();
      return new Response(JSON.stringify({ result: {
        unix: Math.floor(now.getTime() / 1000),
        unix_ms: now.getTime(),
        iso: now.toISOString(),
        utc: now.toUTCString(),
        timezones: {
          'Asia/Shanghai': now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          'America/New_York': now.toLocaleString('en-US', { timeZone: 'America/New_York' }),
          'Europe/London': now.toLocaleString('en-GB', { timeZone: 'Europe/London' }),
          'Asia/Tokyo': now.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
        },
      }}), { headers: cors });
    }

    if (url.pathname === '/health') return new Response('OK');
    return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: cors });
  },
};
