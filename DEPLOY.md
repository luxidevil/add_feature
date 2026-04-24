# DEALER-DXB Dashboard — Deployment Guide

  ## Architecture Overview

  ```
  Browser → https://nfresetagent.com (Nginx :443 SSL)
                ↓
       Node.js Express :3000 (PM2 cluster)
       Static React SPA (pre-built in /public)
                ↓
      ┌─────────┼──────────┐
  Trigger    Change     Check
  Reset      Password   Email
  :3000      :3000      :3000
  ```

  ---

  ## Quick Deploy (from the server)

  ```bash
  ssh root@68.183.28.137  # password: daKsh@3210G

  cd /root/dealer-dxb-dashboard

  # Pull latest code
  git pull origin main

  # Rebuild frontend (only needed if client/src/ changed)
  cd client && npm run build && cd ..

  # Restart app
  pm2 restart all
  ```

  ---

  ## First-Time Server Setup (Ubuntu 22.04+)

  ### 1. Install Node.js 20
  ```bash
  apt update && apt upgrade -y
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt install -y nodejs git
  ```

  ### 2. Install PM2 and Nginx
  ```bash
  npm install -g pm2
  apt install -y nginx certbot python3-certbot-nginx
  ```

  ### 3. Clone and configure
  ```bash
  cd /root
  git clone https://github.com/luxidevil/dealer-dxb-dashboard.git
  cd dealer-dxb-dashboard
  npm install
  ```

  ### 4. Create .env file
  ```bash
  nano /root/dealer-dxb-dashboard/.env
  ```

  ```env
  PORT=3000
  NODE_ENV=production
  MONGODB_URI=mongodb+srv://luxidevil:daKsh%403210@cluster0.llpck1h.mongodb.net/dealer-dxb
  SESSION_SECRET=<your-secret>
  TRIGGER_RESET_API_KEY=vxntsht4yrla36i7e9g1tkv7h3l541cf
  CHANGE_PASSWORD_API_KEY=15e20239ecb6c8d1b8292b0601f7b9a47dcb20f041768f4f
  CHECK_EMAIL_API_KEY=6e7b429be0b6268d0b20c84eedbd9c32b6390352d9888f6a
  PROXY_URL=http://user:pass_country-th@proxy-host:port
  DASHBOARD_DOMAIN=nfresetagent.com
  DASHBOARD_IP=68.183.28.137
  ```

  ### 5. Build frontend
  ```bash
  cd /root/dealer-dxb-dashboard/client
  npm install
  npm run build
  cd ..
  ```

  ### 6. Start with PM2
  ```bash
  pm2 start ecosystem.config.js
  pm2 save
  pm2 startup
  ```

  ### 7. Configure Nginx
  ```bash
  nano /etc/nginx/sites-available/dealer-dxb
  ```

  ```nginx
  server {
      listen 80;
      server_name nfresetagent.com www.nfresetagent.com;

      location / {
          proxy_pass http://127.0.0.1:3000;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;
          proxy_set_header Connection 'upgrade';
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_read_timeout 300s;
          proxy_buffering off;
          proxy_cache off;
      }
  }
  ```

  ```bash
  ln -s /etc/nginx/sites-available/dealer-dxb /etc/nginx/sites-enabled/
  nginx -t && systemctl restart nginx
  certbot --nginx -d nfresetagent.com
  ```

  ---

  ## Service Droplet Setup

  All 3 droplets follow the same pattern. Example for Change Password:

  ```bash
  ssh root@159.89.172.195  # password: daKsh@3210G
  cd /root/change_password_droplet
  npm install
  pm2 start ecosystem.config.js
  pm2 save
  pm2 startup
  ufw allow 3000
  ```

  Each droplet validates:
  - **IP whitelist:** only allows requests from the dashboard IP (`68.183.28.137`)
  - **API key header:** `X-Service-Key` must match `INTERNAL_API_KEY` in the droplet's `.env`

  ---

  ## PM2 Commands

  ```bash
  pm2 list                           # Show all processes
  pm2 logs dealer-dxb --lines 50    # Last 50 log lines
  pm2 restart dealer-dxb            # Hard restart
  pm2 reload dealer-dxb             # Zero-downtime reload
  pm2 show dealer-dxb               # Detailed info
  ```

  ---

  ## Nginx Commands

  ```bash
  nginx -t                           # Test config
  systemctl restart nginx            # Restart
  systemctl reload nginx             # Reload without downtime
  tail -f /var/log/nginx/error.log   # Error logs
  ```

  ---

  ## Important Notes

  - **`proxy_buffering off`** is required in Nginx for NDJSON streaming to work in real-time
  - **`proxy_read_timeout 300s`** is required — Netflix operations can take up to 30 seconds each, and bulk runs can take many minutes
  - **Frontend build output** goes to `public/` — do NOT put static files there directly (Vite wipes it). Put static files in `client/public/` instead
  - **MongoDB settings** take effect immediately without restart — adjust concurrency and costs via the Admin panel
  