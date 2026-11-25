export type PreferredChannel = 'EMAIL' | 'WHATSAPP' | 'BOTH';
export type ClientStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ProviderKey = 'HOSTINGER' | 'GODADDY' | 'REDIFF' | 'SPACESHIP' | 'CLOUDFLARE' | 'OTHER';
export type ProviderType = 'REGISTRAR' | 'HOST' | 'BOTH';
export type DomainStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'REDEMPTION' | 'TRANSFERRED';
export type WhoPays = 'CLIENT' | 'ME';
export type ServiceType = 'HOSTING' | 'EMAIL_HOSTING' | 'SSL' | 'MAINTENANCE_AMC' | 'CDN' | 'OTHER';
export type BillingCycle = 'MONTHLY' | 'QUARTERLY' | 'YEARLY' | 'MULTI_YEAR';
export type ServiceStatus = 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED';

export interface AuthUserDTO {
  id: string;
  email: string;
  name: string;
  totpEnabled: boolean;
  lastLoginAt: string | null;
}

export interface ClientDTO {
  id: string;
  name: string;
  company: string | null;
  contactPerson: string | null;
  emails: string[];
  whatsappPhone: string | null;
  secondaryPhones: string[];
  address: string | null;
  state: string | null;
  gstin: string | null;
  notes: string | null;
  preferredChannel: PreferredChannel;
  remindersEnabled: boolean;
  status: ClientStatus;
  tags: string[];
  publicStatusToken: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    domains: number;
    services: number;
    invoices?: number;
  };
}

export interface ProviderAccountDTO {
  id: string;
  name: string;
  providerKey: ProviderKey;
  type: ProviderType;
  loginEmail: string | null;
  accountUrl: string | null;
  notes: string | null;
  hasApiCredentials: boolean;
  apiCredentialsMask: string | null;
  apiSyncEnabled: boolean;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    domains: number;
    services: number;
  };
}

export interface DomainDTO {
  id: string;
  name: string;
  clientId: string;
  providerAccountId: string | null;
  registeredOn: string | null;
  expiryDate: string;
  autoRenew: boolean;
  nameservers: string[];
  dnsProvider: string | null;
  whoisPrivacy: boolean;
  costPrice: number;
  sellingPrice: number;
  renewalYears: number;
  status: DomainStatus;
  notes: string | null;
  lastRdapVerifiedAt: string | null;
  rdapExpiryDate: string | null;
  rdapMismatch: boolean;
  rdapUnsupported: boolean;
  whoPays: WhoPays;
  sslExpiryDate: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string; company: string | null };
  providerAccount?: { id: string; name: string; providerKey: ProviderKey } | null;
}

export interface ServiceDTO {
  id: string;
  type: ServiceType;
  providerAccountId: string | null;
  planName: string;
  clientId: string;
  startDate: string | null;
  renewalDate: string;
  billingCycle: BillingCycle;
  costPrice: number;
  sellingPrice: number;
  autoRenew: boolean;
  status: ServiceStatus;
  notes: string | null;
  isDemo: boolean;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string; company: string | null };
  providerAccount?: { id: string; name: string; providerKey: ProviderKey } | null;
  linkedDomains?: { id: string; name: string }[];
}

export interface SettingsDTO {
  businessName: string;
  businessState: string;
  address: string | null;
  gstin: string | null;
  pan: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankAccountName: string | null;
  upiId: string | null;
  logoDataUrl: string | null;
  invoicePrefix: string;
  estimatePrefix: string;
  receiptPrefix: string;
  defaultTaxRate: number;
  gstEnabled: boolean;
  defaultInvoiceTerms: string | null;
  defaultEstimateTerms: string | null;
  currency: string;
  timezone: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string | null;
  hasSmtpPass: boolean;
  smtpFromName: string;
  smtpFromEmail: string | null;
  emailProvider: string;
  hasEmailApiKey: boolean;
  whatsappPhoneNumberId: string | null;
  whatsappBusinessAccountId: string | null;
  hasWhatsappAccessToken: boolean;
  hasWhatsappVerifyToken: boolean;
  hasWhatsappAppSecret: boolean;
  ownerAlertEmail: string | null;
  ownerAlertWhatsapp: string | null;
  quietHoursStart: string;
  quietHoursEnd: string;
  reminderEvalHourIst: number;
  dryRunMode: boolean;
  recurringAutoSend: boolean;
  razorpayEnabled: boolean;
  razorpayKeyId: string | null;
  hasRazorpaySecret: boolean;
}

