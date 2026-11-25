# Deploying AWS Control Center on Hostinger Managed Node.js (hPanel)

This guide covers deploying **AWS Control Center** from a private GitHub repository onto a Hostinger Business/Cloud plan using **hPanel → Node.js Apps** and **Hostinger MySQL**.

---

## 1. Create the Subdomain & SSL
1. Log in to **Hostinger hPanel** → **Websites** → **Domains / Subdomains**.
2. Create your subdomain (e.g. `app.aligarhwebsolutions.com`).
3. Under **Security → SSL**, ensure an SSL certificate (Let's Encrypt / Lifetime SSL) is active for `app.aligarhwebsolutions.com` and force HTTPS.

## 2. Create the MySQL Database & User
1. In hPanel, go to **Databases → Management**.
2. Create a new MySQL database (e.g. `u123456789_aws_cc`) and user with a strong password.
3. Keep the connection pool small (`connection_limit=5`) in your connection string:
   ```env
   DATABASE_URL="mysql://u123456789_aws_user:YOUR_DB_PASSWORD@127.0.0.1:3306/u123456789_aws_cc?connection_limit=5"
   ```
   *(If Hostinger specifies a remote DB hostname instead of `127.0.0.1`, use that hostname.)*

## 3. Connect the Private GitHub Repository
1. Push your repository to a private GitHub repo.
2. In hPanel → **Websites → Add Website → Node.js Web App** (or **Manage → Node.js Apps**):
   - **Framework / Application Type**: Select **Express** (or **Other / Custom Node.js**) — **do NOT leave it on Vite or React**. Because `vite.config.ts` and `index.html` live at the repository root, Hostinger's auto-detector otherwise treats the project as a static HTML site and skips starting the Express server.
   - **Node.js Version**: `20.x` or `22.x` (`package.json` specifies `"node": ">=20"`).
   - **Application Root / Subdomain**: `app.aligarhwebsolutions.com` (Root Directory `/`).
   - **GitHub Repository**: Connect your private GitHub account and select the repo + branch (`main`).
   - **Build Command**: `npm install && npm run build`
     *(Runs `prisma generate`, builds the React frontend to `dist/`, and compiles `server.ts` to `dist/server.js`.)*
   - **Start Command / Entry File**: `npm start` *(or `dist/server.js`, which listens on `process.env.PORT`)*
   - **Output Directory**: Leave empty/default (ignored for Express apps).

## 4. Configure Environment Variables in hPanel
In hPanel → Node.js App → **Environment Variables**, add:

```env
NODE_ENV=production
APP_URL=https://app.aligarhwebsolutions.com
DATABASE_URL=mysql://DB_USER:DB_PASS@127.0.0.1:3306/DB_NAME?connection_limit=5

# Generate two distinct 64-character hex secrets:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=<64-hex-chars>
ENCRYPTION_KEY=<64-hex-chars>
CRON_SECRET=<64-hex-chars>

# Optional: set "false" once your external hPanel Cron Job is active
ENABLE_IN_PROCESS_CRON=true
```

## 5. Run the One-Time Database Migration
Hostinger SSH (or hPanel Terminal) lets you apply the Prisma MySQL migrations once after setting `.env` / environment variables:

```bash
cd ~/domains/aligarhwebsolutions.com/public_html   # or your Node app root path
npx prisma migrate deploy
```

*(Optional)* If you want to seed realistic demo data via CLI instead of the web setup checkbox:
```bash
npm run prisma:seed
```

## 6. Create the Owner Account
1. Open `https://app.aligarhwebsolutions.com` in your browser.
2. The first-run **Setup Screen** appears automatically when no user exists in the database.
3. Enter your owner name, email, and password (and choose whether to load removable demo data).
4. Once submitted, `/api/auth/setup` permanently locks itself.
5. Recommended: Go to **Settings → Security & 2FA** and enable TOTP two-factor authentication.

## 7. Configure the Cron Tick (Crucial for Reliability)
Because managed Node.js workers may sleep or restart during inactivity, **do not rely on in-process timers alone**.

### Option A: Hostinger hPanel Cron Jobs
1. In hPanel → **Advanced → Cron Jobs**, create a **Custom** cron job running every **5 minutes** (`*/5 * * * *`):
   ```bash
   curl -s -X POST -H "x-cron-secret: YOUR_CRON_SECRET" https://app.aligarhwebsolutions.com/api/cron/tick > /dev/null
   ```

### Option B: External Cron (cron-job.org)
1. Create a free job on `cron-job.org` every 1–5 minutes:
   - **URL**: `https://app.aligarhwebsolutions.com/api/cron/tick`
   - **Method**: `POST`
   - **Header**: `x-cron-secret: YOUR_CRON_SECRET`

The `/api/cron/tick` endpoint uses a database lock (`JobState`) to prevent overlapping runs and catches up cleanly on any missed intervals.
