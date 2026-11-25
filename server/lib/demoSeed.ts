import { PrismaClient } from '@prisma/client';
import { generateRandomToken } from './crypto';
import { computeAutoExpiryStatus } from '../../shared/dates';

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export async function ensureDefaultSettings(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing) return;

  await prisma.settings.create({
    data: {
      id: 1,
      businessName: 'Aligarh Web Solutions',
      businessState: 'Uttar Pradesh',
      address: 'Civil Lines, Aligarh, Uttar Pradesh 202001',
      bankName: 'Axis Bank',
      bankAccountName: 'Aligarh Web Solutions',
      bankAccountNumber: '918020006575926',
      bankIfsc: 'UTIB0003686',
      invoicePrefix: 'INV',
      estimatePrefix: 'EST',
      receiptPrefix: 'RCPT',
      defaultTaxRate: 18,
      gstEnabled: true,
      defaultInvoiceTerms:
        '1. Payment due within 7 days of invoice date.\n2. Domain and hosting renewals are processed only after payment confirmation.\n3. Subject to Aligarh jurisdiction.',
      defaultEstimateTerms:
        "Subject to Terms and Conditions: http://aligarhwebsolutions.com/new/terms-and-conditions/\nWe value our customer's privacy and data secrecy the most. We NEVER disclose, sell or transfer any customer data to others.",
      currency: 'INR',
      timezone: 'Asia/Kolkata',
      smtpHost: process.env.SMTP_HOST || 'smtp.hostinger.com',
      smtpPort: Number(process.env.SMTP_PORT || 465),
      smtpSecure: (process.env.SMTP_SECURE || 'true') === 'true',
      smtpUser: process.env.SMTP_USER || null,
      smtpFromName: process.env.SMTP_FROM_NAME || 'Aligarh Web Solutions',
      smtpFromEmail: process.env.SMTP_FROM_EMAIL || null,
      quietHoursStart: '20:00',
      quietHoursEnd: '09:00',
      reminderEvalHourIst: 6,
      dryRunMode: false,
    },
  });
}