export interface DashboardSummaryDTO {
  counts: {
    domainsExpiring7: number;
    domainsExpiring30: number;
    domainsExpiring60: number;
    expiredItems: number;
    servicesRenewingThisMonth: number;
    totalClients: number;
    totalDomains: number;
    totalServices: number;
    unpaidInvoicesTotal: number;
    revenueThisMonth: number;
    revenueThisFy: number;
    sitesDownCount: number;
    uptime30dAvg: number | null;
  };
  forecast90Days: {
    domainRevenue: number;
    domainCost: number;
    serviceRevenue: number;
    serviceCost: number;
    totalRevenue: number;
    totalProfit: number;
    itemsCount: number;
  };
  actionNeededToday: Array<{
    id: string;
    kind: 'DOMAIN' | 'SERVICE' | 'TASK' | 'INVOICE';
    title: string;
    subtitle: string;
    clientId?: string;
    clientName?: string;
    dueDate: string;
    daysLeft: number;
    urgency: 'red' | 'orange' | 'yellow' | 'green';
    amount?: number;
  }>;
  upcomingCalendar: Array<{
    id: string;
    kind: 'DOMAIN' | 'SERVICE';
    name: string;
    clientId: string;
    clientName: string;
    date: string;
    daysLeft: number;
    urgency: 'red' | 'orange' | 'yellow' | 'green';
    sellingPrice: number;
    costPrice: number;
    autoRenew: boolean;
    providerName: string | null;
  }>;
  jobStates: Array<{
    jobName: string;
    lastRunAt: string | null;
    lastSuccessAt: string | null;
    lastStatus: string | null;
    lastSummary: string | null;
  }>;
}

export type GstMode = 'CGST_SGST' | 'IGST' | 'NONE';
export type EstimateStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
export type InvoiceStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'PARTIALLY_PAID' | 'PAID' | 'OVERDUE' | 'CANCELLED';
export type PaymentMethod = 'UPI' | 'BANK' | 'CASH' | 'RAZORPAY' | 'OTHER';

export interface CatalogItemDTO {
  id: string;
  name: string;
  description: string | null;
  hsnSac: string | null;
  defaultRate: number;
  taxPercent: number;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentLineItemDTO {
  id?: string;
  itemName?: string | null;
  description: string;
  hsnSac: string | null;
  qty: number;
  rate: number;
  discount: number;
  taxPercent: number;
  lineTotal: number;
  domainId?: string | null;
  serviceId?: string | null;
  sortOrder?: number;
}

export interface EstimateDTO {
  id: string;
  estimateNumber: string;
  zohoEstimateId?: string | null;
  clientId: string;
  referenceNumber: string | null;
  projectName: string | null;
  placeOfSupply: string | null;
  issueDate: string;
  validUntil: string;
  gstMode: GstMode;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  roundOff: number;
  adjustmentLabel: string | null;
  total: number;
  notes: string | null;
  terms: string | null;
  status: EstimateStatus;
  publicToken: string;
  clientComment: string | null;
  convertedInvoiceId: string | null;
  viewedAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
  client?: {
    id: string;
    name: string;
    company: string | null;
    state: string | null;
    gstin: string | null;
    emails: string[];
    whatsappPhone: string | null;
    address: string | null;
  };
  items: DocumentLineItemDTO[];
}

export interface PaymentDTO {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  clientId: string;
  paidAt: string;
  amount: number;
  method: PaymentMethod;
  referenceUtr: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string; company: string | null };
  invoice?: { id: string; invoiceNumber: string; total: number; amountPaid: number; status: InvoiceStatus };
}

export interface CreditNoteDTO {
  id: string;
  creditNoteNumber: string;
  invoiceId: string;
  clientId: string;
  issuedAt: string;
  amount: number;
  reason: string | null;
  createdAt: string;
  client?: { id: string; name: string; company: string | null };
  invoice?: { id: string; invoiceNumber: string };
}

export interface InvoiceDTO {
  id: string;
  invoiceNumber: string;
  financialYear: string;
  clientId: string;
  referenceNumber: string | null;
  projectName: string | null;
  placeOfSupply: string | null;
  issueDate: string;
  dueDate: string;
  gstMode: GstMode;
  subtotal: number;
  discountTotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  taxTotal: number;
  roundOff: number;
  adjustmentLabel: string | null;
  total: number;
  amountPaid: number;
  balanceDue: number;
  status: InvoiceStatus;
  notes: string | null;
  terms: string | null;
  publicToken: string;
  viewedAt: string | null;
  recurring: boolean;
  recurringCycle: BillingCycle | null;
  nextRecurringAt: string | null;
  razorpayOrderId: string | null;
  razorpayLinkUrl: string | null;
  createdAt: string;
  updatedAt: string;
  upiUri?: string | null;
  upiQrDataUrl?: string | null;
  client?: {
    id: string;
    name: string;
    company: string | null;
    state: string | null;
    gstin: string | null;
    emails: string[];
    whatsappPhone: string | null;
    address: string | null;
  };
  items: DocumentLineItemDTO[];
  payments?: PaymentDTO[];
  creditNotes?: CreditNoteDTO[];
}

export interface ExpenseDTO {
  id: string;
  date: string;
  category: string;
  vendor: string;
  amount: number;
  notes: string | null;
  clientId: string | null;
  domainId: string | null;
  serviceId: string | null;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string } | null;
}

