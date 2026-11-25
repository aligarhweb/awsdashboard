import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

type RecordRow = Record<string, any>;

interface StoreData {
  User: RecordRow[];
  Session: RecordRow[];
  Client: RecordRow[];
  ProviderAccount: RecordRow[];
  Domain: RecordRow[];
  Service: RecordRow[];
  ServiceDomain: RecordRow[];
  Website: RecordRow[];
  UptimeCheck: RecordRow[];
  Incident: RecordRow[];
  CatalogItem: RecordRow[];
  Estimate: RecordRow[];
  EstimateItem: RecordRow[];
  Invoice: RecordRow[];
  InvoiceItem: RecordRow[];
  Payment: RecordRow[];
  CreditNote: RecordRow[];
  Expense: RecordRow[];
  MessageLog: RecordRow[];
  ReminderRule: RecordRow[];
  MessageTemplate: RecordRow[];
  Settings: RecordRow[];
  JobState: RecordRow[];
  AuditLog: RecordRow[];
  Task: RecordRow[];
}

const DATE_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'expiresAt',
  'lastLoginAt',
  'resetTokenExpiresAt',
  'registeredOn',
  'expiryDate',
  'lastRdapVerifiedAt',
  'rdapExpiryDate',
  'sslExpiryDate',
  'startDate',
  'renewalDate',
  'lastRunAt',
  'lastSuccessAt',
  'lockedUntil',
  'dueDate',
  'issueDate',
  'validUntil',
  'viewedAt',
  'respondedAt',
  'nextRecurringAt',
  'paidAt',
  'issuedAt',
  'date',
  'lastCheckedAt',
  'sslExpiry',
  'checkedAt',
  'startedAt',
  'endedAt',
  'scheduledAt',
  'sentAt',
  'nextRetryAt',
]);

const DATA_DIR = path.resolve(process.cwd(), '.preview-data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

function emptyData(): StoreData {
  return {
    User: [],
    Session: [],
    Client: [],
    ProviderAccount: [],
    Domain: [],
    Service: [],
    ServiceDomain: [],
    Website: [],
    UptimeCheck: [],
    Incident: [],
    CatalogItem: [],
    Estimate: [],
    EstimateItem: [],
    Invoice: [],
    InvoiceItem: [],
    Payment: [],
    CreditNote: [],
    Expense: [],
    MessageLog: [],
    ReminderRule: [],
    MessageTemplate: [],
    Settings: [],
    JobState: [],
    AuditLog: [],
    Task: [],
  };
}

function reviveDates(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(reviveDates);
  if (typeof obj === 'object') {
    const out: RecordRow = {};
    for (const [k, v] of Object.entries(obj)) {
      if (DATE_FIELDS.has(k) && typeof v === 'string') {
        const d = new Date(v);
        out[k] = Number.isNaN(d.getTime()) ? v : d;
      } else {
        out[k] = reviveDates(v);
      }
    }
    return out;
  }
  return obj;
}

function loadStore(): StoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...emptyData(), ...reviveDates(parsed) };
    }
  } catch {
    // ignore corrupt preview file
  }
  return emptyData();
}

function saveStore(data: StoreData): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function matchCondition(val: any, cond: any): boolean {
  if (cond === undefined) return true;
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
    if (val instanceof Date && cond instanceof Date) {
      return val.getTime() === cond.getTime();
    }
    return val === cond;
  }
  if ('equals' in cond && val !== cond.equals) return false;
  if ('not' in cond && val === cond.not) return false;
  if ('in' in cond && Array.isArray(cond.in) && !cond.in.includes(val)) return false;
  if ('notIn' in cond && Array.isArray(cond.notIn) && cond.notIn.includes(val)) return false;
  if ('contains' in cond) {
    const haystack = String(val ?? '').toLowerCase();
    const needle = String(cond.contains ?? '').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  if ('lt' in cond) {
    const a = val instanceof Date ? val.getTime() : Number(val);
    const b = cond.lt instanceof Date ? cond.lt.getTime() : Number(cond.lt);
    if (!(a < b)) return false;
  }
  if ('lte' in cond) {
    const a = val instanceof Date ? val.getTime() : Number(val);
    const b = cond.lte instanceof Date ? cond.lte.getTime() : Number(cond.lte);
    if (!(a <= b)) return false;
  }
  if ('gt' in cond) {
    const a = val instanceof Date ? val.getTime() : Number(val);
    const b = cond.gt instanceof Date ? cond.gt.getTime() : Number(cond.gt);
    if (!(a > b)) return false;
  }
  if ('gte' in cond) {
    const a = val instanceof Date ? val.getTime() : Number(val);
    const b = cond.gte instanceof Date ? cond.gte.getTime() : Number(cond.gte);
    if (!(a >= b)) return false;
  }
  return true;
}

