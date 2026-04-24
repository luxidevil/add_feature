# DEALER-DXB Dashboard

  > Private Netflix account management dashboard — coordinating Trigger Reset, Change Password, and Check Email operations via dedicated service droplets with a credit system and real-time streaming results.

  **Live at:** https://nfresetagent.com

  ---

  ## Architecture

  ```
  Browser → https://nfresetagent.com (Nginx SSL termination)
                │
           Node.js :3000 (PM2 cluster)
           Express API + Pre-built React SPA
                │
      ┌─────────┼─────────────┐
      │         │             │
  Trigger    Change       Check
  Reset      Password     Email
  142.93.4.225  159.89.172.195  139.59.42.65
  :3000      :3000        :3000
                │
           MongoDB Atlas
           (auth, logs, settings, credits)
  ```

  **Request flow:**
  1. Browser → Nginx (SSL termination on port 443)
  2. Nginx → Express on `127.0.0.1:3000`
  3. Express authenticates JWT, deducts credits, validates input
  4. Express forwards to service droplet (with API key)
  5. Droplet hits Netflix APIs, returns result
  6. Express logs to MongoDB, streams result back to browser

  ---

  ## Tech Stack

  | Layer | Technology |
  |-------|-----------|
  | Runtime | Node.js 20 |
  | Web framework | Express 5 |
  | Frontend | React 18 + Vite + Tailwind CSS |
  | Database | MongoDB Atlas (Mongoose) |
  | Process manager | PM2 (cluster mode) |
  | Reverse proxy | Nginx + Let's Encrypt |
  | Auth | JWT (jsonwebtoken + bcrypt) |
  | Logging | Pino |
  | Testing | Jest (API) + Playwright (E2E) |

  ---

  ## Infrastructure

  ### Dashboard Server
  | Field | Value |
  |-------|-------|
  | IP | `68.183.28.137` |
  | Domain | `nfresetagent.com` |
  | App port | `3000` (Nginx proxies from 443) |
  | Path | `/root/dealer-dxb-dashboard` |
  | PM2 name | `dealer-dxb` |

  ### Service Droplets

  | Service | IP | Port | PM2 name |
  |---------|-----|------|----------|
  | Trigger Reset | `142.93.4.225` | `3000` | `trigger-reset` |
  | Change Password | `159.89.172.195` | `3000` | `change-password` |
  | Check Email | `139.59.42.65` | `3000` | `check-email` |

  ---

  ## File Structure

  ```
  dealer-dxb-dashboard/
  ├── server/
  │   ├── index.js                  # Entry point (dotenv + listen)
  │   ├── app.js                    # Express setup (CORS, static, routes)
  │   ├── routes/
  │   │   ├── index.js              # Route registry (testRouter before proxyRouter)
  │   │   ├── auth.js               # Login / me
  │   │   ├── proxy.js              # Service proxies + bulk streaming endpoints
  │   │   ├── admin.js              # Admin CRUD (users, settings, logs, vouchers, shell)
  │   │   ├── user.js               # User profile / credits / IMAP / proxy credentials
  │   │   ├── health.js             # Health check
  │   │   └── test.js               # Testing mode endpoints
  │   ├── middlewares/
  │   │   └── auth.js               # requireAuth (JWT + test key), requireAdmin
  │   ├── models/
  │   │   ├── index.js              # Mongoose model exports
  │   │   ├── User.js               # username, password, role, credits, apiKey
  │   │   ├── Setting.js            # Key-value settings (concurrency, costs, URLs)
  │   │   ├── Log.js                # Operation logs
  │   │   ├── Voucher.js            # Voucher codes
  │   │   ├── ImapCredential.js     # IMAP credentials per user
  │   │   └── ProxyCredential.js    # Proxy credentials per user
  │   └── lib/
  │       ├── seed.js               # DB seeding (admin user + all settings)
  │       ├── jwtUtils.js           # sign / verify JWT
  │       ├── db.js                 # MongoDB connection helper
  │       └── logger.js             # Pino logger instance
  ├── client/
  │   ├── src/
  │   │   ├── api.js                # NDJSON streaming client (apiStream + __total signal)
  │   │   ├── auth.jsx              # Auth context (login, logout, refreshUser)
  │   │   ├── pricing.jsx           # Dynamic pricing context from /user/pricing
  │   │   ├── App.jsx               # Router with all page routes
  │   │   ├── pages/
  │   │   │   ├── TriggerReset.jsx  # TR page — rate-based bulk, real-time stream
  │   │   │   ├── ChangePassword.jsx # CP page — Hold/Inactive/Failed filter tabs
  │   │   │   ├── CheckEmail.jsx    # VM Email — 5-status filter tabs
  │   │   │   ├── Admin.jsx         # Admin panel
  │   │   │   └── ...               # Login, Logs, BuyCredits, etc.
  │   │   └── lib/
  │   │       └── helpers.js        # parseEmailList, parseCPList, exportXlsx, cn
  │   └── public/
  │       ├── deepdevilmin.html     # Secret admin HTML page
  │       └── testing.html          # Testing mode toggle
  ├── public/                       # ⚠️ Pre-built output — do NOT edit
  ├── tests/
  │   ├── test-all-endpoints.js     # 69 API tests
  │   ├── mock-droplets.js          # Mock TR/CP/VM Express servers (ports 4001-4003)
  │   └── e2e/                      # 30 Playwright UI tests
  ├── ecosystem.config.js           # PM2 config
  ├── DEPLOY.md                     # Deployment guide
  ├── API_DOCUMENTATION.md          # Full API reference
  └── replit.md                     # Replit agent guide
  ```

  ---

  ## API Reference

  ### Authentication
  ```
  POST /api/auth/login     { username, password }
  GET  /api/auth/me
  ```

  ### Proxy — Single Operations
  ```
  POST /api/proxy/trigger-reset     { email, country }
  POST /api/proxy/change-password   { resetUrl, newPassword, country }
  POST /api/proxy/check-email       { email }
  ```

  ### Proxy — Bulk Streaming (NDJSON)
  ```
  POST /api/proxy/trigger-reset-bulk      { rawList, defaultCountry }
  POST /api/proxy/change-password-bulk    { rawList, defaultPassword, defaultCountry, defaultProxy }
  POST /api/proxy/check-email-bulk        { rawList }
  ```

  Bulk responses are NDJSON — each line is a JSON object streamed as results complete.
  First line is always `{ "__total": N }` indicating total item count.

  ### User
  ```
  GET  /api/user/pricing
  GET  /api/user/logs
  POST /api/user/redeem        { code }
  GET  /api/user/imap-credentials
  GET  /api/user/proxy-credentials
  ```

  ### Admin (admin role required)
  ```
  GET/POST/PUT/DELETE /api/admin/users
  GET/PUT             /api/admin/settings
  GET/DELETE          /api/admin/logs
  GET/POST/DELETE     /api/admin/vouchers
  POST                /api/admin/shell
  POST                /api/admin/deploy
  ```

  ---

  ## Bulk Firing Logic

  ### TR and CP — Rate-Based (2.5 req/sec)
  Both TR and CP fire **5 requests every 2 seconds**:

  ```js
  while (queue.length) {
    const batch = queue.splice(0, 5);
    batch.forEach(item => allPromises.push(fireOne(item)));
    if (queue.length) await new Promise(r => setTimeout(r, 2000));
  }
  ```

  **Why 2.5/sec:** Netflix silently fake-confirms TR requests above ~4/sec — it returns 200 but never sends the reset email. Confirmed by testing at 4/sec and 10/sec. 2.5/sec is the validated safe rate.

  ### VM Email — Worker Pool
  VM Email uses concurrent workers pulling from a shared queue. Concurrency controlled by `concurrency_check_email` MongoDB setting (default: 10).

  ---

  ## MongoDB Settings

  All configurable without restart via the Admin panel:

  | Key | Default | Description |
  |-----|---------|-------------|
  | `credit_cost_trigger_reset` | 1 | Credits per TR operation |
  | `credit_cost_change_password` | 1.5 | Credits per CP operation |
  | `credit_cost_check_email` | 0.5 | Credits per VM Email check |
  | `concurrency_trigger_reset` | 5 | TR concurrency (rate-based, currently unused) |
  | `concurrency_change_password` | 5 | CP concurrency (rate-based, currently unused) |
  | `concurrency_check_email` | 10 | VM Email worker pool size |
  | `trigger_reset_url` | `http://142.93.4.225:3000` | TR droplet URL |
  | `change_password_url` | `http://159.89.172.195:3000` | CP droplet URL |
  | `check_email_url` | `http://139.59.42.65:3000` | VM droplet URL |

  ---

  ## CP Results — Filter Tabs

  | Tab | Filter Logic | Copy Action |
  |-----|-------------|------------|
  | All | All results | Links + emails |
  | Success | `r.success && status !== 'inactive'` | Emails only |
  | Hold | `status === 'hold'` | Links + emails |
  | Inactive | `status === 'inactive'` | Emails only |
  | Failed | `!r.success && status !== 'inactive,hold'` | Links + emails |

  Row status badges: 🟡 HOLD · ⚪ INACTIVE · 🟢 SUCCESS · 🔴 FAILED

  ---

  ## VM Email Status Values

  | Status | Color | Meaning |
  |--------|-------|---------|
  | `working` | 🟢 Green | Email accessible |
  | `invalid` | 🟡 Yellow | Login failed |
  | `error` | 🔴 Red | Network/IMAP error |
  | `unknown` | 🟠 Orange | Undetermined |
  | `wiped` | 🟣 Purple | Email cleared |

  ---

  ## Critical Rules

  1. **Never add timeouts to `fetchDroplet()`** — Netflix operations take 10–30 seconds by design. No timeout is intentional.
  2. **Never fire TR or CP faster than 2.5/sec** — Netflix fake-confirms above ~4/sec without sending emails.
  3. **Never edit `public/` directly** — it's Vite build output, wiped on every build. Edit `client/src/`.
  4. **Static files go in `client/public/`** — Vite copies them to `public/` on build. `deepdevilmin.html` and `testing.html` must live there.
  5. **Settings are live** — all MongoDB settings take effect immediately, no restart needed.

  ---

  ## CP PERMISSION_DENIED

  `Netflix rejected password change: PERMISSION_DENIED` means the reset token is **expired or already used**. Tokens expire in ~60 minutes. Fix: run CP immediately after getting reset links from TR.

  ---

  ## Testing

  ```bash
  # API tests (69 tests, no browser needed)
  node tests/test-all-endpoints.js

  # Playwright E2E (30 tests, headless Chromium)
  npx playwright test

  # Check test results
  cat test-results/results.json
  ```

  Mock droplets simulate all 3 service droplets locally on ports 4001–4003 with API key validation.

  ---

  ## Deploy

  See [DEPLOY.md](DEPLOY.md) for full deployment guide.

  Quick deploy from any machine with SSH access:
  ```bash
  ssh root@68.183.28.137
  cd /root/dealer-dxb-dashboard
  git pull origin main
  cd client && npm run build && cd ..
  pm2 restart all
  ```

  ---

  ## Repositories

  | Repo | Purpose |
  |------|---------|
  | `luxidevil/dealer-dxb-dashboard` | Main dashboard (this repo) |
  | `luxidevil/trigger_reset_droplet` | TR service |
  | `luxidevil/change_password_droplet` | CP service |
  | `luxidevil/check_email_droplet` | VM Email service |
  