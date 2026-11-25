import { validatePublicMonitorUrl } from './uptimeMonitor';

export interface RdapLookupResult {
  supported: boolean;
  expiryDate: Date | null;
  nameservers: string[];
  rdapUrl: string | null;
  error?: string;
}

const FALLBACK_RDAP_SERVERS: Record<string, string> = {
  com: 'https://rdap.verisign.com/com/v1/',
  net: 'https://rdap.verisign.com/net/v1/',
  org: 'https://rdap.publicinterestregistry.org/rdap/',
  in: 'https://rdap.registry.in/rdap/',
  io: 'https://rdap.identitydigital.services/rdap/',
  info: 'https://rdap.identitydigital.services/rdap/',
  dev: 'https://pubapi.registry.google/rdap/',
  app: 'https://pubapi.registry.google/rdap/',
  xyz: 'https://rdap.centralnic.com/xyz/',
  co: 'https://rdap.registry.co/',
  ai: 'https://rdap.identitydigital.services/rdap/',
};

let bootstrapCache: {
  fetchedAt: number;
  tldToUrl: Map<string, string>;
} | null = null;

const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;

export function parseRdapBootstrapServices(services: any[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(services)) return map;
  for (const entry of services) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const tlds = Array.isArray(entry[0]) ? entry[0] : [];
    const urls = Array.isArray(entry[1]) ? entry[1] : [];
    const httpsUrl = urls.find((u: any) => typeof u === 'string' && u.startsWith('https://')) || urls[0];
    if (!httpsUrl || typeof httpsUrl !== 'string') continue;
    const normalizedBase = httpsUrl.endsWith('/') ? httpsUrl : `${httpsUrl}/`;
    for (const tld of tlds) {
      if (typeof tld === 'string' && tld.trim()) {
        map.set(tld.trim().toLowerCase(), normalizedBase);
      }
    }
  }
  return map;
}

async function getRdapBootstrapMap(fetchFn: typeof fetch = fetch): Promise<Map<string, string>> {
  const now = Date.now();
  if (bootstrapCache && now - bootstrapCache.fetchedAt < BOOTSTRAP_TTL_MS) {
    return bootstrapCache.tldToUrl;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetchFn('https://data.iana.org/rdap/dns.json', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer));

    if (resp.ok) {
      const json: any = await resp.json();
      const map = parseRdapBootstrapServices(json?.services);
      if (map.size > 0) {
        bootstrapCache = { fetchedAt: now, tldToUrl: map };
        return map;
      }
    }
  } catch {
    // Fall back to static map below
  }

  const fallback = new Map<string, string>(Object.entries(FALLBACK_RDAP_SERVERS));
  return fallback;
}

export function extractDomainTld(domainName: string): string | null {
  const clean = domainName.trim().toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(clean)) return null;
  const parts = clean.split('.');
  const tld = parts[parts.length - 1];
  if (!tld || ['local', 'localhost', 'internal', 'lan'].includes(tld)) return null;
  return tld;
}

export function parseRdapPayload(json: any): { expiryDate: Date | null; nameservers: string[] } {
  let expiryDate: Date | null = null;
  const events = Array.isArray(json?.events) ? json.events : [];
  for (const ev of events) {
    const action = String(ev?.eventAction || '').toLowerCase();
    if (action === 'expiration' || action === 'soft expiration') {
      const parsed = ev?.eventDate ? new Date(ev.eventDate) : null;
      if (parsed && !Number.isNaN(parsed.getTime())) {
        expiryDate = parsed;
        break;
      }
    }
  }

  const nameservers: string[] = [];
  if (Array.isArray(json?.nameservers)) {
    for (const ns of json.nameservers) {
      const ldh = typeof ns?.ldhName === 'string' ? ns.ldhName.trim().toLowerCase() : '';
      if (ldh && !nameservers.includes(ldh)) {
        nameservers.push(ldh);
      }
    }
  }

  return { expiryDate, nameservers };
}

export async function lookupDomainRdap(
  domainName: string,
  options: {
    fetchFn?: typeof fetch;
    rdapBaseUrlOverride?: string;
    skipSsrfCheck?: boolean;
  } = {}
): Promise<RdapLookupResult> {
  const cleanName = domainName.trim().toLowerCase().replace(/\.$/, '');
  const tld = extractDomainTld(cleanName);
  if (!tld) {
    return {
      supported: false,
      expiryDate: null,
      nameservers: [],
      rdapUrl: null,
      error: 'Invalid or non-public domain name',
    };
  }

  const fetchFn = options.fetchFn || fetch;
  let baseUrl = options.rdapBaseUrlOverride || null;
  if (!baseUrl) {
    const map = await getRdapBootstrapMap(fetchFn);
    baseUrl = map.get(tld) || FALLBACK_RDAP_SERVERS[tld] || null;
  }

  if (!baseUrl) {
    return {
      supported: false,
      expiryDate: null,
      nameservers: [],
      rdapUrl: null,
      error: `No RDAP server published for .${tld}`,
    };
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  let currentUrl = `${normalizedBase}domain/${encodeURIComponent(cleanName)}`;

  try {
    let response: Response | null = null;
    for (let hop = 0; hop <= 2; hop++) {
      if (!options.skipSsrfCheck) {
        await validatePublicMonitorUrl(currentUrl, { requireDnsResolution: true });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      response = await fetchFn(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'application/rdap+json, application/json',
          'User-Agent': 'AWS-Control-Center-RDAP/1.0',
        },
      }).finally(() => clearTimeout(timer));

      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.get('location') &&
        hop < 2
      ) {
        currentUrl = new URL(response.headers.get('location')!, currentUrl).toString();
        continue;
      }
      break;
    }

    if (!response) {
      return {
        supported: false,
        expiryDate: null,
        nameservers: [],
        rdapUrl: currentUrl,
        error: 'Empty RDAP response',
      };
    }

    if (response.status === 404 || response.status === 400 || response.status === 501) {
      return {
        supported: false,
        expiryDate: null,
        nameservers: [],
        rdapUrl: currentUrl,
        error: `RDAP returned HTTP ${response.status}`,
      };
    }

    if (!response.ok) {
      return {
        supported: true,
        expiryDate: null,
        nameservers: [],
        rdapUrl: currentUrl,
        error: `RDAP HTTP ${response.status}`,
      };
    }

    const json: any = await response.json();
    const { expiryDate, nameservers } = parseRdapPayload(json);
    return {
      supported: true,
      expiryDate,
      nameservers,
      rdapUrl: currentUrl,
    };
  } catch (err: any) {
    return {
      supported: true,
      expiryDate: null,
      nameservers: [],
      rdapUrl: currentUrl,
      error: err?.message || 'RDAP query failed',
    };
  }
}
