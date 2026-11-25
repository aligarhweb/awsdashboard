import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';
import { getDaysLeftIST, getIstDateParts, getUrgencyInfo } from '../../shared/dates';
import { getCurrentFyIstBounds, getCurrentMonthIstBounds } from '../lib/billingHelpers';
import { round2 } from '../../shared/billing';
import { DashboardSummaryDTO } from '../../shared/types';
import { computeUptimePercent } from '../lib/uptimeMonitor';

const router = Router();
router.use(requireAuth);

router.get('/', async (_req, res, next) => {
  try {
    const now = new Date();
    const nowIst = getIstDateParts(now);

    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
    const [clients, domains, services, tasks, jobStates, websites, checks30d, invoices, payments] = await Promise.all([
      db.client.findMany({ where: { status: 'ACTIVE' } }),
      db.domain.findMany({
        include: {
          client: { select: { id: true, name: true } },
          providerAccount: { select: { id: true, name: true } },
        },
        orderBy: { expiryDate: 'asc' },
      }),
      db.service.findMany({
        include: {
          client: { select: { id: true, name: true } },
          providerAccount: { select: { id: true, name: true } },
        },
        orderBy: { renewalDate: 'asc' },
      }),
      db.task.findMany({
        where: { status: 'OPEN' },
        orderBy: { dueDate: 'asc' },
      }),
      db.jobState.findMany(),
      db.website.findMany(),
      db.uptimeCheck.findMany({
        where: { checkedAt: { gte: thirtyDaysAgo } },
      }),
      db.invoice.findMany({
        include: {
          client: { select: { id: true, name: true } },
          creditNotes: true,
        },
      }),
      db.payment.findMany(),
    ]);

    let domainsExpiring7 = 0;
    let domainsExpiring30 = 0;
    let domainsExpiring60 = 0;
    let expiredItems = 0;
    let servicesRenewingThisMonth = 0;

    let forecastDomainRev = 0;
    let forecastDomainCost = 0;
    let forecastServiceRev = 0;
    let forecastServiceCost = 0;
    let forecastCount = 0;

    const actionNeededToday: DashboardSummaryDTO['actionNeededToday'] = [];
    const upcomingCalendar: DashboardSummaryDTO['upcomingCalendar'] = [];

    for (const d of domains as any[]) {
      if (d.status === 'TRANSFERRED') continue;
      const urgency = getUrgencyInfo(d.expiryDate, now);
      const sell = Number(d.sellingPrice ?? 0);
      const cost = Number(d.costPrice ?? 0);

      if (urgency.daysLeft < 0) expiredItems += 1;
      else if (urgency.daysLeft <= 7) domainsExpiring7 += 1;
      if (urgency.daysLeft >= 0 && urgency.daysLeft <= 30) domainsExpiring30 += 1;
      if (urgency.daysLeft >= 0 && urgency.daysLeft <= 60) domainsExpiring60 += 1;

      if (urgency.daysLeft >= 0 && urgency.daysLeft <= 90) {
        forecastDomainRev += sell;
        forecastDomainCost += cost;
        forecastCount += 1;
      }

      if (urgency.daysLeft <= 7) {
        actionNeededToday.push({
          id: d.id,
          kind: 'DOMAIN',
          title: d.name,
          subtitle: `${urgency.label} · ${d.providerAccount?.name || 'Manual registrar'}`,
          clientId: d.clientId,
          clientName: d.client?.name,
          dueDate: d.expiryDate instanceof Date ? d.expiryDate.toISOString() : d.expiryDate,
          daysLeft: urgency.daysLeft,
          urgency: urgency.level,
          amount: sell,
        });
      }

      if (urgency.daysLeft >= -30 && urgency.daysLeft <= 90) {
        upcomingCalendar.push({
          id: d.id,
          kind: 'DOMAIN',
          name: d.name,
          clientId: d.clientId,
          clientName: d.client?.name || 'Unknown',
          date: d.expiryDate instanceof Date ? d.expiryDate.toISOString() : d.expiryDate,
          daysLeft: urgency.daysLeft,
          urgency: urgency.level,
          sellingPrice: sell,
          costPrice: cost,
          autoRenew: Boolean(d.autoRenew),
          providerName: d.providerAccount?.name || null,
        });
      }
    }

    for (const s of services as any[]) {
      if (s.status === 'CANCELLED' || s.status === 'SUSPENDED') continue;
      const urgency = getUrgencyInfo(s.renewalDate, now);
      const renewalParts = getIstDateParts(s.renewalDate);
      const sell = Number(s.sellingPrice ?? 0);
      const cost = Number(s.costPrice ?? 0);

      if (urgency.daysLeft < 0) expiredItems += 1;
      if (renewalParts.year === nowIst.year && renewalParts.month === nowIst.month) {
        servicesRenewingThisMonth += 1;
      }

      if (urgency.daysLeft >= 0 && urgency.daysLeft <= 90) {
        forecastServiceRev += sell;
        forecastServiceCost += cost;
        forecastCount += 1;
      }

      if (urgency.daysLeft <= 7) {
        actionNeededToday.push({
          id: s.id,
          kind: 'SERVICE',
          title: s.planName,
          subtitle: `${urgency.label} · ${s.type.replace('_', ' ')}`,
          clientId: s.clientId,
          clientName: s.client?.name,
          dueDate: s.renewalDate instanceof Date ? s.renewalDate.toISOString() : s.renewalDate,
          daysLeft: urgency.daysLeft,
          urgency: urgency.level,
          amount: sell,
        });
      }

      if (urgency.daysLeft >= -30 && urgency.daysLeft <= 90) {
        upcomingCalendar.push({
          id: s.id,
          kind: 'SERVICE',
          name: s.planName,
          clientId: s.clientId,
          clientName: s.client?.name || 'Unknown',
          date: s.renewalDate instanceof Date ? s.renewalDate.toISOString() : s.renewalDate,
          daysLeft: urgency.daysLeft,
          urgency: urgency.level,
          sellingPrice: sell,
          costPrice: cost,
          autoRenew: Boolean(s.autoRenew),
          providerName: s.providerAccount?.name || null,
        });
      }
    }

    for (const t of tasks as any[]) {
      const daysLeft = t.dueDate ? getDaysLeftIST(t.dueDate, now) : 0;
      if (daysLeft <= 2) {
        actionNeededToday.push({
          id: t.id,
          kind: 'TASK',
          title: t.title,
          subtitle: t.description || 'Follow-up task',
          clientId: t.clientId || undefined,
          dueDate: t.dueDate ? new Date(t.dueDate).toISOString() : now.toISOString(),
          daysLeft,
          urgency: daysLeft <= 0 ? 'red' : 'orange',
        });
      }
    }

    let unpaidInvoicesTotal = 0;
    for (const inv of invoices as any[]) {
      if (!['SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status)) continue;
      const credits = (inv.creditNotes || []).reduce((acc: number, c: any) => acc + Number(c.amount ?? 0), 0);
      const balance = Math.max(0, round2(Number(inv.total ?? 0) - Number(inv.amountPaid ?? 0) - credits));
      if (balance <= 0.01) continue;
      unpaidInvoicesTotal = round2(unpaidInvoicesTotal + balance);

      const urgency = getUrgencyInfo(inv.dueDate, now);
      if (urgency.daysLeft <= 3) {
        actionNeededToday.push({
          id: inv.id,
          kind: 'INVOICE',
          title: inv.invoiceNumber,
          subtitle: urgency.daysLeft < 0 ? `Payment overdue (${inv.status})` : `Payment due (${inv.status})`,
          clientId: inv.clientId,
          clientName: inv.client?.name,
          dueDate: inv.dueDate instanceof Date ? inv.dueDate.toISOString() : inv.dueDate,
          daysLeft: urgency.daysLeft,
          urgency: urgency.level,
          amount: balance,
        });
      }
    }

    actionNeededToday.sort((a, b) => a.daysLeft - b.daysLeft);
    upcomingCalendar.sort((a, b) => a.daysLeft - b.daysLeft);

    const monthBounds = getCurrentMonthIstBounds(now);
    const fyBounds = getCurrentFyIstBounds(now);
    let revenueThisMonth = 0;
    let revenueThisFy = 0;
    for (const p of payments as any[]) {
      const t = new Date(p.paidAt).getTime();
      const amt = Number(p.amount ?? 0);
      if (t >= monthBounds.start.getTime() && t <= monthBounds.end.getTime()) {
        revenueThisMonth = round2(revenueThisMonth + amt);
      }
      if (t >= fyBounds.start.getTime() && t <= fyBounds.end.getTime()) {
        revenueThisFy = round2(revenueThisFy + amt);
      }
    }

    const sitesDownCount = (websites as any[]).filter((w) => !w.paused && w.isDown).length;
    const uptime30dAvg = computeUptimePercent(checks30d as any[]);

    const totalRevenue = forecastDomainRev + forecastServiceRev;
    const totalCost = forecastDomainCost + forecastServiceCost;

    const summary: DashboardSummaryDTO = {
      counts: {
        domainsExpiring7,
        domainsExpiring30,
        domainsExpiring60,
        expiredItems,
        servicesRenewingThisMonth,
        totalClients: clients.length,
        totalDomains: domains.length,
        totalServices: services.length,
        unpaidInvoicesTotal,
        revenueThisMonth,
        revenueThisFy,
        sitesDownCount,
        uptime30dAvg,
      },
      forecast90Days: {
        domainRevenue: forecastDomainRev,
        domainCost: forecastDomainCost,
        serviceRevenue: forecastServiceRev,
        serviceCost: forecastServiceCost,
        totalRevenue,
        totalProfit: totalRevenue - totalCost,
        itemsCount: forecastCount,
      },
      actionNeededToday,
      upcomingCalendar,
      jobStates: jobStates
        .filter((j: any) => !String(j.jobName).startsWith('__'))
        .map((j: any) => ({
          jobName: j.jobName,
          lastRunAt: j.lastRunAt ? new Date(j.lastRunAt).toISOString() : null,
          lastSuccessAt: j.lastSuccessAt ? new Date(j.lastSuccessAt).toISOString() : null,
          lastStatus: j.lastStatus ?? null,
          lastSummary: j.lastSummary ?? null,
        })),
    };

    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    if (!q || q.length < 1) {
      res.json({ clients: [], domains: [], services: [] });
      return;
    }

    const [clients, domains, services] = await Promise.all([
      db.client.findMany({ orderBy: { name: 'asc' } }),
      db.domain.findMany({ include: { client: { select: { id: true, name: true } } }, orderBy: { expiryDate: 'asc' } }),
      db.service.findMany({ include: { client: { select: { id: true, name: true } } }, orderBy: { renewalDate: 'asc' } }),
    ]);

    res.json({
      clients: clients
        .filter((c: any) => `${c.name} ${c.company || ''} ${c.whatsappPhone || ''}`.toLowerCase().includes(q))
        .slice(0, 6)
        .map((c: any) => ({ id: c.id, name: c.name, company: c.company })),
      domains: domains
        .filter((d: any) => `${d.name} ${d.client?.name || ''}`.toLowerCase().includes(q))
        .slice(0, 6)
        .map((d: any) => ({
          id: d.id,
          name: d.name,
          clientName: d.client?.name,
          expiryDate: d.expiryDate instanceof Date ? d.expiryDate.toISOString() : d.expiryDate,
        })),
      services: services
        .filter((s: any) => `${s.planName} ${s.type} ${s.client?.name || ''}`.toLowerCase().includes(q))
        .slice(0, 6)
        .map((s: any) => ({
          id: s.id,
          planName: s.planName,
          clientName: s.client?.name,
          renewalDate: s.renewalDate instanceof Date ? s.renewalDate.toISOString() : s.renewalDate,
        })),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
