import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const catalogSchema = z.object({
  name: z.string().trim().min(1).max(191),
  description: z.string().trim().max(2000).optional().nullable(),
  hsnSac: z.string().trim().max(32).optional().nullable(),
  defaultRate: z.coerce.number().min(0).default(0),
  taxPercent: z.coerce.number().min(0).max(100).default(18),
});

function serializeItem(it: any) {
  return {
    id: it.id,
    name: it.name,
    description: it.description ?? null,
    hsnSac: it.hsnSac ?? null,
    defaultRate: Number(it.defaultRate ?? 0),
    taxPercent: Number(it.taxPercent ?? 18),
    createdAt: it.createdAt instanceof Date ? it.createdAt.toISOString() : it.createdAt,
    updatedAt: it.updatedAt instanceof Date ? it.updatedAt.toISOString() : it.updatedAt,
  };
}

router.get('/', async (_req, res, next) => {
  try {
    let items = await db.catalogItem.findMany({ orderBy: { name: 'asc' } });
    if (items.length === 0) {
      const defaults = [
        { name: 'Domain Registration/Renewal', description: 'Annual domain registration or renewal & DNS management', hsnSac: '998315', defaultRate: 1000, taxPercent: 18 },
        { name: 'Hosting Renewal', description: 'Premium Hosting Plan (1 Year)', hsnSac: '998315', defaultRate: 3588, taxPercent: 18 },
        { name: 'Hosting One Year', description: 'Premium / Business Hosting (1 Year)', hsnSac: '998315', defaultRate: 5000, taxPercent: 18 },
        { name: 'Annual Maintenance Charges', description: 'Includes website update, backups & uptime monitor', hsnSac: '998314', defaultRate: 2000, taxPercent: 18 },
        { name: 'Website Maintenance & AMC (400/mo)', description: '12 Months AMC — updates, backups & technical support', hsnSac: '998314', defaultRate: 4800, taxPercent: 18 },
        { name: 'SSL Certificate & Implementation', description: 'HTTPS SSL certificate installation & configuration', hsnSac: '998313', defaultRate: 2000, taxPercent: 18 },
        { name: 'Website Design - ECONOMY PLUS', description: 'Five pages static responsive website', hsnSac: '998314', defaultRate: 10000, taxPercent: 18 },
        { name: 'Website Design - BUSINESS', description: 'Pages 15 Dynamic, Domain, Unlimited Hosting, 10 Business Emails, SEO, 1 Yr AMC', hsnSac: '998314', defaultRate: 12000, taxPercent: 18 },
        { name: 'Website Designing - BUSINESS PLUS', description: 'Pages Unlimited (Dynamic), .com Domain, Unlimited Hosting, 50 Business Emails, SEO & AMC', hsnSac: '998314', defaultRate: 18000, taxPercent: 18 },
        { name: 'E-Commerce Website', description: 'Full E-Commerce store redesign & setup', hsnSac: '998314', defaultRate: 25423.73, taxPercent: 18 },
        { name: 'Facebook Ad Setup & Running', description: 'Campaign setup, audience targeting & ad management', hsnSac: '998361', defaultRate: 1500, taxPercent: 18 },
      ];
      for (const d of defaults) {
        await db.catalogItem.create({ data: d });
      }
      items = await db.catalogItem.findMany({ orderBy: { name: 'asc' } });
    }
    res.json({ items: items.map(serializeItem) });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = catalogSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid catalog item', issues: parsed.error.flatten() });
      return;
    }
    const created = await db.catalogItem.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        hsnSac: parsed.data.hsnSac || null,
        defaultRate: parsed.data.defaultRate,
        taxPercent: parsed.data.taxPercent,
      },
    });
    res.status(201).json({ item: serializeItem(created) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const parsed = catalogSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid catalog item update' });
      return;
    }
    const updated = await db.catalogItem.update({
      where: { id: req.params.id },
      data: parsed.data,
    });
    res.json({ item: serializeItem(updated) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await db.catalogItem.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