function matchesWhere(row: RecordRow, where?: RecordRow): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'AND' && Array.isArray(v)) {
      if (!v.every((sub) => matchesWhere(row, sub))) return false;
      continue;
    }
    if (k === 'OR' && Array.isArray(v)) {
      if (!v.some((sub) => matchesWhere(row, sub))) return false;
      continue;
    }
    if (k === 'NOT') {
      const list = Array.isArray(v) ? v : [v];
      if (list.some((sub) => matchesWhere(row, sub))) return false;
      continue;
    }
    if (k.includes('_') && v && typeof v === 'object' && !(v instanceof Date)) {
      const parts = k.split('_');
      if (parts.every((p) => p in v)) {
        if (!parts.every((p) => row[p] === v[p])) return false;
        continue;
      }
    }
    if (!matchCondition(row[k], v)) return false;
  }
  return true;
}

function sortRows(rows: RecordRow[], orderBy?: RecordRow | RecordRow[]): RecordRow[] {
  if (!orderBy) return rows;
  const specs = Array.isArray(orderBy) ? orderBy : [orderBy];
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      for (const [field, dir] of Object.entries(spec)) {
        const av = a[field];
        const bv = b[field];
        const aNorm = av instanceof Date ? av.getTime() : av ?? '';
        const bNorm = bv instanceof Date ? bv.getTime() : bv ?? '';
        if (aNorm < bNorm) return dir === 'desc' ? 1 : -1;
        if (aNorm > bNorm) return dir === 'desc' ? -1 : 1;
      }
    }
    return 0;
  });
}

