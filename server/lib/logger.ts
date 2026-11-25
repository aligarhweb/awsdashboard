const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'pass',
  'smtppass',
  'smtppassencrypted',
  'secret',
  'token',
  'apicredentials',
  'apicredentialsencrypted',
  'authorization',
  'cookie',
  'x-cron-secret',
  'accesstoken',
]);

function sanitizeMeta(meta: unknown): unknown {
  if (meta === null || meta === undefined) return meta;
  if (Array.isArray(meta)) return meta.map(sanitizeMeta);
  if (typeof meta === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeMeta(v);
      }
    }
    return out;
  }
  return meta;
}

export function logInfo(message: string, meta?: Record<string, unknown>): void {
  const entry = {
    level: 'info',
    ts: new Date().toISOString(),
    msg: message,
    ...(meta ? { meta: sanitizeMeta(meta) } : {}),
  };
  console.log(JSON.stringify(entry));
}

export function logWarn(message: string, meta?: Record<string, unknown>): void {
  const entry = {
    level: 'warn',
    ts: new Date().toISOString(),
    msg: message,
    ...(meta ? { meta: sanitizeMeta(meta) } : {}),
  };
  console.warn(JSON.stringify(entry));
}

export function logError(message: string, err?: unknown, meta?: Record<string, unknown>): void {
  const errObj =
    err instanceof Error
      ? { name: err.name, message: err.message }
      : err !== undefined
        ? { detail: String(err) }
        : undefined;
  const entry = {
    level: 'error',
    ts: new Date().toISOString(),
    msg: message,
    ...(errObj ? { err: errObj } : {}),
    ...(meta ? { meta: sanitizeMeta(meta) } : {}),
  };
  console.error(JSON.stringify(entry));
}
