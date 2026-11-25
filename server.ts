import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import { db, getDatabaseMode, initDatabase } from './server/db';
import { csrfProtection, requireAuth, getClientIp } from './server/middleware/auth';
import { runCronTick } from './server/jobs/cronTick';
import { logError, logInfo, logWarn } from './server/lib/logger';
import { recordAudit } from './server/lib/audit';

import authRoutes from './server/routes/auth';
import clientRoutes from './server/routes/clients';
import providerRoutes from './server/routes/providers';
import domainRoutes from './server/routes/domains';
import serviceRoutes from './server/routes/services';
import settingsRoutes from './server/routes/settings';
import dashboardRoutes from './server/routes/dashboard';
import catalogRoutes from './server/routes/catalog';
import estimateRoutes from './server/routes/estimates';
import invoiceRoutes from './server/routes/invoices';
import paymentRoutes from './server/routes/payments';
import expenseRoutes from './server/routes/expenses';
import reportRoutes from './server/routes/reports';
import publicRoutes from './server/routes/public';
import messagesRoutes from './server/routes/messages';
import webhookRoutes from './server/routes/webhooks';
import websiteRoutes from './server/routes/websites';

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  await initDatabase();
  const app = express();

  // Reverse proxy trust (Hostinger hPanel / Cloud Run / Nginx)
  app.set('trust proxy', 1);

  // Security headers (frameguard/COOP/CORP relaxed to support preview iframe; CSP tailored for Vite SPA)
  app.use(
    helmet({
      frameguard: false,
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
    })
  );

  // CORS locked to own domain / APP_URL
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        const appUrl = process.env.APP_URL?.trim();
        try {
          const originHost = new URL(origin).host;
          if (appUrl && new URL(appUrl).host === originHost) {
            return callback(null, true);
          }
          if (!IS_PROD && (originHost.startsWith('localhost') || originHost.startsWith('127.0.0.1'))) {
            return callback(null, true);
          }
          if (originHost.endsWith('.run.app') || originHost.endsWith('.aligarhwebsolutions.com')) {
            return callback(null, true);
          }
        } catch {
          return callback(new Error('Invalid Origin'), false);
        }
        return callback(null, false);
      },
      credentials: true,
    })
  );

  app.use(
    express.json({
      limit: '5mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use(cookieParser());
  app.use(csrfProtection);

  // Health endpoint
  app.get('/api/health', async (_req, res) => {
    let dbConnected = false;
    try {
      await db.$queryRaw`SELECT 1`;
      dbConnected = true;
    } catch {
      dbConnected = false;
    }
    res.json({
      status: dbConnected ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      timezone: 'Asia/Kolkata',
      dbMode: getDatabaseMode(),
      dbConnected,
    });
  });

  // Cron tick endpoint protected by x-cron-secret
  app.post('/api/cron/tick', async (req, res, next) => {
    try {
      const configuredSecret = process.env.CRON_SECRET?.trim();
      const providedSecret = String(req.headers['x-cron-secret'] || '');

      if (!configuredSecret) {
        res.status(503).json({ error: 'CRON_SECRET is not configured in environment variables' });
        return;
      }

      const a = Buffer.from(configuredSecret);
      const b = Buffer.from(providedSecret);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        res.status(401).json({ error: 'Unauthorized cron tick' });
        return;
      }

      const forceAll = req.query.force === 'true';
      const result = await runCronTick(db, { forceAll });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // Owner-authenticated manual cron trigger from Settings UI
  app.post('/api/cron/run-now', requireAuth, async (req, res, next) => {
    try {
      const forceAll = req.body?.forceAll === true;
      const result = await runCronTick(db, { forceAll });
      await recordAudit({
        actorEmail: req.authUser?.email,
        action: 'CRON_MANUAL_RUN',
        summary: `Triggered manual cron tick (${result.executed.length} executed)`,
        ipAddress: getClientIp(req),
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // API routes
  app.use('/api/auth', authRoutes);
  app.use('/api/clients', clientRoutes);
  app.use('/api/providers', providerRoutes);
  app.use('/api/domains', domainRoutes);
  app.use('/api/services', serviceRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/catalog', catalogRoutes);
  app.use('/api/estimates', estimateRoutes);
  app.use('/api/invoices', invoiceRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/expenses', expenseRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/messages', messagesRoutes);
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/websites', websiteRoutes);

  // Global search alias
  app.use('/api', (req, res, next) => {
    if (req.path === '/search' && req.method === 'GET') {
      return dashboardRoutes(req, res, next);
    }
    next();
  });

  // JSON error handler for /api/*
  app.use('/api', (err: any, _req: Request, res: Response, _next: NextFunction) => {
    logError('Unhandled API error', err);
    const status = typeof err?.status === 'number' ? err.status : 500;
    res.status(status).json({
      error: status >= 500 ? 'Internal server error' : err?.message || 'Request failed',
    });
  });

  // Serve frontend: Vite middleware in dev, built dist/ in production
  const distPath = path.resolve(process.cwd(), 'dist');
  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (fs.existsSync(distPath)) {
    app.use(express.static(distPath, { index: false }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    logWarn('Production dist directory not found; run npm run build first');
  }

  // In-process cron fallback every 5 minutes (same idempotent runCronTick function)
  if (process.env.ENABLE_IN_PROCESS_CRON !== 'false') {
    cron.schedule('*/5 * * * *', () => {
      runCronTick(db).catch((err) => logError('In-process cron tick failed', err));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    logInfo(`AWS Control Center listening on port ${PORT}`, {
      env: process.env.NODE_ENV || 'development',
      dbMode: getDatabaseMode(),
    });
  });
}

startServer().catch((err) => {
  logError('Fatal server startup failure', err);
  process.exit(1);
});