function hydrateRow(table: keyof StoreData, row: RecordRow, store: StoreData, include?: RecordRow): RecordRow {
  const copy = { ...row };
  if (!include) return copy;

  if (table === 'Session' && include.user) {
    copy.user = store.User.find((u) => u.id === row.userId) ?? null;
  }

  if (table === 'Client') {
    if (include._count) {
      copy._count = {
        domains: store.Domain.filter((d) => d.clientId === row.id).length,
        services: store.Service.filter((s) => s.clientId === row.id).length,
        invoices: store.Invoice.filter((i) => i.clientId === row.id).length,
      };
    }
    if (include.domains) {
      copy.domains = store.Domain.filter((d) => d.clientId === row.id).map((d) =>
        hydrateRow('Domain', d, store, include.domains?.include)
      );
    }
    if (include.services) {
      copy.services = store.Service.filter((s) => s.clientId === row.id).map((s) =>
        hydrateRow('Service', s, store, include.services?.include)
      );
    }
    if (include.invoices) {
      copy.invoices = sortRows(
        store.Invoice.filter((i) => i.clientId === row.id),
        include.invoices?.orderBy || { issueDate: 'desc' }
      ).map((i) => hydrateRow('Invoice', i, store, include.invoices?.include));
    }
    if (include.estimates) {
      copy.estimates = sortRows(
        store.Estimate.filter((e) => e.clientId === row.id),
        include.estimates?.orderBy || { issueDate: 'desc' }
      ).map((e) => hydrateRow('Estimate', e, store, include.estimates?.include));
    }
    if (include.payments) {
      copy.payments = sortRows(
        store.Payment.filter((p) => p.clientId === row.id),
        include.payments?.orderBy || { paidAt: 'desc' }
      ).map((p) => hydrateRow('Payment', p, store, include.payments?.include));
    }
    if (include.tasks) {
      copy.tasks = store.Task.filter((t) => t.clientId === row.id);
    }
    if (include.websites) {
      copy.websites = store.Website.filter((w) => w.clientId === row.id).map((w) =>
        hydrateRow('Website', w, store, include.websites?.include)
      );
    }
  }

  if (table === 'ProviderAccount' && include._count) {
    copy._count = {
      domains: store.Domain.filter((d) => d.providerAccountId === row.id).length,
      services: store.Service.filter((s) => s.providerAccountId === row.id).length,
    };
  }

  if (table === 'Domain') {
    if (include.client) {
      copy.client = store.Client.find((c) => c.id === row.clientId) ?? null;
    }
    if (include.providerAccount) {
      copy.providerAccount = row.providerAccountId
        ? store.ProviderAccount.find((p) => p.id === row.providerAccountId) ?? null
        : null;
    }
  }

  if (table === 'Service') {
    if (include.client) {
      copy.client = store.Client.find((c) => c.id === row.clientId) ?? null;
    }
    if (include.providerAccount) {
      copy.providerAccount = row.providerAccountId
        ? store.ProviderAccount.find((p) => p.id === row.providerAccountId) ?? null
        : null;
    }
    if (include.domainLinks) {
      const links = store.ServiceDomain.filter((sd) => sd.serviceId === row.id);
      copy.domainLinks = links.map((sd) => ({
        ...sd,
        domain: store.Domain.find((d) => d.id === sd.domainId) ?? null,
      }));
    }
  }

  if (table === 'Estimate') {
    if (include.client) {
      copy.client = store.Client.find((c) => c.id === row.clientId) ?? null;
    }
    if (include.items) {
      copy.items = sortRows(
        store.EstimateItem.filter((it) => it.estimateId === row.id),
        include.items?.orderBy || { sortOrder: 'asc' }
      );
    }
  }

  if (table === 'Invoice') {
    if (include.client) {
      copy.client = store.Client.find((c) => c.id === row.clientId) ?? null;
    }
    if (include.items) {
      copy.items = sortRows(
        store.InvoiceItem.filter((it) => it.invoiceId === row.id),
        include.items?.orderBy || { sortOrder: 'asc' }
      ).map((it) => hydrateRow('InvoiceItem', it, store, include.items?.include));
    }
    if (include.payments) {
      copy.payments = sortRows(
        store.Payment.filter((p) => p.invoiceId === row.id),
        include.payments?.orderBy || { paidAt: 'desc' }
      );
    }
    if (include.creditNotes) {
      copy.creditNotes = sortRows(
        store.CreditNote.filter((cn) => cn.invoiceId === row.id),
        include.creditNotes?.orderBy || { issuedAt: 'desc' }
      );
    }
  }

  if (table === 'InvoiceItem') {
    if (include.domain) {
      copy.domain = row.domainId ? store.Domain.find((d) => d.id === row.domainId) ?? null : null;
    }
    if (include.service) {
      copy.service = row.serviceId ? store.Service.find((s) => s.id === row.serviceId) ?? null : null;
    }
  }

  if (table === 'Payment') {
    if (include.client) {
      copy.client = store.Client.find((c) => c.id === row.clientId) ?? null;
    }
    if (include.invoice) {
      const inv = store.Invoice.find((i) => i.id === row.invoiceId) ?? null;
      copy.invoice = inv ? hydrateRow('Invoice', inv, store, include.invoice?.include) : null;
    }
  }

  if (table === 'CreditNote') {
    if (include.client) {
      copy.client = store.Client.find((c) => c.id === row.clientId) ?? null;
    }
    if (include.invoice) {
      const inv = store.Invoice.find((i) => i.id === row.invoiceId) ?? null;
      copy.invoice = inv ? hydrateRow('Invoice', inv, store, include.invoice?.include) : null;
    }
  }

  if (table === 'Expense') {
    if (include.client) {
      copy.client = row.clientId ? store.Client.find((c) => c.id === row.clientId) ?? null : null;
    }
    if (include.domain) {
      copy.domain = row.domainId ? store.Domain.find((d) => d.id === row.domainId) ?? null : null;
    }
    if (include.service) {
      copy.service = row.serviceId ? store.Service.find((s) => s.id === row.serviceId) ?? null : null;
    }
  }

  if (table === 'ReminderRule') {
    if (include.template) {
      copy.template = row.templateId
        ? store.MessageTemplate.find((t) => t.id === row.templateId) ?? null
        : null;
    }
  }

  if (table === 'MessageTemplate') {
    if (include.rules) {
      copy.rules = store.ReminderRule.filter((r) => r.templateId === row.id);
    }
    if (include.logs) {
      copy.logs = store.MessageLog.filter((l) => l.templateId === row.id);
    }
  }

  if (table === 'MessageLog') {
    if (include.client) {
      copy.client = row.clientId ? store.Client.find((c) => c.id === row.clientId) ?? null : null;
    }
    if (include.template) {
      copy.template = row.templateId
        ? store.MessageTemplate.find((t) => t.id === row.templateId) ?? null
        : null;
    }
  }

  if (table === 'Website') {
    if (include.client) {
      copy.client = store.Client.find((c) => c.id === row.clientId) ?? null;
    }
    if (include.domain) {
      copy.domain = row.domainId ? store.Domain.find((d) => d.id === row.domainId) ?? null : null;
    }
    if (include.checks) {
      let checks = store.UptimeCheck.filter((c) => c.websiteId === row.id);
      if (include.checks?.where) {
        checks = checks.filter((c) => matchesWhere(c, include.checks.where));
      }
      checks = sortRows(checks, include.checks?.orderBy || { checkedAt: 'desc' });
      if (typeof include.checks?.take === 'number') {
        checks = checks.slice(0, include.checks.take);
      }
      copy.checks = checks;
    }
    if (include.incidents) {
      let incidents = store.Incident.filter((i) => i.websiteId === row.id);
      if (include.incidents?.where) {
        incidents = incidents.filter((i) => matchesWhere(i, include.incidents.where));
      }
      incidents = sortRows(incidents, include.incidents?.orderBy || { startedAt: 'desc' });
      if (typeof include.incidents?.take === 'number') {
        incidents = incidents.slice(0, include.incidents.take);
      }
      copy.incidents = incidents;
    }
  }

  if (table === 'UptimeCheck') {
    if (include.website) {
      copy.website = store.Website.find((w) => w.id === row.websiteId) ?? null;
    }
  }

  if (table === 'Incident') {
    if (include.website) {
      copy.website = store.Website.find((w) => w.id === row.websiteId) ?? null;
    }
  }

  return copy;
}

