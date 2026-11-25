export interface NormalizedDbUrlResult {
  ok: boolean;
  url?: string;
  reason?: string;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Normalizes a MySQL connection URL for Prisma:
 * - Strips accidental surrounding quotes/whitespace
 * - Properly URL-encodes username/password containing special characters (@, :, #, /, ?, %)
 * - Validates host and numeric port (1-65535)
 * - Appends connection_limit=5 if not already present
 */
export function normalizeMysqlUrl(rawInput: string): NormalizedDbUrlResult {
  const trimmed = rawInput.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  if (!trimmed) {
    return { ok: false, reason: 'DATABASE_URL is empty' };
  }

  if (trimmed.includes('DB_USER:DB_PASSWORD') || trimmed.includes('YOUR_DB_PASSWORD')) {
    return { ok: false, reason: 'DATABASE_URL still contains placeholder credentials' };
  }

  const schemeMatch = trimmed.match(/^(mysqls?):\/\/(.+)$/i);
  if (!schemeMatch) {
    return { ok: false, reason: 'DATABASE_URL must start with mysql:// or mysqls://' };
  }

  const scheme = schemeMatch[1].toLowerCase();
  const body = schemeMatch[2];

  // Try candidate '@' positions from right to left so special chars like '@' or '/' inside password work
  const hostPathRegex = /^([a-zA-Z0-9.-]+|\[[0-9a-fA-F:]+\])(?::([^/?#]+))?(\/[^?#]*)?(\?.*)?$/;

  let matchedUserInfo = '';
  let matchedHost = '';
  let matchedPort: string | undefined;
  let matchedPath = '';
  let matchedQuery = '';
  let found = false;

  for (let idx = body.lastIndexOf('@'); idx !== -1; idx = body.lastIndexOf('@', idx - 1)) {
    const candidateRight = body.slice(idx + 1);
    const m = candidateRight.match(hostPathRegex);
    if (m) {
      matchedUserInfo = body.slice(0, idx);
      matchedHost = m[1];
      matchedPort = m[2];
      matchedPath = m[3] || '';
      matchedQuery = m[4] || '';
      found = true;
      break;
    }
  }

  // Also allow URLs without userinfo (rare, e.g. mysql://localhost:3306/db)
  if (!found) {
    const noAuthMatch = body.match(hostPathRegex);
    if (noAuthMatch) {
      matchedHost = noAuthMatch[1];
      matchedPort = noAuthMatch[2];
      matchedPath = noAuthMatch[3] || '';
      matchedQuery = noAuthMatch[4] || '';
      found = true;
    }
  }

  if (!found || !matchedHost) {
    return { ok: false, reason: 'Could not parse hostname from DATABASE_URL' };
  }

  if (matchedPort !== undefined) {
    if (!/^\d+$/.test(matchedPort)) {
      return { ok: false, reason: `Invalid port number "${matchedPort}" in DATABASE_URL` };
    }
    const portNum = Number(matchedPort);
    if (portNum < 1 || portNum > 65535) {
      return { ok: false, reason: `Port number ${portNum} out of range (1-65535)` };
    }
  }

  let authPart = '';
  if (matchedUserInfo) {
    const colonIdx = matchedUserInfo.indexOf(':');
    if (colonIdx === -1) {
      authPart = `${encodeURIComponent(safeDecode(matchedUserInfo))}@`;
    } else {
      const user = matchedUserInfo.slice(0, colonIdx);
      const pass = matchedUserInfo.slice(colonIdx + 1);
      authPart = `${encodeURIComponent(safeDecode(user))}:${encodeURIComponent(safeDecode(pass))}@`;
    }
  }

  let query = matchedQuery;
  if (!query.includes('connection_limit=')) {
    query = query ? `${query}&connection_limit=5` : '?connection_limit=5';
  }

  const portPart = matchedPort ? `:${matchedPort}` : '';
  const normalized = `${scheme}://${authPart}${matchedHost}${portPart}${matchedPath}${query}`;

  // Final verification with native URL parser
  try {
    const check = new URL(normalized);
    if (!check.hostname) {
      return { ok: false, reason: 'Normalized DATABASE_URL has empty hostname' };
    }
  } catch (err: any) {
    return { ok: false, reason: err?.message || 'Invalid DATABASE_URL syntax' };
  }

  return { ok: true, url: normalized };
}
