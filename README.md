# AWS Control Center — Aligarh Web Solutions

Single-user admin command center for **Aligarh Web Solutions** to manage client domains, hosting/AMC services, invoices & GST billing, uptime monitoring, and automated Email/WhatsApp renewal reminders.

## Tech Stack
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS (Light/Dark mode, responsive)
- **Backend**: Node.js 20 LTS + Express + TypeScript (`server.ts`)
- **Database**: MySQL (Hostinger-managed) via Prisma ORM (`prisma/schema.prisma`)
- **Security**: `bcryptjs` password hashing, `httpOnly` cookie sessions, TOTP 2FA (`otpauth`), AES-256-GCM encrypted credentials at rest, Helmet, strict CORS, CSRF check, Zod validation, `AuditLog`.

## Local Development
1. Copy `.env.example` to `.env` and set `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Generate Prisma Client & apply migrations (requires MySQL):
   ```bash
   npx prisma generate
   npx prisma migrate deploy
   ```
4. Start dev server:
   ```bash
   npm run dev
   ```
   *(If `DATABASE_URL` is omitted during local UI preview, the server automatically uses `.preview-data/db.json` so you can test all Phase 1 workflows immediately.)*

## Scripts
- `npm run dev` — Start Express + Vite dev server on port 3000
- `npm run build` — Run `prisma generate`, Vite client build, and `esbuild` server bundle (`dist/server.js`)
- `npm start` — Run compiled production server (`node dist/server.js`)
- `npm run lint` — TypeScript check (`tsc --noEmit`)
- `npm test` — Run Vitest unit tests

## Deployment
See [`docs/DEPLOYMENT_HOSTINGER.md`](docs/DEPLOYMENT_HOSTINGER.md) for Hostinger hPanel Node.js + MySQL setup instructions.