const TABLES_WITHOUT_UPDATED_AT = new Set<keyof StoreData>([
  'Session',
  'AuditLog',
  'ServiceDomain',
  'EstimateItem',
  'InvoiceItem',
  'CreditNote',
  'UptimeCheck',
  'Incident',
]);

const TABLES_WITHOUT_CREATED_AT = new Set<keyof StoreData>([
  'Settings',
  'JobState',
  'ServiceDomain',
  'EstimateItem',
  'InvoiceItem',
]);

export function createPreviewPrismaClient(): any {
  let store = loadStore();

  const makeModel = (table: keyof StoreData, pk: string = 'id') => ({
    async findMany(args: RecordRow = {}) {
      store = loadStore();
      let rows = store[table].filter((r) => matchesWhere(r, args.where));
      rows = sortRows(rows, args.orderBy);
      if (typeof args.skip === 'number') rows = rows.slice(args.skip);
      if (typeof args.take === 'number') rows = rows.slice(0, args.take);
      return rows.map((r) => hydrateRow(table, r, store, args.include));
    },

    async findFirst(args: RecordRow = {}) {
      const rows = await this.findMany({ ...args, take: 1 });
      return rows[0] ?? null;
    },

    async findUnique(args: RecordRow = {}) {
      store = loadStore();
      const row = store[table].find((r) => matchesWhere(r, args.where)) ?? null;
      return row ? hydrateRow(table, row, store, args.include) : null;
    },

    async count(args: RecordRow = {}) {
      store = loadStore();
      return store[table].filter((r) => matchesWhere(r, args.where)).length;
    },

    async create(args: RecordRow) {
      store = loadStore();
      const now = new Date();
      const data = { ...args.data };
      if (pk === 'id' && !data.id) {
        data.id = crypto.randomUUID().replace(/-/g, '').slice(0, 25);
      }
      if (!data.createdAt && !TABLES_WITHOUT_CREATED_AT.has(table)) {
        data.createdAt = now;
      }
      if (!data.updatedAt && !TABLES_WITHOUT_UPDATED_AT.has(table)) {
        data.updatedAt = now;
      }

      if (table === 'Service' && data.domainLinks?.create) {
        const links = Array.isArray(data.domainLinks.create) ? data.domainLinks.create : [data.domainLinks.create];
        for (const l of links) {
          store.ServiceDomain.push({ serviceId: data.id, domainId: l.domainId });
        }
        delete data.domainLinks;
      }

      if (table === 'Estimate' && data.items?.create) {
        const items = Array.isArray(data.items.create) ? data.items.create : [data.items.create];
        items.forEach((it: any, idx: number) => {
          store.EstimateItem.push({
            id: crypto.randomUUID().replace(/-/g, '').slice(0, 25),
            estimateId: data.id,
            sortOrder: it.sortOrder ?? idx,
            ...it,
          });
        });
        delete data.items;
      }

      if (table === 'Invoice' && data.items?.create) {
        const items = Array.isArray(data.items.create) ? data.items.create : [data.items.create];
        items.forEach((it: any, idx: number) => {
          store.InvoiceItem.push({
            id: crypto.randomUUID().replace(/-/g, '').slice(0, 25),
            invoiceId: data.id,
            sortOrder: it.sortOrder ?? idx,
            ...it,
          });
        });
        delete data.items;
      }

      store[table].push(data);
      saveStore(store);
      return hydrateRow(table, data, store, args.include);
    },

    async update(args: RecordRow) {
      store = loadStore();
      const idx = store[table].findIndex((r) => matchesWhere(r, args.where));
      if (idx === -1) {
        throw new Error(`Record not found in ${table}`);
      }
      const data = { ...args.data };

      if (table === 'Service' && data.domainLinks) {
        const serviceId = store[table][idx].id;
        if (data.domainLinks.deleteMany !== undefined) {
          store.ServiceDomain = store.ServiceDomain.filter((sd) => sd.serviceId !== serviceId);
        }
        if (data.domainLinks.create) {
          const links = Array.isArray(data.domainLinks.create) ? data.domainLinks.create : [data.domainLinks.create];
          for (const l of links) {
            store.ServiceDomain.push({ serviceId, domainId: l.domainId });
          }
        }
        delete data.domainLinks;
      }

      if (table === 'Estimate' && data.items) {
        const estimateId = store[table][idx].id;
        if (data.items.deleteMany !== undefined) {
          store.EstimateItem = store.EstimateItem.filter((it) => it.estimateId !== estimateId);
        }
        if (data.items.create) {
          const items = Array.isArray(data.items.create) ? data.items.create : [data.items.create];
          items.forEach((it: any, i: number) => {
            store.EstimateItem.push({
              id: crypto.randomUUID().replace(/-/g, '').slice(0, 25),
              estimateId,
              sortOrder: it.sortOrder ?? i,
              ...it,
            });
          });
        }
        delete data.items;
      }

      if (table === 'Invoice' && data.items) {
        const invoiceId = store[table][idx].id;
        if (data.items.deleteMany !== undefined) {
          store.InvoiceItem = store.InvoiceItem.filter((it) => it.invoiceId !== invoiceId);
        }
        if (data.items.create) {
          const items = Array.isArray(data.items.create) ? data.items.create : [data.items.create];
          items.forEach((it: any, i: number) => {
            store.InvoiceItem.push({
              id: crypto.randomUUID().replace(/-/g, '').slice(0, 25),
              invoiceId,
              sortOrder: it.sortOrder ?? i,
              ...it,
            });
          });
        }
        delete data.items;
      }

      const updated = {
        ...store[table][idx],
        ...data,
        ...(!TABLES_WITHOUT_UPDATED_AT.has(table) ? { updatedAt: new Date() } : {}),
      };
      store[table][idx] = updated;
      saveStore(store);
      return hydrateRow(table, updated, store, args.include);
    },

    async updateMany(args: RecordRow) {
      store = loadStore();
      let count = 0;
      store[table] = store[table].map((r) => {
        if (matchesWhere(r, args.where)) {
          count += 1;
          return {
            ...r,
            ...args.data,
            ...(!TABLES_WITHOUT_UPDATED_AT.has(table) ? { updatedAt: new Date() } : {}),
          };
        }
        return r;
      });
      saveStore(store);
      return { count };
    },

    async upsert(args: RecordRow) {
      const existing = await this.findUnique({ where: args.where });
      if (existing) {
        return this.update({ where: args.where, data: args.update, include: args.include });
      }
      return this.create({ data: args.create, include: args.include });
    },

    async delete(args: RecordRow) {
      store = loadStore();
      const idx = store[table].findIndex((r) => matchesWhere(r, args.where));
      if (idx === -1) throw new Error(`Record not found in ${table}`);
      const [removed] = store[table].splice(idx, 1);

      if (table === 'Client') {
        const removedDomains = store.Domain.filter((d) => d.clientId === removed.id).map((d) => d.id);
        const removedServices = store.Service.filter((s) => s.clientId === removed.id).map((s) => s.id);
        const removedEstimates = store.Estimate.filter((e) => e.clientId === removed.id).map((e) => e.id);
        const removedInvoices = store.Invoice.filter((i) => i.clientId === removed.id).map((i) => i.id);
        store.Domain = store.Domain.filter((d) => d.clientId !== removed.id);
        store.Service = store.Service.filter((s) => s.clientId !== removed.id);
        store.ServiceDomain = store.ServiceDomain.filter(
          (sd) => !removedDomains.includes(sd.domainId) && !removedServices.includes(sd.serviceId)
        );
        store.Estimate = store.Estimate.filter((e) => e.clientId !== removed.id);
        store.EstimateItem = store.EstimateItem.filter((it) => !removedEstimates.includes(it.estimateId));
        store.Invoice = store.Invoice.filter((i) => i.clientId !== removed.id);
        store.InvoiceItem = store.InvoiceItem.filter((it) => !removedInvoices.includes(it.invoiceId));
        store.Payment = store.Payment.filter((p) => p.clientId !== removed.id);
        store.CreditNote = store.CreditNote.filter((cn) => cn.clientId !== removed.id);
        store.Expense = store.Expense.filter((ex) => ex.clientId !== removed.id);
        const removedWebsites = store.Website.filter((w) => w.clientId === removed.id).map((w) => w.id);
        store.Website = store.Website.filter((w) => w.clientId !== removed.id);
        store.UptimeCheck = store.UptimeCheck.filter((c) => !removedWebsites.includes(c.websiteId));
        store.Incident = store.Incident.filter((i) => !removedWebsites.includes(i.websiteId));
      } else if (table === 'Domain') {
        store.ServiceDomain = store.ServiceDomain.filter((sd) => sd.domainId !== removed.id);
        store.Website = store.Website.map((w) => (w.domainId === removed.id ? { ...w, domainId: null } : w));
      } else if (table === 'Service') {
        store.ServiceDomain = store.ServiceDomain.filter((sd) => sd.serviceId !== removed.id);
      } else if (table === 'Website') {
        store.UptimeCheck = store.UptimeCheck.filter((c) => c.websiteId !== removed.id);
        store.Incident = store.Incident.filter((i) => i.websiteId !== removed.id);
      } else if (table === 'Estimate') {
        store.EstimateItem = store.EstimateItem.filter((it) => it.estimateId !== removed.id);
      } else if (table === 'Invoice') {
        store.InvoiceItem = store.InvoiceItem.filter((it) => it.invoiceId !== removed.id);
        store.Payment = store.Payment.filter((p) => p.invoiceId !== removed.id);
        store.CreditNote = store.CreditNote.filter((cn) => cn.invoiceId !== removed.id);
      } else if (table === 'MessageTemplate') {
        store.ReminderRule = store.ReminderRule.map((r) =>
          r.templateId === removed.id ? { ...r, templateId: null } : r
        );
        store.MessageLog = store.MessageLog.map((l) =>
          l.templateId === removed.id ? { ...l, templateId: null } : l
        );
      }

      saveStore(store);
      return removed;
    },

    async deleteMany(args: RecordRow = {}) {
      store = loadStore();
      const before = store[table].length;
      store[table] = store[table].filter((r) => !matchesWhere(r, args.where));
      const count = before - store[table].length;
      saveStore(store);
      return { count };
    },
  });

  const client: any = {
    user: makeModel('User'),
    session: makeModel('Session'),
    client: makeModel('Client'),
    providerAccount: makeModel('ProviderAccount'),
    domain: makeModel('Domain'),
    service: makeModel('Service'),
    serviceDomain: makeModel('ServiceDomain', 'serviceId_domainId'),
    website: makeModel('Website'),
    uptimeCheck: makeModel('UptimeCheck'),
    incident: makeModel('Incident'),
    catalogItem: makeModel('CatalogItem'),
    estimate: makeModel('Estimate'),
    estimateItem: makeModel('EstimateItem'),
    invoice: makeModel('Invoice'),
    invoiceItem: makeModel('InvoiceItem'),
    payment: makeModel('Payment'),
    creditNote: makeModel('CreditNote'),
    expense: makeModel('Expense'),
    messageLog: makeModel('MessageLog'),
    reminderRule: makeModel('ReminderRule'),
    messageTemplate: makeModel('MessageTemplate'),
    settings: makeModel('Settings'),
    jobState: makeModel('JobState', 'jobName'),
    auditLog: makeModel('AuditLog'),
    task: makeModel('Task'),
    async $queryRaw() {
      return [{ ok: 1 }];
    },
    async $transaction(fnOrArray: any) {
      if (typeof fnOrArray === 'function') {
        return fnOrArray(client);
      }
      if (Array.isArray(fnOrArray)) {
        return Promise.all(fnOrArray);
      }
    },
    async $disconnect() {},
  };

  return client;
}