export interface ReportsSummaryDTO {
  range: { from: string; to: string };
  totals: {
    billedTotal: number;
    taxableTotal: number;
    taxTotal: number;
    cgstTotal: number;
    sgstTotal: number;
    igstTotal: number;
    collectedTotal: number;
    outstandingTotal: number;
    expensesTotal: number;
    estimatedRenewalProfit90d: number;
  };
  salesRegister: Array<{
    id: string;
    invoiceNumber: string;
    issueDate: string;
    dueDate: string;
    clientId: string;
    clientName: string;
    clientGstin: string | null;
    placeOfSupply: string | null;
    gstMode: GstMode;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    total: number;
    amountPaid: number;
    balanceDue: number;
    status: InvoiceStatus;
  }>;
  gstMonthly: Array<{
    monthKey: string;
    monthLabel: string;
    invoiceCount: number;
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    totalTax: number;
    invoiceTotal: number;
  }>;
  agingBuckets: {
    current: { count: number; amount: number };
    days0to30: { count: number; amount: number };
    days31to60: { count: number; amount: number };
    days61Plus: { count: number; amount: number };
    items: Array<{
      id: string;
      invoiceNumber: string;
      clientId: string;
      clientName: string;
      dueDate: string;
      daysOverdue: number;
      bucket: 'CURRENT' | '0-30' | '31-60' | '61+';
      balanceDue: number;
      status: InvoiceStatus;
    }>;
  };
  renewalProfitItems: Array<{
    kind: 'DOMAIN' | 'SERVICE';
    id: string;
    name: string;
    clientName: string;
    renewalDate: string;
    costPrice: number;
    sellingPrice: number;
    profit: number;
  }>;
}

export type ReminderItemType = 'DOMAIN' | 'SERVICE' | 'INVOICE' | 'ESTIMATE' | 'UPTIME';
export type MessageChannel = 'EMAIL' | 'WHATSAPP';
export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'SKIPPED';

export interface ReminderRuleDTO {
  id: string;
  name: string;
  itemType: ReminderItemType;
  offsets: number[];
  channels: MessageChannel[];
  templateId: string | null;
  templateName: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MessageTemplateDTO {
  id: string;
  slug: string;
  name: string;
  language: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  waTemplateName: string | null;
  waLanguageCode: string | null;
  waVariableMapping: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MessageLogDTO {
  id: string;
  clientId: string | null;
  clientName: string | null;
  clientPhone?: string | null;
  channel: MessageChannel;
  templateId: string | null;
  templateName: string | null;
  renderedSubject: string | null;
  renderedContent: string;
  entityType: string | null;
  entityId: string | null;
  offsetDays: number | null;
  idempotencyKey: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  status: MessageStatus;
  providerMessageId: string | null;
  error: string | null;
  retryCount: number;
  nextRetryAt: string | null;
  direction: string;
  createdAt: string;
  updatedAt: string;
}

export interface UptimeCheckDTO {
  id: string;
  websiteId: string;
  checkedAt: string;
  up: boolean;
  httpCode: number | null;
  responseMs: number | null;
  error: string | null;
}

export interface IncidentDTO {
  id: string;
  websiteId: string;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  notifiedOwner: boolean;
  notifiedClient: boolean;
  errorSummary: string | null;
}

export interface WebsiteDTO {
  id: string;
  url: string;
  label: string | null;
  clientId: string;
  domainId: string | null;
  intervalMinutes: number;
  expectedStatusCode: number;
  requiredKeyword: string | null;
  timeoutMs: number;
  failureThreshold: number;
  consecutiveFailures: number;
  isDown: boolean;
  alertContacts: string[];
  notifyClient: boolean;
  paused: boolean;
  sslExpiry: string | null;
  lastCheckedAt: string | null;
  lastResponseMs: number | null;
  publicStatusToken: string | null;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; name: string; company: string | null };
  domain?: { id: string; name: string } | null;
  uptime24h?: number | null;
  uptime30d?: number | null;
  recentChecks?: UptimeCheckDTO[];
  incidents?: IncidentDTO[];
  openIncident?: IncidentDTO | null;
}

export interface PublicStatusDTO {
  business: {
    businessName: string;
    logoDataUrl: string | null;
    email: string | null;
  };
  scope: 'WEBSITE' | 'CLIENT';
  title: string;
  subtitle: string | null;
  overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'PAUSED';
  generatedAt: string;
  websites: Array<{
    id: string;
    label: string;
    url: string;
    status: 'UP' | 'DOWN' | 'PAUSED' | 'PENDING';
    lastCheckedAt: string | null;
    lastResponseMs: number | null;
    sslExpiry: string | null;
    uptime24h: number | null;
    uptime30d: number | null;
    recentChecks: Array<{
      checkedAt: string;
      up: boolean;
      responseMs: number | null;
    }>;
  }>;
  incidents: Array<{
    id: string;
    websiteLabel: string;
    startedAt: string;
    endedAt: string | null;
    durationSeconds: number | null;
    status: 'OPEN' | 'RESOLVED';
  }>;
}

