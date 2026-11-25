import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import QRCode from 'qrcode';
import { db } from '../db';
import { buildUpiUri, round2 } from '../../shared/billing';
import { recordAudit } from '../lib/audit';
import { getClientIp } from '../middleware/auth';
import { serializeEstimate, serializeInvoice } from '../lib/billingHelpers';
import { generateEstimatePdfBuffer, generateInvoicePdfBuffer } from '../lib/pdfGenerator';
import { computeUptimePercent } from '../lib/uptimeMonitor';

const router = Router();

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

function sanitizeBusinessInfo(settings: any) {
  return {
    businessName: settings?.businessName || 'Aligarh Web Solutions',
    businessState: settings?.businessState || 'Uttar Pradesh',
    address: settings?.address || null,
    gstin: settings?.gstin || null,
    pan: settings?.pan || null,
    bankName: settings?.bankName || null,
    bankAccountNumber: settings?.bankAccountNumber || null,
    bankIfsc: settings?.bankIfsc || null,
    bankAccountName: settings?.bankAccountName || null,
    upiId: settings?.upiId || null,
    logoDataUrl: settings?.logoDataUrl || null,
    email: settings?.smtpFromEmail || settings?.ownerAlertEmail || null,
  };
}

function sanitizeClientInfo(client: any) {
  if (!client) return null;
  return {
    name: client.name,
    company: client.company ?? null,
    address: client.address ?? null,
    state: client.state ?? null,
    gstin: client.gstin ?? null,
  };
}

