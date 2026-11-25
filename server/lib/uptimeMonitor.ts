import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

export interface WebsiteProbeTarget {
  url: string;
  expectedStatusCode?: number | null;
  requiredKeyword?: string | null;
  timeoutMs?: number | null;
}

export interface WebsiteProbeResult {
  up: boolean;
  httpCode: number | null;
  responseMs: number;
  error: string | null;
  sslExpiry: Date | null;
}

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return -1;
  }
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function inIpv4Range(ipInt: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (ipInt < 0 || baseInt < 0) return false;
  const mask = maskBits === 0 ? 0 : (~((1 << (32 - maskBits)) - 1)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * Blocks loopback, private RFC1918, link-local / cloud metadata (169.254.169.254),
 * CGNAT, multicast, and IPv6 ULA/loopback/link-local addresses.
 */
export function isPrivateOrReservedIp(rawIp: string): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const kind = net.isIP(ip);
  if (kind === 0) return true;

  if (kind === 4) {
    const ipInt = ipv4ToInt(ip);
    if (ipInt < 0) return true;
    return (
      inIpv4Range(ipInt, '0.0.0.0', 8) ||
      inIpv4Range(ipInt, '10.0.0.0', 8) ||
      inIpv4Range(ipInt, '100.64.0.0', 10) || // CGNAT
      inIpv4Range(ipInt, '127.0.0.0', 8) || // Loopback
      inIpv4Range(ipInt, '169.254.0.0', 16) || // Link-local & cloud metadata
      inIpv4Range(ipInt, '172.16.0.0', 12) || // RFC1918
      inIpv4Range(ipInt, '192.0.0.0', 24) ||
      inIpv4Range(ipInt, '192.0.2.0', 24) || // TEST-NET-1
      inIpv4Range(ipInt, '192.168.0.0', 16) || // RFC1918
      inIpv4Range(ipInt, '198.18.0.0', 15) || // Benchmark
      inIpv4Range(ipInt, '198.51.100.0', 24) ||
      inIpv4Range(ipInt, '203.0.113.0', 24) ||
      inIpv4Range(ipInt, '224.0.0.0', 4) || // Multicast
      inIpv4Range(ipInt, '240.0.0.0', 4) // Reserved
    );
  }

  // IPv6 checks
  if (ip === '::' || ip === '::1') return true;
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) return isPrivateOrReservedIp(mapped);
  }
  // fc00::/7 (Unique local address)
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
  // fe80::/10 (Link-local)
  if (/^fe[89ab]/.test(ip)) return true;
  // ff00::/8 (Multicast)
  if (ip.startsWith('ff')) return true;

  return false;
}

export interface ValidatedUrlResult {
  normalizedUrl: string;
  hostname: string;
  protocol: 'http:' | 'https:';
  port: number;
}

export async function validatePublicMonitorUrl(
  rawUrl: string,
  options: {
    requireDnsResolution?: boolean;
    lookupFn?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  } = {}
): Promise<ValidatedUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid website URL format');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are permitted');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Embedded credentials in URLs are not permitted');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) {
    throw new Error('URL hostname is missing');
  }

  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal' ||
    hostname === '169.254.169.254'
  ) {
    throw new Error(`Monitoring private or local host "${hostname}" is not permitted`);
  }

  if (net.isIP(hostname) !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error(`Monitoring private or reserved IP "${hostname}" is not permitted`);
    }
  } else {
    const lookup =
      options.lookupFn || ((h: string) => dns.lookup(h, { all: true }));
    try {
      const addresses = await lookup(hostname);
      if (addresses.length === 0 && options.requireDnsResolution) {
        throw new Error(`Hostname "${hostname}" did not resolve to any IP address`);
      }
      for (const addr of addresses) {
        if (isPrivateOrReservedIp(addr.address)) {
          throw new Error(
            `Hostname "${hostname}" resolved to restricted IP "${addr.address}"`
          );
        }
      }
    } catch (err: any) {
      if (err?.message?.includes('restricted IP') || err?.message?.includes('did not resolve')) {
        throw err;
      }
      if (options.requireDnsResolution) {
        throw new Error(`DNS resolution failed for "${hostname}": ${err?.code || err?.message || 'unknown error'}`);
      }
    }
  }

  const port = parsed.port
    ? Number(parsed.port)
    : parsed.protocol === 'https:'
      ? 443
      : 80;

  return {
    normalizedUrl: parsed.toString(),
    hostname,
    protocol: parsed.protocol,
    port,
  };
}

