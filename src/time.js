// Pure time helpers and tool implementations. No Worker-specific APIs here,
// so everything can be unit tested directly under Node.

export const DEFAULT_TIMEZONES = ['Asia/Shanghai', 'America/New_York', 'Europe/London', 'Asia/Tokyo'];

// Locales used by the legacy REST endpoint, kept for backward compatibility.
const LEGACY_LOCALES = {
  'Asia/Shanghai': 'zh-CN',
  'America/New_York': 'en-US',
  'Europe/London': 'en-GB',
  'Asia/Tokyo': 'ja-JP',
};

const MAX_TIMEZONES = 20;

/** Error whose message is safe to show to the caller (bad input). */
export class InputError extends Error {}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function assertTimeZone(tz, field = 'timezone') {
  if (!isValidTimeZone(tz)) {
    throw new InputError(`Invalid ${field}: ${JSON.stringify(tz)}. Use an IANA time zone name such as "UTC", "Asia/Shanghai" or "America/New_York".`);
  }
  return tz;
}

function parts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'long',
    timeZoneName: 'longOffset',
  });
  const out = {};
  for (const p of fmt.formatToParts(date)) out[p.type] = p.value;
  return out;
}

/** Offset of `tz` from UTC at instant `date`, in minutes (e.g. +480 for Asia/Shanghai). */
export function offsetMinutes(date, tz) {
  const name = parts(date, tz).timeZoneName; // "GMT", "GMT+08:00", "GMT-04:00", "GMT+05:45"
  const m = /^GMT(?:([+-])(\d{2}):?(\d{2})?)?$/.exec(name);
  if (!m || !m[1]) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] || 0));
}

function formatOffset(mins) {
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}