router.get('/invoice/:token', publicLimiter, async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) {
      res.status(404).json({ error: 'Invoice link invalid' });
      return;
    }

    const inv = await db.invoice.findUnique({
      where: { publicToken: token },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
        payments: { orderBy: { paidAt: 'desc' } },
        creditNotes: { orderBy: { issuedAt: 'desc' } },
      },
    });
    if (!inv) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    if (!inv.viewedAt || inv.status === 'SENT') {
      await db.invoice.update({
        where: { id: inv.id },
        data: {
          viewedAt: inv.viewedAt || new Date(),
          ...(inv.status === 'SENT' ? { status: 'VIEWED' } : {}),
        },
      });
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const serialized = serializeInvoice(inv);
    const balance = round2(serialized.balanceDue);

    let upiUri: string | null = null;
    let upiQrDataUrl: string | null = null;
    if (settings?.upiId && balance > 0 && serialized.status !== 'CANCELLED') {
      upiUri = buildUpiUri({
        upiId: settings.upiId,
        payeeName: settings.businessName || 'Aligarh Web Solutions',
        amount: balance,
        note: serialized.invoiceNumber,
      });
      upiQrDataUrl = await QRCode.toDataURL(upiUri, { width: 240, margin: 1 });
    }

    res.json({
      business: sanitizeBusinessInfo(settings),
      invoice: {
        invoiceNumber: serialized.invoiceNumber,
        financialYear: serialized.financialYear,
        referenceNumber: serialized.referenceNumber,
        projectName: serialized.projectName,
        placeOfSupply: serialized.placeOfSupply,
        issueDate: serialized.issueDate,
        dueDate: serialized.dueDate,
        gstMode: serialized.gstMode,
        subtotal: serialized.subtotal,
        discountTotal: serialized.discountTotal,
        cgstTotal: serialized.cgstTotal,
        sgstTotal: serialized.sgstTotal,
        igstTotal: serialized.igstTotal,
        taxTotal: serialized.taxTotal,
        roundOff: serialized.roundOff,
        adjustmentLabel: serialized.adjustmentLabel,
        total: serialized.total,
        amountPaid: serialized.amountPaid,
        balanceDue: serialized.balanceDue,
        status: inv.status === 'SENT' ? 'VIEWED' : serialized.status,
        notes: serialized.notes,
        terms: serialized.terms,
        client: sanitizeClientInfo(inv.client),
        items: serialized.items,
        payments: (serialized.payments || []).map((p: any) => ({
          receiptNumber: p.receiptNumber,
          paidAt: p.paidAt,
          amount: p.amount,
          method: p.method,
        })),
        upiUri,
        upiQrDataUrl,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/invoice/:token/pdf', publicLimiter, async (req, res, next) => {
  try {
    const inv = await db.invoice.findUnique({
      where: { publicToken: String(req.params.token || '').trim() },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
        payments: true,
        creditNotes: true,
      },
    });
    if (!inv) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const pdfBuffer = await generateInvoicePdfBuffer(serializeInvoice(inv), settings);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${inv.invoiceNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

router.get('/estimate/:token', publicLimiter, async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    const est = await db.estimate.findUnique({
      where: { publicToken: token },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!est) {
      res.status(404).json({ error: 'Estimate not found' });
      return;
    }

    if (!est.viewedAt || est.status === 'SENT') {
      await db.estimate.update({
        where: { id: est.id },
        data: {
          viewedAt: est.viewedAt || new Date(),
          ...(est.status === 'SENT' ? { status: 'VIEWED' } : {}),
        },
      });
    }

    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const serialized = serializeEstimate(est);

    res.json({
      business: sanitizeBusinessInfo(settings),
      estimate: {
        estimateNumber: serialized.estimateNumber,
        referenceNumber: serialized.referenceNumber,
        projectName: serialized.projectName,
        placeOfSupply: serialized.placeOfSupply,
        issueDate: serialized.issueDate,
        validUntil: serialized.validUntil,
        gstMode: serialized.gstMode,
        subtotal: serialized.subtotal,
        discountTotal: serialized.discountTotal,
        taxTotal: serialized.taxTotal,
        roundOff: serialized.roundOff,
        adjustmentLabel: serialized.adjustmentLabel,
        total: serialized.total,
        status: est.status === 'SENT' ? 'VIEWED' : serialized.status,
        notes: serialized.notes,
        terms: serialized.terms,
        clientComment: serialized.clientComment,
        respondedAt: serialized.respondedAt,
        client: sanitizeClientInfo(est.client),
        items: serialized.items,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/estimate/:token/pdf', publicLimiter, async (req, res, next) => {
  try {
    const est = await db.estimate.findUnique({
      where: { publicToken: String(req.params.token || '').trim() },
      include: {
        client: true,
        items: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!est) {
      res.status(404).json({ error: 'Estimate not found' });
      return;
    }
    const settings = await db.settings.findUnique({ where: { id: 1 } });
    const pdfBuffer = await generateEstimatePdfBuffer(serializeEstimate(est), settings);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${est.estimateNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    next(err);
  }
});

router.post('/estimate/:token/respond', publicLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      decision: z.enum(['ACCEPT', 'REJECT']),
      comment: z.string().trim().max(2000).optional().nullable(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid response payload' });
      return;
    }

    const est = await db.estimate.findUnique({
      where: { publicToken: String(req.params.token || '').trim() },
      include: { client: true },
    });
    if (!est) {
      res.status(404).json({ error: 'Estimate not found' });
      return;
    }

    const nextStatus = parsed.data.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
    const updated = await db.estimate.update({
      where: { id: est.id },
      data: {
        status: nextStatus,
        clientComment: parsed.data.comment || est.clientComment || null,
        respondedAt: new Date(),
      },
    });

    await recordAudit({
      actorEmail: est.client?.name || 'Client',
      action: `ESTIMATE_${nextStatus}_PUBLIC`,
      entityType: 'Estimate',
      entityId: est.id,
      summary: `Client ${nextStatus.toLowerCase()} estimate ${est.estimateNumber} via public link`,
      ipAddress: getClientIp(req),
    });

    res.json({
      status: updated.status,
      clientComment: updated.clientComment,
      respondedAt: updated.respondedAt instanceof Date ? updated.respondedAt.toISOString() : updated.respondedAt,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/status/:token', publicLimiter, async (req, res, next) => {
  try {
    const token = String(req.params.token || '').trim();
    if (!token) {
      res.status(404).json({ error: 'Status page not found' });
      return;
    }

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const twentyFourHoursAgo = now.getTime() - 86_400_000;

    let scope: 'WEBSITE' | 'CLIENT' = 'WEBSITE';
    let title = 'Service Status';
    let subtitle: string | null = null;
    let targetWebsites: any[] = [];

    const directWebsite = await db.website.findUnique({
      where: { publicStatusToken: token },
      include: { client: { select: { id: true, name: true, company: true } } },
    });

    if (directWebsite) {
      scope = 'WEBSITE';
      title = directWebsite.label || directWebsite.url;
      subtitle = directWebsite.client?.company || directWebsite.client?.name || null;
      targetWebsites = [directWebsite];
    } else {
      const directClient = await db.client.findUnique({
        where: { publicStatusToken: token },
        include: { websites: true },
      });
      if (!directClient) {
        res.status(404).json({ error: 'Status page not found' });
        return;
      }
      scope = 'CLIENT';
      title = directClient.company || directClient.name;
      subtitle = 'Monitored Web Properties';
      targetWebsites = Array.isArray(directClient.websites) ? directClient.websites : [];
    }

    const websiteIds = targetWebsites.map((w) => w.id);
    const [settings, checks30d, incidents] = await Promise.all([
      db.settings.findUnique({ where: { id: 1 } }),
      websiteIds.length > 0
        ? db.uptimeCheck.findMany({
            where: {
              websiteId: { in: websiteIds },
              checkedAt: { gte: thirtyDaysAgo },
            },
            orderBy: { checkedAt: 'desc' },
          })
        : Promise.resolve([]),
      websiteIds.length > 0
        ? db.incident.findMany({
            where: { websiteId: { in: websiteIds } },
            orderBy: { startedAt: 'desc' },
            take: 15,
          })
        : Promise.resolve([]),
    ]);

    const websitePayload = targetWebsites.map((w) => {
      const siteChecks = (checks30d as any[])
        .filter((c) => c.websiteId === w.id)
        .sort((a, b) => new Date(b.checkedAt).getTime() - new Date(a.checkedAt).getTime());
      const checks24h = siteChecks.filter(
        (c) => new Date(c.checkedAt).getTime() >= twentyFourHoursAgo
      );

      let status: 'UP' | 'DOWN' | 'PAUSED' | 'PENDING' = 'PENDING';
      if (w.paused) status = 'PAUSED';
      else if (w.isDown) status = 'DOWN';
      else if (w.lastCheckedAt) status = 'UP';

      return {
        id: w.id,
        label: w.label || w.url,
        url: w.url,
        status,
        lastCheckedAt: w.lastCheckedAt ? new Date(w.lastCheckedAt).toISOString() : null,
        lastResponseMs: w.lastResponseMs ?? null,
        sslExpiry: w.sslExpiry ? new Date(w.sslExpiry).toISOString() : null,
        uptime24h: computeUptimePercent(checks24h),
        uptime30d: computeUptimePercent(siteChecks),
        recentChecks: siteChecks.slice(0, 30).map((c) => ({
          checkedAt: new Date(c.checkedAt).toISOString(),
          up: Boolean(c.up),
          responseMs: c.responseMs ?? null,
        })),
      };
    });

    const activeSites = websitePayload.filter((w) => w.status !== 'PAUSED');
    const downSites = activeSites.filter((w) => w.status === 'DOWN');
    let overallStatus: 'OPERATIONAL' | 'DEGRADED' | 'DOWN' | 'PAUSED' = 'OPERATIONAL';
    if (websitePayload.length > 0 && activeSites.length === 0) {
      overallStatus = 'PAUSED';
    } else if (downSites.length > 0 && downSites.length === activeSites.length) {
      overallStatus = 'DOWN';
    } else if (downSites.length > 0) {
      overallStatus = 'DEGRADED';
    }

    const labelById = new Map(targetWebsites.map((w) => [w.id, w.label || w.url]));
    const sanitizedIncidents = (incidents as any[]).slice(0, 10).map((inc) => ({
      id: inc.id,
      websiteLabel: labelById.get(inc.websiteId) || 'Website',
      startedAt: new Date(inc.startedAt).toISOString(),
      endedAt: inc.endedAt ? new Date(inc.endedAt).toISOString() : null,
      durationSeconds: inc.durationSeconds ?? null,
      status: inc.endedAt ? ('RESOLVED' as const) : ('OPEN' as const),
    }));

    res.json({
      business: {
        businessName: settings?.businessName || 'Aligarh Web Solutions',
        logoDataUrl: settings?.logoDataUrl || null,
        email: settings?.smtpFromEmail || settings?.ownerAlertEmail || null,
      },
      scope,
      title,
      subtitle,
      overallStatus,
      generatedAt: now.toISOString(),
      websites: websitePayload,
      incidents: sanitizedIncidents,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