export async function inspectSslExpiry(
  hostname: string,
  port = 443,
  timeoutMs = 5000
): Promise<Date | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (val: Date | null) => {
      if (settled) return;
      settled = true;
      resolve(val);
    };

    try {
      const socket = tls.connect(
        {
          host: hostname,
          port,
          servername: net.isIP(hostname) ? undefined : hostname,
          rejectUnauthorized: false,
        },
        () => {
          try {
            const cert = socket.getPeerCertificate();
            const validTo = cert?.valid_to ? new Date(cert.valid_to) : null;
            socket.end();
            if (validTo && !Number.isNaN(validTo.getTime())) {
              finish(validTo);
            } else {
              finish(null);
            }
          } catch {
            socket.destroy();
            finish(null);
          }
        }
      );

      socket.setTimeout(timeoutMs, () => {
        socket.destroy();
        finish(null);
      });
      socket.on('error', () => {
        socket.destroy();
        finish(null);
      });
    } catch {
      finish(null);
    }
  });
}

export async function probeWebsite(
  target: WebsiteProbeTarget,
  options: {
    fetchFn?: typeof fetch;
    sslInspector?: (hostname: string, port: number) => Promise<Date | null>;
    lookupFn?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  } = {}
): Promise<WebsiteProbeResult> {
  const startedAt = Date.now();
  const timeoutMs = Math.max(1000, Math.min(30000, Number(target.timeoutMs || 10000)));
  const expectedStatus = Number(target.expectedStatusCode || 200);
  const keyword = target.requiredKeyword?.trim() || null;
  const fetchFn = options.fetchFn || fetch;
  const sslInspector = options.sslInspector || inspectSslExpiry;

  let currentUrl = target.url;
  let lastValidated: ValidatedUrlResult | null = null;

  try {
    const maxRedirects = 3;
    let response: Response | null = null;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      lastValidated = await validatePublicMonitorUrl(currentUrl, {
        requireDnsResolution: true,
        lookupFn: options.lookupFn,
      });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetchFn(lastValidated.normalizedUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent': 'AWS-Control-Center-UptimeMonitor/1.0',
            Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          },
        });
      } finally {
        clearTimeout(timer);
      }

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.get('location') &&
        hop < maxRedirects
      ) {
        const nextLoc = response.headers.get('location')!;
        currentUrl = new URL(nextLoc, lastValidated.normalizedUrl).toString();
        continue;
      }
      break;
    }

    const responseMs = Math.max(1, Date.now() - startedAt);
    if (!response || !lastValidated) {
      return {
        up: false,
        httpCode: null,
        responseMs,
        error: 'No HTTP response received',
        sslExpiry: null,
      };
    }

    let sslExpiry: Date | null = null;
    if (lastValidated.protocol === 'https:') {
      sslExpiry = await sslInspector(lastValidated.hostname, lastValidated.port).catch(() => null);
    }

    const httpCode = response.status;
    if (httpCode !== expectedStatus) {
      return {
        up: false,
        httpCode,
        responseMs,
        error: `Expected HTTP ${expectedStatus}, received ${httpCode}`,
        sslExpiry,
      };
    }

    if (keyword) {
      const bodyText = await response.text().catch(() => '');
      if (!bodyText.includes(keyword)) {
        return {
          up: false,
          httpCode,
          responseMs,
          error: `Required keyword "${keyword}" missing from response`,
          sslExpiry,
        };
      }
    }

    return {
      up: true,
      httpCode,
      responseMs,
      error: null,
      sslExpiry,
    };
  } catch (err: any) {
    const responseMs = Math.max(1, Date.now() - startedAt);
    const isAbort = err?.name === 'AbortError' || String(err?.message || '').includes('aborted');
    return {
      up: false,
      httpCode: null,
      responseMs,
      error: isAbort
        ? `Request timed out after ${timeoutMs}ms`
        : String(err?.message || 'Network request failed').slice(0, 480),
      sslExpiry: null,
    };
  }
}

export function computeUptimePercent(
  checks: Array<{ up: boolean }>
): number | null {
  if (!checks || checks.length === 0) return null;
  const upCount = checks.filter((c) => Boolean(c.up)).length;
  return Math.round((upCount / checks.length) * 10000) / 100;
}
