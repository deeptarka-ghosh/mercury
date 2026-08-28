# Mercury — Deployment Guide

> **Status:** Stage B (planned). This document describes the intended production deployment for when a Hostinger VPS becomes available. No infrastructure has been provisioned yet.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Hostinger VPS Prerequisites](#2-hostinger-vps-prerequisites)
3. [Node.js / Application Deployment](#3-nodejs--application-deployment)
4. [Production Environment Variables](#4-production-environment-variables)
5. [PostgreSQL Production Setup](#5-postgresql-production-setup)
6. [Database Migration Procedure](#6-database-migration-procedure)
7. [Reverse Proxy (Nginx)](#7-reverse-proxy-nginx)
8. [TLS / HTTPS](#8-tls--https)
9. [DNS](#9-dns)
10. [Firewall / Network Security](#10-firewall--network-security)
11. [Process Management (systemd)](#11-process-management-systemd)
12. [First Deployment Runbook](#12-first-deployment-runbook)
13. [Subsequent Deployment Runbook](#13-subsequent-deployment-runbook)
14. [Rollback Procedure](#14-rollback-procedure)
15. [CI/CD (Future Work)](#15-cicd-future-work)

---

## 1. Architecture Overview

```
Internet
   │
   ▼
  DNS (A record → VPS IPv4)
   │
   ▼
  Firewall (ports 22, 80, 443 open)
   │
   ▼
  Reverse Proxy (Nginx) — port 80/443
   │  ┌─ HTTP → 301 redirect to HTTPS
   │  └─ HTTPS → proxy_pass http://127.0.0.1:3000
   │
   ▼
  Mercury (Node.js) — port 3000, listens on 127.0.0.1 only
   │
   ▼
  PostgreSQL — port 5432, listens on 127.0.0.1 only
```

### Component responsibilities

| Component | Public | Port | Notes |
|-----------|--------|------|-------|
| **Nginx** | Yes (80/443) | 80, 443 | Terminates TLS, proxies to Mercury |
| **Mercury** | No | 3000 | Binds to 127.0.0.1 only; all business logic |
| **PostgreSQL** | No | 5432 | Binds to 127.0.0.1 only; no network exposure |

### What is already provisioned

- Mercury application source code
- All 19 migrations applied to the database schema
- All application-level hardening (Helmet, rate limiting, body limits, production config validation)

### What must be provisioned (this document)

- Hostinger VPS
- Domain name + DNS
- Runtime (Node.js, PostgreSQL)
- Reverse proxy (Nginx)
- TLS certificates (Let's Encrypt)
- systemd service
- Backups

---

## 2. Hostinger VPS Prerequisites

### Recommended OS

- **Ubuntu 24.04 LTS** (Noble) — well-supported, long-term stability, current Node.js and PostgreSQL packages available.

### Minimum resources

| Resource | Minimum | Notes |
|----------|---------|-------|
| **CPU** | 1 vCPU | Sufficient for single-process Mercury |
| **RAM** | 2 GB | PostgreSQL + Node.js + OS overhead |
| **Storage** | 20 GB | OS + application + database + logs |
| **Bandwidth** | 1 TB/month | Adequate for small-to-medium ecommerce |

*A Hostinger VPS is not yet purchased. These are guidance, not a binding requirement.*

### Required software

| Software | Version | Notes |
|----------|---------|-------|
| **Node.js** | >= 24.19.0 | Check `engines` in `package.json` |
| **npm** | Bundled | Used for dependency install and scripts |
| **PostgreSQL** | >= 16 | Compatible with Kysely + `pg` driver |
| **Nginx** | Latest stable | Reverse proxy + TLS termination |
| **systemd** | Built-in | Process management |

### System user

Create a dedicated system user:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin mercury
sudo usermod -aG mercury mercury
```

### Application directory

```
/opt/mercury/
├── current/          → symlink to the active release
├── releases/         → timestamped releases
├── .env              → production environment (outside version control)
├── dist/             → compiled JS (inside current/)
└── node_modules/     → installed dependencies (inside current/)
```

### Log locations

| Component | Location |
|-----------|----------|
| Mercury (stdout) | `journalctl -u mercury` |
| Nginx access | `/var/log/nginx/access.log` |
| Nginx error | `/var/log/nginx/error.log` |
| PostgreSQL | `/var/log/postgresql/postgresql-16-main.log` |

---

## 3. Node.js / Application Deployment

### Version requirements

From `package.json`:

```
"engines": { "node": ">=24.19.0" }
```

### Dependencies

**Production** (installed via `npm install --omit=dev`):

| Package | Purpose |
|---------|---------|
| `bcrypt` | Password hashing |
| `dotenv` | Load `.env` file |
| `env-var` | Typed env var access |
| `express` | HTTP framework |
| `helmet` | Security headers |
| `jsonwebtoken` | JWT creation/verification |
| `kysely` | SQL query builder |
| `pg` | PostgreSQL driver |
| `pino` | Structured logging |

**Dev dependencies** are NOT required at runtime.

### Build and start

```bash
# From the application directory:
npm install --omit=dev
npm run build
node dist/index.js
```

Or via the npm script:

```bash
npm run start
```

### Production start command

```
node dist/index.js
```

### Working directory

The application resolves migrations relative to `dist/migrations/` using `__dirname`. It must be started from the project root (where `package.json`, `dist/`, `node_modules/` live).

### Graceful shutdown

Mercury handles `SIGTERM` and `SIGINT`:
1. Closes the HTTP server (stops accepting new connections)
2. Destroys the database pool
3. Exits with code 0

A 10-second forced-exit timer prevents hanging.

---

## 4. Production Environment Variables

### Required variables

| Variable | Required | Secret | Production value |
|----------|----------|--------|-----------------|
| `NODE_ENV` | Yes | No | `production` |
| `DATABASE_URL` | Yes | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Yes | 64+ character random string |

### Optional variables

| Variable | Default | Secret | Notes |
|----------|---------|--------|-------|
| `PORT` | `3000` | No | Internal port; Nginx proxies to this |
| `HOST` | `127.0.0.1` | No | Bind to localhost for production |
| `LOG_LEVEL` | `info` | No | `warn` in production recommended |
| `API_VERSION` | `1` | No | Bump on breaking API changes |
| `DB_POOL_SIZE` | `10` | No | Adjust based on connection limits |
| `BCRYPT_ROUNDS` | `12` | No | 12-14 recommended |
| `JWT_ISSUER` | `mercury` | No | JWT `iss` claim |
| `JWT_ACCESS_EXPIRY` | `15m` | No | Short-lived access tokens |
| `JWT_REFRESH_EXPIRY` | `7d` | No | Longer-lived refresh tokens |
| `ADMIN_BOOTSTRAP_EMAIL` | — | No | Optional; set only for first admin |
| `ADMIN_BOOTSTRAP_PASSWORD` | — | Yes | Set only for first admin; unset after |

### Critical: never use development defaults in production

Mercury includes `validateProductionConfig()` in `src/config/env.ts` that fails fast on startup if:

- `JWT_SECRET` is still the dev default `dev-secret-do-not-use-in-production`
- `DATABASE_URL` is still the dev default `postgresql://localhost:5432/mercury_dev`

### Generating secrets

```bash
# Generate a JWT_SECRET
openssl rand -base64 48
```

### Example `.env` for production

```bash
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
LOG_LEVEL=warn
API_VERSION=1
DATABASE_URL=postgresql://mercury:YOUR_DB_PASSWORD@127.0.0.1:5432/mercury
DB_POOL_SIZE=10
BCRYPT_ROUNDS=12
JWT_SECRET=replace-with-output-of-openssl-rand-base64-48
JWT_ISSUER=mercury
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
# Leave these empty after first admin is created:
ADMIN_BOOTSTRAP_EMAIL=
ADMIN_BOOTSTRAP_PASSWORD=
```

Place this file at `/opt/mercury/.env`. It is outside version control. Set permissions:

```bash
sudo chown mercury:mercury /opt/mercury/.env
sudo chmod 600 /opt/mercury/.env
```

---

## 5. PostgreSQL Production Setup

### Installation

```bash
sudo apt update
sudo apt install postgresql-16 postgresql-client-16
```

### Database creation

```bash
sudo -u postgres psql
```

```sql
CREATE USER mercury WITH PASSWORD 'strong-password';
CREATE DATABASE mercury OWNER mercury;
ALTER DATABASE mercury SET timezone TO 'UTC';
```

### Connection configuration

Edit `/etc/postgresql/16/main/postgresql.conf`:

```ini
listen_addresses = 'localhost'
port = 5432
max_connections = 100
```

Edit `/etc/postgresql/16/main/pg_hba.conf`:

```
# TYPE  DATABASE  USER     ADDRESS         METHOD
local   mercury   mercury                 scram-sha-256
host    mercury   mercury  127.0.0.1/32   scram-sha-256
```

### Migration execution

```bash
cd /opt/mercury/current
sudo -u mercury npm run migrate
```

### Verify migration status

```bash
sudo -u mercury npm run migrate:list
```

All 19 migrations should show `executed: true`.

### Connection pooling

Mercury uses Kysely with `pg.Pool` (default pool size: 10). This is adequate for a single-VPS deployment. The pool size is configurable via `DB_POOL_SIZE`.

### Backup requirement

PostgreSQL backups must be configured before going live. See [Backup section in operations.md](operations.md#5-backups).

---

## 6. Database Migration Procedure

### Migration chain

The complete migration chain (19 migrations in order):

```
001_create_users
002_create_refresh_tokens
003_create_profiles
004_create_categories
005_create_products
006_create_inventory
007_create_prices
008_create_cart_items
009_create_orders (+ order_items)
010_create_payments
011_create_order_shipping
012_drop_default_country_code
013_create_notifications
014_create_search_indexes (pg_trgm)
015_create_reviews
016_create_wishlist_items
017_add_user_role
018_create_audit_log
019_add_performance_indexes
```

All migrations are in `src/migrations/` and use Kysely's `FileMigrationProvider`.

### Safe migration procedure

1. **Backup the database** before any migration.
2. **Verify current state** with `npm run migrate:list`.
3. **Run pending migrations** with `npm run migrate`.
4. **Verify result** with `npm run migrate:list` — all should show `Success`.
5. **Smoke test** the application.

### Migration lock behavior

Kysely's `Migrator` uses a `kysely_migration_lock` table with a `LOCK TABLE` strategy. This prevents concurrent migration runs on the same database. If a migration fails, the lock is released. You must manually resolve the failure before running migrations again.

### Handling migration failure

- Check the error message — it will identify the failed migration
- Resolve the issue (incorrect data, constraint violation, etc.)
- Run `npm run migrate` again — it will re-attempt the failed migration
- If the migration partially applied, you may need to create a compensating migration

### Rollback strategy

**Kysely's built-in migration down is NOT available as a general-purpose rollback tool.** The `npm run migrate:down` script runs a single `down()` step, but:

- Down migrations are not tested in CI
- Down migrations may fail if production data violates constraints
- Down migrations cannot restore data that was deleted by the `up()` migration

**Preferred rollback approach:**

1. **Restore from backup** (the only reliable rollback)
2. Apply the previous application version
3. Verify

### Manual schema edits

Never make manual schema changes to the production database. Always create a new migration file. This ensures the migration chain stays consistent across environments.

---

## 7. Reverse Proxy (Nginx)

### Architecture

Nginx is the recommended reverse proxy for a single-VPS deployment. It handles TLS termination, forwards requests to Mercury, and serves error pages.

### Nginx configuration

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Security
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;

    # Proxy to Mercury
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeouts
        proxy_connect_timeout 30s;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }

    # Request size — matches Mercury's 100kb body limit
    client_max_body_size 100k;

    # Access/error logs
    access_log /var/log/nginx/mercury-access.log;
    error_log  /var/log/nginx/mercury-error.log;
}
```

### Important notes

- `client_max_body_size` must match Mercury's `express.json({ limit: '100kb' })` — set to `100k`.
- Mercury already sets security headers via Helmet. Nginx does not need to duplicate them, but it can override them if desired.
- No WebSocket support is needed — Mercury does not use WebSockets.

---

## 8. TLS / HTTPS

### Certificate acquisition

Use Let's Encrypt with Certbot:

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com
```

### Automatic renewal

Certbot installs a systemd timer by default:

```bash
sudo systemctl status certbot.timer
```

The certificate is automatically renewed. No manual intervention is required.

### HTTP → HTTPS redirect

Handled by the Nginx configuration above (port 80 → 301 redirect).

### HSTS

Helmet already sets the `Strict-Transport-Security` header with a 1-year max-age. This is visible in production responses.

### Verification

```bash
curl -I https://yourdomain.com/health
```

Expected:

```
HTTP/2 200
strict-transport-security: max-age=31536000; includeSubDomains
```

---

## 9. DNS

### Required records

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | `@` | `<VPS IPv4 address>` | 300 |
| AAAA | `@` | `<VPS IPv6 address>` (optional) | 300 |

### Verification

```bash
dig +short yourdomain.com
curl -I http://yourdomain.com/health    # Should redirect to HTTPS
curl -I https://yourdomain.com/health   # Should return 200
```

---

## 10. Firewall / Network Security

### Required open ports

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Your IP only | SSH |
| 80 | TCP | 0.0.0.0/0 | HTTP → HTTPS redirect |
| 443 | TCP | 0.0.0.0/0 | HTTPS |

### UFW configuration

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from YOUR_IP to any port 22 proto tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### What must NOT be exposed

- **Mercury (port 3000)**: Binds to `127.0.0.1` only, not reachable from outside
- **PostgreSQL (port 5432)**: Binds to `127.0.0.1` only, not reachable from outside

---

## 11. Process Management (systemd)

### systemd service

Create `/etc/systemd/system/mercury.service`:

```ini
[Unit]
Description=Mercury Ecommerce Engine
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=exec
User=mercury
Group=mercury
WorkingDirectory=/opt/mercury/current
EnvironmentFile=/opt/mercury/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/mercury

[Install]
WantedBy=multi-user.target
```

### Commands

```bash
sudo systemctl daemon-reload
sudo systemctl enable mercury
sudo systemctl start mercury
sudo systemctl status mercury
sudo journalctl -u mercury -f
```

### Restart

```bash
sudo systemctl restart mercury
```

### Deployment restart procedure

```bash
sudo systemctl stop mercury
# deploy new code
sudo systemctl start mercury
sudo journalctl -u mercury -f --since "30 seconds ago"  # verify startup
```

---

## 12. First Deployment Runbook

### Phase 1: Provision

1. Purchase Hostinger VPS (recommended: Ubuntu 24.04, 2 GB RAM)
2. Note the VPS IPv4 address
3. Configure SSH key access

### Phase 2: Secure server

4. Update system: `sudo apt update && sudo apt upgrade -y`
5. Configure UFW firewall (see §10)
6. Create `mercury` system user
7. Disable password-based SSH login (if not already)

### Phase 3: Install runtime

8. Install Node.js 24+:
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
   sudo apt install -y nodejs
   ```
9. Install PostgreSQL 16:
   ```bash
   sudo apt install -y postgresql-16
   ```
10. Install Nginx:
    ```bash
    sudo apt install -y nginx
    ```

### Phase 4: Configure PostgreSQL

11. Create database and user (see §5)
12. Verify connection

### Phase 5: Deploy application

13. Create `/opt/mercury/` directory structure
14. Upload source or clone from repository
15. Create `/opt/mercury/.env` with production values (see §4)
16. Set permissions: `chown -R mercury:mercury /opt/mercury` and `chmod 600 /opt/mercury/.env`
17. Install production dependencies: `sudo -u mercury npm install --omit=dev`
18. Build: `sudo -u mercury npm run build`
19. Run migrations: `sudo -u mercury npm run migrate`
20. Verify migration status: `sudo -u mercury npm run migrate:list`

### Phase 6: Configure process management

21. Install systemd service (see §11)
22. Start and enable: `sudo systemctl enable --now mercury`
23. Verify: `sudo journalctl -u mercury -f`

### Phase 7: Configure reverse proxy

24. Install Nginx config (see §7)
25. Test: `sudo nginx -t`
26. Enable: `sudo systemctl enable --now nginx`

### Phase 8: DNS + TLS

27. Configure DNS A record pointing to VPS IPv4
28. Wait for propagation
29. Run Certbot: `sudo certbot --nginx -d yourdomain.com`
30. Verify automatic renewal

### Phase 9: Verify

31. `curl https://yourdomain.com/health` → `{"status":"ok",...}`
32. Register a new user
33. Login, browse products, checkout
34. Admin access works
35. Audit log entries visible
36. `sudo journalctl -u mercury -f` shows no errors

### Phase 10: Configure backups

37. Set up PostgreSQL backup (see operations.md §5)
38. Test restore procedure

---

## 13. Subsequent Deployment Runbook

For code updates after the first deployment:

```bash
# 1. Backup database
sudo -u postgres pg_dump -Fc mercury > /backups/mercury-pre-deploy-$(date +%Y%m%d%H%M%S).dump

# 2. Deploy code
cd /opt/mercury
# Upload/clone new source to a new release directory
# OR git pull in the current directory

# 3. Install dependencies if changed
sudo -u mercury npm install --omit=dev

# 4. Build
sudo -u mercury npm run build

# 5. Run migrations
sudo -u mercury npm run migrate

# 6. Restart
sudo systemctl restart mercury

# 7. Verify health
sleep 2
curl -f http://127.0.0.1:3000/health || echo "Health check failed"

# 8. Smoke test
# Manual: login, browse, checkout
```

---

## 14. Rollback Procedure

### Application rollback

```bash
# 1. Restore previous release
# If using releases/ directory structure:
sudo rm /opt/mercury/current
sudo ln -s /opt/mercury/releases/previous-timestamp /opt/mercury/current

# 2. Restart
sudo systemctl restart mercury

# 3. Verify
curl -f http://127.0.0.1:3000/health
```

### Database rollback

**Primary method:** Restore from backup.

```bash
sudo -u postgres pg_restore -d mercury --clean /backups/mercury-before-deploy.dump
```

**Down migration** (use only if you understand the risks):
1. `npm run migrate:down` — runs the most recent `down()` function
2. Verify the migration was removed from `kysely_migration`
3. Note: this is not reliable if the migration deleted data or changed structure

### Configuration rollback

```bash
# Restore previous .env file
sudo cp /opt/mercury/.env.bak /opt/mercury/.env
sudo systemctl restart mercury
```

### Emergency recovery

If the application fails to start after deployment:

1. Check logs: `sudo journalctl -u mercury -e`
2. If it's a configuration issue, correct `.env` and restart
3. If it's a code issue, roll back to the previous release
4. If the database is corrupted, restore from the most recent backup
5. If the VPS is unreachable, use Hostinger's out-of-band console

---

## 15. CI/CD (Future Work)

### Not yet implemented

Mercury does not currently have CI/CD configuration. The following is a recommendation for when a CI/CD platform is added.

### Pipeline stages

```yaml
# .github/workflows/ci.yml (example)
name: CI
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_DB: mercury_test
          POSTGRES_USER: mercury
          POSTGRES_PASSWORD: mercury
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run migrate
        env:
          DATABASE_URL: postgresql://mercury:mercury@localhost:5432/mercury_test
      - run: npm run test
        env:
          DATABASE_URL: postgresql://mercury:mercury@localhost:5432/mercury_test
      - run: npm run build
```

### Deployment trigger

After CI passes on `main`, a deployment could be triggered:

```yaml
  deploy:
    needs: verify
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: ssh mercury@vps 'cd /opt/mercury && git pull && npm ci --omit=dev && npm run build && npm run migrate && sudo systemctl restart mercury'
```

This is a simplified example. A production deployment pipeline should include secrets management, pre-deployment backup, and automated health verification.