export async function ensureDefaultRulesAndTemplates(prisma: PrismaClient): Promise<void> {
  const tplCount = await prisma.messageTemplate.count();
  if (tplCount === 0) {
    const templates = [
      {
        slug: 'domain-renewal-en',
        name: 'Domain Renewal Reminder (English)',
        language: 'en',
        channel: 'EMAIL' as const,
        subject: 'Domain Renewal Due: {{domain}} expires in {{days_left}} days',
        body: 'Hello {{client_name}},\n\nThis is a reminder from {{business_name}} that your domain {{domain}} is due for renewal on {{expiry_date}} ({{days_left}} days remaining).\n\nRenewal Amount: {{amount}}\nPay / View Details: {{pay_link}}\n\nPlease confirm at your earliest convenience so there is no interruption to your website or email.\n\nRegards,\n{{business_name}}',
      },
      {
        slug: 'domain-renewal-hi',
        name: 'Domain Renewal Reminder (Hindi)',
        language: 'hi',
        channel: 'WHATSAPP' as const,
        subject: null,
        body: 'नमस्ते {{client_name}}, आपका डोमेन {{domain}} तारीख {{expiry_date}} को समाप्त हो रहा है ({{days_left}} दिन शेष)। नवीनीकरण शुल्क: {{amount}}। भुगतान लिंक: {{pay_link}} — {{business_name}}',
        waTemplateName: 'domain_renewal_hi',
        waLanguageCode: 'hi',
        waVariableMapping: ['client_name', 'domain', 'expiry_date', 'days_left', 'amount', 'pay_link', 'business_name'],
      },
      {
        slug: 'hosting-renewal-en',
        name: 'Hosting / Service Renewal (English)',
        language: 'en',
        channel: 'EMAIL' as const,
        subject: 'Service Renewal Due: {{domain}} on {{expiry_date}}',
        body: 'Hello {{client_name}},\n\nYour hosting/maintenance plan for {{domain}} is scheduled for renewal on {{expiry_date}}.\n\nAmount: {{amount}}\nPay Link: {{pay_link}}\n\nRegards,\n{{business_name}}',
      },
      {
        slug: 'invoice-sent-en',
        name: 'Invoice Sent (English)',
        language: 'en',
        channel: 'EMAIL' as const,
        subject: 'Invoice {{invoice_no}} from {{business_name}}',
        body: 'Hello {{client_name}},\n\nPlease find attached Invoice {{invoice_no}} for {{amount}}.\n\nView & Pay Online: {{pay_link}}\n\nThank you for your business.\n{{business_name}}',
      },
      {
        slug: 'payment-reminder-en',
        name: 'Payment Reminder (English)',
        language: 'en',
        channel: 'EMAIL' as const,
        subject: 'Friendly Reminder: Invoice {{invoice_no}} ({{amount}})',
        body: 'Hello {{client_name}},\n\nA gentle reminder regarding Invoice {{invoice_no}} for {{amount}} due on {{expiry_date}}.\n\nPay Link: {{pay_link}}\n\nRegards,\n{{business_name}}',
      },
      {
        slug: 'overdue-notice-en',
        name: 'Overdue Notice (English)',
        language: 'en',
        channel: 'EMAIL' as const,
        subject: 'Overdue Payment Notice: Invoice {{invoice_no}}',
        body: 'Hello {{client_name}},\n\nInvoice {{invoice_no}} for {{amount}} is now overdue. Please clear the balance at the earliest via {{pay_link}} to avoid service interruption.\n\nRegards,\n{{business_name}}',
      },
      {
        slug: 'payment-received-en',
        name: 'Payment Received Receipt (English)',
        language: 'en',
        channel: 'EMAIL' as const,
        subject: 'Payment Received — Thank you ({{invoice_no}})',
        body: 'Hello {{client_name}},\n\nWe have received your payment of {{amount}} for Invoice {{invoice_no}}. Thank you!\n\nReceipt Link: {{pay_link}}\n\nRegards,\n{{business_name}}',
      },
      {
        slug: 'estimate-sent-en',
        name: 'Estimate Sent (English)',
        language: 'en',
        channel: 'EMAIL' as const,
        subject: 'Estimate {{invoice_no}} from {{business_name}}',
        body: 'Hello {{client_name}},\n\nPlease review Estimate {{invoice_no}} for {{amount}} here: {{pay_link}}\n\nYou can approve or request changes directly from the link.\n\nRegards,\n{{business_name}}',
      },
      {
        slug: 'site-down-en',
        name: 'Website Down Alert (English)',
        language: 'en',
        channel: 'EMAIL' as const,
        subject: 'Alert: {{domain}} is currently unreachable',
        body: 'Hello {{client_name}},\n\nOur uptime monitor detected that {{domain}} is currently unreachable. We are investigating and will update you once recovered.\n\nRegards,\n{{business_name}}',
      },
      {
        slug: 'welcome-client-en',
        name: 'Client Welcome (English)',
        language: 'en',
        channel: 'EMAIL' as const,
        subject: 'Welcome to {{business_name}}',
        body: 'Hello {{client_name}},\n\nWelcome to {{business_name}}! We are delighted to manage your web presence and digital infrastructure. Reach us anytime for support.\n\nRegards,\n{{business_name}}',
      },
    ];

    for (const t of templates) {
      await prisma.messageTemplate.create({ data: t as any });
    }
  }

  const ruleCount = await prisma.reminderRule.count();
  if (ruleCount === 0) {
    const domainTpl = await prisma.messageTemplate.findUnique({ where: { slug: 'domain-renewal-en' } });
    const hostingTpl = await prisma.messageTemplate.findUnique({ where: { slug: 'hosting-renewal-en' } });
    const payTpl = await prisma.messageTemplate.findUnique({ where: { slug: 'payment-reminder-en' } });

    await prisma.reminderRule.create({
      data: {
        name: 'Standard Domain Renewal Cadence',
        itemType: 'DOMAIN',
        offsets: [60, 30, 15, 7, 3, 1, 0, -1, -3, -7],
        channels: ['EMAIL', 'WHATSAPP'],
        templateId: domainTpl?.id ?? null,
        enabled: true,
      },
    });
    await prisma.reminderRule.create({
      data: {
        name: 'Standard Hosting & AMC Renewal Cadence',
        itemType: 'SERVICE',
        offsets: [60, 30, 15, 7, 3, 1, 0, -1, -3, -7],
        channels: ['EMAIL', 'WHATSAPP'],
        templateId: hostingTpl?.id ?? null,
        enabled: true,
      },
    });
    await prisma.reminderRule.create({
      data: {
        name: 'Invoice Due & Overdue Follow-up',
        itemType: 'INVOICE',
        offsets: [3, 0, -3, -7, -15],
        channels: ['EMAIL', 'WHATSAPP'],
        templateId: payTpl?.id ?? null,
        enabled: true,
      },
    });
  }
}