/** Describe an instant in a given time zone. */
export function describe(date, tz) {
  const p = parts(date, tz);
  const off = offsetMinutes(date, tz);
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
  return {
    timezone: tz,
    local: `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.${ms}${formatOffset(off)}`,
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}:${p.second}`,
    weekday: p.weekday,
    utc_offset: formatOffset(off),
    utc_offset_minutes: off,
  };
}

const NAIVE_ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/;

/**
 * Parse a time value into a Date.
 * Accepts: unix seconds / milliseconds (number or numeric string; values >= 1e11 are treated as ms),
 * ISO 8601 strings with an offset/Z, or naive ISO strings interpreted in `fromTz` (default UTC).
 */
export function parseTime(value, fromTz = 'UTC', field = 'time') {
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()))) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new InputError(`Invalid ${field}: not a finite number.`);
    const ms = Math.abs(n) >= 1e11 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) throw new InputError(`Invalid ${field}: out of range.`);
    return d;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw new InputError(`Invalid ${field}: expected an ISO 8601 string or a unix timestamp.`);
  }
  const s = value.trim();
  const naive = NAIVE_ISO.exec(s);
  if (naive) {
    const [, y, mo, d, h = '0', mi = '0', se = '0', frac = '0'] = naive;
    const wall = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se, Number(frac.padEnd(3, '0')));
    const check = new Date(wall);
    if (Number.isNaN(wall) || check.getUTCMonth() !== +mo - 1 || check.getUTCDate() !== +d || +h > 23 || +mi > 59 || +se > 59) {
      throw new InputError(`Invalid ${field}: ${JSON.stringify(value)} is not a valid date/time.`);
    }
    // Wall-clock time in fromTz -> UTC instant. Two passes handle DST transitions.
    let t = wall - offsetMinutes(new Date(wall), fromTz) * 60000;
    const off2 = offsetMinutes(new Date(t), fromTz);
    t = wall - off2 * 60000;
    return new Date(t);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new InputError(`Invalid ${field}: ${JSON.stringify(value)}. Expected ISO 8601 (e.g. "2026-06-11T16:00:00Z") or a unix timestamp.`);
  }
  return d;
}

function normalizeTimezones(args) {
  let list = [];
  if (args.timezone !== undefined) list.push(assertTimeZone(args.timezone, 'timezone'));
  if (args.timezones !== undefined) {
    if (!Array.isArray(args.timezones)) throw new InputError('Invalid timezones: expected an array of IANA time zone names.');
    if (args.timezones.length > MAX_TIMEZONES) throw new InputError(`Invalid timezones: at most ${MAX_TIMEZONES} entries allowed.`);
    for (const tz of args.timezones) list.push(assertTimeZone(tz, 'timezones entry'));
  }
  return [...new Set(list)];
}

function base(date) {
  return {
    unix: Math.floor(date.getTime() / 1000),
    unix_ms: date.getTime(),
    iso: date.toISOString(),
    utc: date.toUTCString(),
  };
}

function ensureObject(args) {
  if (args === undefined || args === null) return {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new InputError('Arguments must be an object.');
  return args;
}

// ---- Tools -----------------------------------------------------------------

export function getTime(rawArgs, now = new Date()) {
  const args = ensureObject(rawArgs);
  const list = normalizeTimezones(args);
  const zones = list.length ? list : ['UTC', ...DEFAULT_TIMEZONES];
  return { ...base(now), timezones: zones.map((tz) => describe(now, tz)) };
}

export function convertTime(rawArgs) {
  const args = ensureObject(rawArgs);
  if (args.time === undefined) throw new InputError('Missing required argument: time.');
  const from = args.from_timezone === undefined ? 'UTC' : assertTimeZone(args.from_timezone, 'from_timezone');
  const targets = [];
  if (args.to_timezone !== undefined) targets.push(assertTimeZone(args.to_timezone, 'to_timezone'));
  if (args.to_timezones !== undefined) {
    if (!Array.isArray(args.to_timezones)) throw new InputError('Invalid to_timezones: expected an array.');
    if (args.to_timezones.length > MAX_TIMEZONES) throw new InputError(`Invalid to_timezones: at most ${MAX_TIMEZONES} entries allowed.`);
    for (const tz of args.to_timezones) targets.push(assertTimeZone(tz, 'to_timezones entry'));
  }
  if (targets.length === 0) throw new InputError('Missing required argument: to_timezone (or to_timezones).');
  const date = parseTime(args.time, from, 'time');
  return {
    input: args.time,
    ...base(date),
    source: describe(date, from),
    targets: [...new Set(targets)].map((tz) => describe(date, tz)),
  };
}

export function timeDiff(rawArgs, now = new Date()) {
  const args = ensureObject(rawArgs);
  if (args.start === undefined) throw new InputError('Missing required argument: start.');
  const tz = args.timezone === undefined ? 'UTC' : assertTimeZone(args.timezone, 'timezone');
  const start = parseTime(args.start, tz, 'start');
  const end = args.end === undefined ? now : parseTime(args.end, tz, 'end');
  const ms = end.getTime() - start.getTime();
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    milliseconds: ms,
    seconds: ms / 1000,
    minutes: ms / 60000,
    hours: ms / 3600000,
    days: ms / 86400000,
    human: `${ms < 0 ? '-' : ''}${d}d ${h}h ${m}m ${s}s`,
  };
}

/** Legacy REST payload for POST /tools/get_time (shape kept stable). */
export function legacyGetTime(rawArgs, now = new Date()) {
  const args = ensureObject(rawArgs);
  const list = normalizeTimezones(args);
  const zones = list.length ? list : DEFAULT_TIMEZONES;
  const timezones = {};
  for (const tz of zones) timezones[tz] = now.toLocaleString(LEGACY_LOCALES[tz] || 'en-US', { timeZone: tz });
  return { ...base(now), timezones };
}

const timezoneProp = { type: 'string', description: 'IANA time zone name, e.g. "Asia/Shanghai".' };

export const TOOLS = [
  {
    name: 'get_time',
    title: 'Get current time',
    description: 'Get the current time as unix timestamp, ISO 8601 and local wall-clock time in one or more IANA time zones. Defaults to UTC plus a few common zones.',
    inputSchema: {
      type: 'object',
      properties: {
        timezone: timezoneProp,
        timezones: { type: 'array', items: { type: 'string' }, maxItems: MAX_TIMEZONES, description: 'List of IANA time zone names.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (args) => getTime(args),
  },
  {
    name: 'convert_time',
    title: 'Convert time between time zones',
    description: 'Convert a timestamp (ISO 8601 string or unix seconds/milliseconds) to one or more time zones. ISO strings without an offset are interpreted in from_timezone (default UTC).',
    inputSchema: {
      type: 'object',
      properties: {
        time: { type: ['string', 'number'], description: 'ISO 8601 string (e.g. "2026-06-11T16:00:00Z" or "2026-06-12 09:30") or unix timestamp (seconds, or milliseconds if >= 1e11).' },
        from_timezone: { ...timezoneProp, description: 'Time zone used to interpret ISO strings without an offset. Default "UTC".' },
        to_timezone: { ...timezoneProp, description: 'Target IANA time zone.' },
        to_timezones: { type: 'array', items: { type: 'string' }, maxItems: MAX_TIMEZONES, description: 'Multiple target IANA time zones.' },
      },
      required: ['time'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (args) => convertTime(args),
  },
  {
    name: 'time_diff',
    title: 'Difference between two times',
    description: 'Compute end - start between two timestamps (ISO 8601 or unix). If end is omitted, the current time is used.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: ['string', 'number'], description: 'Start time (ISO 8601 or unix timestamp).' },
        end: { type: ['string', 'number'], description: 'End time (ISO 8601 or unix timestamp). Defaults to now.' },
        timezone: { ...timezoneProp, description: 'Time zone used to interpret ISO strings without an offset. Default "UTC".' },
      },
      required: ['start'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: (args) => timeDiff(args),
  },
];