export async function seedDemoData(prisma: PrismaClient): Promise<{ clients: number; domains: number; services: number }> {
  await ensureDefaultSettings(prisma);
  await ensureDefaultRulesAndTemplates(prisma);

  const existingDemo = await prisma.client.count({ where: { isDemo: true } });
  if (existingDemo > 0) {
    return { clients: 0, domains: 0, services: 0 };
  }

  const now = new Date();

  const providers = await Promise.all([
    prisma.providerAccount.create({
      data: {
        name: 'Hostinger Business Cloud (AWS)',
        providerKey: 'HOSTINGER',
        type: 'BOTH',
        loginEmail: 'hosting@aligarhwebsolutions.com',
        accountUrl: 'https://hpanel.hostinger.com',
        notes: 'Primary managed Node/PHP cloud reseller account',
        isDemo: true,
      },
    }),
    prisma.providerAccount.create({
      data: {
        name: 'GoDaddy India Reseller',
        providerKey: 'GODADDY',
        type: 'REGISTRAR',
        loginEmail: 'domains@aligarhwebsolutions.com',
        accountUrl: 'https://dcc.godaddy.com',
        notes: 'Legacy .com and .in client domains',
        isDemo: true,
      },
    }),
    prisma.providerAccount.create({
      data: {
        name: 'Spaceship Registrar',
        providerKey: 'SPACESHIP',
        type: 'REGISTRAR',
        loginEmail: 'ops@aligarhwebsolutions.com',
        accountUrl: 'https://www.spaceship.com',
        notes: 'Competitive .com/.org renewals with free WHOIS privacy',
        isDemo: true,
      },
    }),
    prisma.providerAccount.create({
      data: {
        name: 'Cloudflare DNS & Registrar',
        providerKey: 'CLOUDFLARE',
        type: 'BOTH',
        loginEmail: 'dns@aligarhwebsolutions.com',
        accountUrl: 'https://dash.cloudflare.com',
        notes: 'DNS + SSL + at-cost domain renewals',
        isDemo: true,
      },
    }),
    prisma.providerAccount.create({
      data: {
        name: 'Rediffmail Pro Business',
        providerKey: 'REDIFF',
        type: 'HOST',
        loginEmail: 'mailadmin@aligarhwebsolutions.com',
        accountUrl: 'https://businessemail.rediff.com',
        notes: 'Manual tracking only — no API available',
        isDemo: true,
      },
    }),
  ]);

  const [hostinger, godaddy, spaceship, cloudflare, rediff] = providers;

  const clients = await Promise.all([
    prisma.client.create({
      data: {
        name: 'Aligarh Brass Exports',
        company: 'Aligarh Brass Exports Pvt. Ltd.',
        contactPerson: 'Tariq Ahmad',
        emails: ['tariq@aligarhbrass.in', 'accounts@aligarhbrass.in'],
        whatsappPhone: '+919837011223',
        address: 'Industrial Estate, G.T. Road, Aligarh',
        state: 'Uttar Pradesh',
        gstin: '09AABCA4812F1Z5',
        preferredChannel: 'BOTH',
        remindersEnabled: true,
        status: 'ACTIVE',
        tags: ['manufacturing', 'priority'],
        publicStatusToken: generateRandomToken(16),
        notes: 'Long-term export client; prefers invoice before 10th of month.',
        isDemo: true,
      },
    }),
    prisma.client.create({
      data: {
        name: 'Noida Dental Studio',
        company: 'Noida Dental & Implant Care',
        contactPerson: 'Dr. Ritu Sharma',
        emails: ['dr.ritu@noidadentalstudio.com'],
        whatsappPhone: '+919811234567',
        address: 'Sector 62, Noida',
        state: 'Uttar Pradesh',
        preferredChannel: 'WHATSAPP',
        remindersEnabled: true,
        status: 'ACTIVE',
        tags: ['healthcare', 'amc'],
        publicStatusToken: generateRandomToken(16),
        isDemo: true,
      },
    }),
    prisma.client.create({
      data: {
        name: 'Zayka Heritage Caterers',
        company: 'Zayka Hospitality LLP',
        contactPerson: 'Farhan Khan',
        emails: ['farhan@zaykaheritage.in'],
        whatsappPhone: '+919760055443',
        address: 'Marris Road, Aligarh',
        state: 'Uttar Pradesh',
        preferredChannel: 'BOTH',
        remindersEnabled: true,
        status: 'ACTIVE',
        tags: ['hospitality'],
        publicStatusToken: generateRandomToken(16),
        isDemo: true,
      },
    }),
    prisma.client.create({
      data: {
        name: 'Crescent Public Academy',
        company: 'Crescent Educational Trust',
        contactPerson: 'S. M. Rizvi',
        emails: ['principal@crescentacademy.org', 'admin@crescentacademy.org'],
        whatsappPhone: '+919412277889',
        address: 'Dodhpur, Aligarh',
        state: 'Uttar Pradesh',
        preferredChannel: 'EMAIL',
        remindersEnabled: true,
        status: 'ACTIVE',
        tags: ['education', 'nonprofit'],
        publicStatusToken: generateRandomToken(16),
        isDemo: true,
      },
    }),
    prisma.client.create({
      data: {
        name: 'Veda Organics',
        company: 'Veda Agro & Organics Pvt. Ltd.',
        contactPerson: 'Ankit Verma',
        emails: ['ankit@vedaorganics.co.in'],
        whatsappPhone: '+919910443322',
        address: 'Okhla Phase II, New Delhi',
        state: 'Delhi',
        gstin: '07AAACV9102K1Z8',
        preferredChannel: 'BOTH',
        remindersEnabled: true,
        status: 'ACTIVE',
        tags: ['ecommerce', 'inter-state'],
        publicStatusToken: generateRandomToken(16),
        isDemo: true,
      },
    }),
    prisma.client.create({
      data: {
        name: 'LockCity Hardware Co.',
        company: 'LockCity Hardware Exports',
        contactPerson: 'Manoj Gupta',
        emails: ['sales@lockcityhardware.com'],
        whatsappPhone: '+919897112200',
        address: 'Tala Nagri, Aligarh',
        state: 'Uttar Pradesh',
        gstin: '09AAACL3321M1Z2',
        preferredChannel: 'WHATSAPP',
        remindersEnabled: true,
        status: 'ACTIVE',
        tags: ['manufacturing'],
        publicStatusToken: generateRandomToken(16),
        isDemo: true,
      },
    }),
  ]);

  const [brass, dental, zayka, crescent, veda, lockcity] = clients;

  const domainSpecs = [
    { name: 'zaykaheritage.in', clientId: zayka.id, providerAccountId: godaddy.id, offset: -4, cost: 749, sell: 1200, dns: 'Cloudflare', whoPays: 'CLIENT' as const, autoRenew: false },
    { name: 'aligarhbrass.in', clientId: brass.id, providerAccountId: hostinger.id, offset: 3, cost: 749, sell: 1250, dns: 'Cloudflare', whoPays: 'CLIENT' as const, autoRenew: true },
    { name: 'noidadentalstudio.com', clientId: dental.id, providerAccountId: spaceship.id, offset: 6, cost: 920, sell: 1500, dns: 'Cloudflare', whoPays: 'CLIENT' as const, autoRenew: false },
    { name: 'vedaorganics.co.in', clientId: veda.id, providerAccountId: godaddy.id, offset: 14, cost: 699, sell: 1200, dns: 'GoDaddy DNS', whoPays: 'CLIENT' as const, autoRenew: false },
    { name: 'lockcityhardware.com', clientId: lockcity.id, providerAccountId: cloudflare.id, offset: 24, cost: 890, sell: 1450, dns: 'Cloudflare', whoPays: 'CLIENT' as const, autoRenew: true },
    { name: 'crescentacademy.org', clientId: crescent.id, providerAccountId: spaceship.id, offset: 38, cost: 950, sell: 1500, dns: 'Hostinger DNS', whoPays: 'CLIENT' as const, autoRenew: false },
    { name: 'aligarhbrass-exports.com', clientId: brass.id, providerAccountId: godaddy.id, offset: 52, cost: 1050, sell: 1600, dns: 'GoDaddy DNS', whoPays: 'CLIENT' as const, autoRenew: false },
    { name: 'vedaexports.com', clientId: veda.id, providerAccountId: cloudflare.id, offset: 112, cost: 890, sell: 1500, dns: 'Cloudflare', whoPays: 'CLIENT' as const, autoRenew: true },
    { name: 'crescentalumni.in', clientId: crescent.id, providerAccountId: hostinger.id, offset: 185, cost: 749, sell: 1200, dns: 'Hostinger DNS', whoPays: 'ME' as const, autoRenew: true },
    { name: 'lockcitycatalog.in', clientId: lockcity.id, providerAccountId: hostinger.id, offset: 270, cost: 749, sell: 1200, dns: 'Hostinger DNS', whoPays: 'CLIENT' as const, autoRenew: false },
  ];

  const createdDomains = [];
  for (const spec of domainSpecs) {
    const expiryDate = addDays(now, spec.offset);
    const registeredOn = addDays(expiryDate, -365 * 2);
    const status = computeAutoExpiryStatus(expiryDate, 'ACTIVE', now) as any;
    const d = await prisma.domain.create({
      data: {
        name: spec.name,
        clientId: spec.clientId,
        providerAccountId: spec.providerAccountId,
        registeredOn,
        expiryDate,
        autoRenew: spec.autoRenew,
        nameservers: ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
        dnsProvider: spec.dns,
        whoisPrivacy: true,
        costPrice: spec.cost,
        sellingPrice: spec.sell,
        renewalYears: 1,
        status,
        whoPays: spec.whoPays,
        isDemo: true,
      },
    });
    createdDomains.push(d);
  }

  const serviceSpecs = [
    {
      type: 'HOSTING' as const,
      planName: 'Cloud Business Hosting (India DC)',
      clientId: brass.id,
      providerAccountId: hostinger.id,
      offset: 5,
      cycle: 'YEARLY' as const,
      cost: 2400,
      sell: 6000,
      domainId: createdDomains[1].id,
      autoRenew: true,
    },
    {
      type: 'EMAIL_HOSTING' as const,
      planName: 'Rediffmail Pro 10-Mailbox Pack',
      clientId: lockcity.id,
      providerAccountId: rediff.id,
      offset: 11,
      cycle: 'YEARLY' as const,
      cost: 3200,
      sell: 5500,
      domainId: createdDomains[4].id,
      autoRenew: false,
    },
    {
      type: 'MAINTENANCE_AMC' as const,
      planName: 'Quarterly WordPress & Security AMC',
      clientId: dental.id,
      providerAccountId: hostinger.id,
      offset: 19,
      cycle: 'QUARTERLY' as const,
      cost: 0,
      sell: 4500,
      domainId: createdDomains[2].id,
      autoRenew: false,
    },
    {
      type: 'HOSTING' as const,
      planName: 'E-Commerce WooCommerce Node Plan',
      clientId: veda.id,
      providerAccountId: hostinger.id,
      offset: 28,
      cycle: 'YEARLY' as const,
      cost: 3600,
      sell: 8500,
      domainId: createdDomains[3].id,
      autoRenew: true,
    },
    {
      type: 'MAINTENANCE_AMC' as const,
      planName: 'Annual School Portal Maintenance',
      clientId: crescent.id,
      providerAccountId: hostinger.id,
      offset: 46,
      cycle: 'YEARLY' as const,
      cost: 1200,
      sell: 7200,
      domainId: createdDomains[5].id,
      autoRenew: false,
    },
    {
      type: 'HOSTING' as const,
      planName: 'Restaurant Menu & Booking Hosting',
      clientId: zayka.id,
      providerAccountId: hostinger.id,
      offset: -2,
      cycle: 'YEARLY' as const,
      cost: 1800,
      sell: 4800,
      domainId: createdDomains[0].id,
      autoRenew: false,
    },
    {
      type: 'CDN' as const,
      planName: 'Cloudflare Pro WAF & Cache',
      clientId: veda.id,
      providerAccountId: cloudflare.id,
      offset: 75,
      cycle: 'MONTHLY' as const,
      cost: 1650,
      sell: 2500,
      domainId: createdDomains[7].id,
      autoRenew: true,
    },
    {
      type: 'SSL' as const,
      planName: 'Wildcard Organization SSL',
      clientId: brass.id,
      providerAccountId: godaddy.id,
      offset: 130,
      cycle: 'YEARLY' as const,
      cost: 4200,
      sell: 6500,
      domainId: createdDomains[6].id,
      autoRenew: false,
    },
  ];

  for (const s of serviceSpecs) {
    const renewalDate = addDays(now, s.offset);
    const status = computeAutoExpiryStatus(renewalDate, 'ACTIVE', now) as any;
    await prisma.service.create({
      data: {
        type: s.type,
        planName: s.planName,
        clientId: s.clientId,
        providerAccountId: s.providerAccountId,
        startDate: addDays(renewalDate, -365),
        renewalDate,
        billingCycle: s.cycle,
        costPrice: s.cost,
        sellingPrice: s.sell,
        autoRenew: s.autoRenew,
        status,
        isDemo: true,
        domainLinks: {
          create: [{ domainId: s.domainId }],
        },
      },
    });
  }

  await prisma.task.create({
    data: {
      title: 'Call Farhan Khan regarding zaykaheritage.in expired domain & hosting',
      description: 'Expired 4 days ago on GoDaddy; confirm renewal payment via UPI.',
      dueDate: now,
      priority: 'HIGH',
      status: 'OPEN',
      clientId: zayka.id,
      domainId: createdDomains[0].id,
    },
  });

  await prisma.task.create({
    data: {
      title: 'Confirm auto-renew card balance before aligarhbrass.in renewal',
      description: 'Expires in 3 days on Hostinger.',
      dueDate: addDays(now, 1),
      priority: 'NORMAL',
      status: 'OPEN',
      clientId: brass.id,
      domainId: createdDomains[1].id,
    },
  });

  return { clients: clients.length, domains: createdDomains.length, services: serviceSpecs.length };
}

export async function clearDemoData(prisma: PrismaClient): Promise<void> {
  await prisma.service.deleteMany({ where: { isDemo: true } });
  await prisma.domain.deleteMany({ where: { isDemo: true } });
  await prisma.providerAccount.deleteMany({ where: { isDemo: true } });
  await prisma.client.deleteMany({ where: { isDemo: true } });
}
