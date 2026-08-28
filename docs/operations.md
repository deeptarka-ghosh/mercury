# Mercury — Operations Guide

> **Status:** Stage B (planned). This document describes the intended production operations procedures for when a Hostinger VPS becomes available. No infrastructure has been provisioned yet.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Monitoring / Health](#2-monitoring--health)
3. [Logging](#3-logging)
4. [Process Management](#4-process-management)
5. [Backups](#5-backups)
6. [Restore Procedure](#6-restore-procedure)
7. [PostgreSQL Maintenance](#7-postgresql-maintenance)
8. [Security Considerations](#8-security-considerations)
9. [Operational Runbook](#9-operational-runbook)
10. [Disaster / Recovery Planning](#10-disaster--recovery-planning)

---

## 1. System Overview

### Components

| Component | Version | Role |
|-----------|---------|------|
| **Mercury** | 0.1.0 | Node.js ecommerce API (Express 5) |
| **PostgreSQL** | 16+ | Relational database |
| **Nginx** | Latest stable | Reverse proxy, TLS termination |
| **systemd** | Built-in | Process management |
| **Let's Encrypt** | Certbot | TLS certificate management |

### Ports

| Service | Port | Bind | Public |
|---------|------|------|--------|
| Nginx (HTTP) | 80 | 0.0.0.0 | Yes (redirect) |
| Nginx (HTTPS) | 443 | 0.0.0.0 | Yes |
| Mercury | 3000 | 127.0.0.1 | No |
| PostgreSQL | 5432 | 127.0.0.1 | No |

### File locations

```
/opt/mercury/
├── current/          → symlink to active release
├── releases/         → timestamped releases
├── .env              → production environment secrets
└── dist/ → migrations/  → compiled migration files

/var/log/nginx/
├── mercury-access.log
└── mercury-error.log

/etc/systemd/system/mercury.service
/etc/nginx/sites-available/mercury
/etc/letsencrypt/live/yourdomain.com/
```

---

## 2. Monitoring / Health

### GET /health

The health endpoint is implemented in `src/routes/health.ts`:

```json
{
  "status": "ok",
  "uptime": 123.45,
  "timestamp": "2026-08-28T12:00:00.000Z",
  "version": "1"
}
```

#### What it proves

- The application is running and responding to HTTP requests
- The Express middleware chain is intact
- Environment configuration loaded successfully
- The process has been running for the reported uptime

#### What it does NOT prove

- Database connectivity (no DB query is performed)
- Database migration status
- Database backup freshness
- Reverse proxy configuration
- TLS certificate validity (that's Nginx's responsibility)
- Disk space, memory, or CPU health

### Recommended monitoring

```bash
# Cron-based health check (every 5 minutes)
*/5 * * * * curl -f http://127.0.0.1:3000/health || systemctl restart mercury
```

### Uptime Monitoring

Consider an external uptime monitoring service (e.g., UptimeRobot, Pingdom) that checks `https://yourdomain.com/health` every 5 minutes.

### Restart detection

systemd automatically restarts Mercury on crash (`Restart=always`). Monitor `journalctl` for restart events:

```bash
journalctl -u mercury -g "Server started" --since "24 hours ago"
```

---

## 3. Logging

### Application logs

Mercury uses **pino** for structured JSON logging. In production, logs are written to stdout and captured by systemd journal.

```json
{"level":30,"time":1724850000000,"pid":1234,"hostname":"mercury-vps","method":"GET","url":"/health","status":200,"durationMs":3,"msg":"GET /health 200 3ms"}
```

#### Log levels

| Level | Value | Usage |
|-------|-------|-------|
| `fatal` | 60 | Unrecoverable errors |
| `error` | 50 | Operational errors |
| `warn` | 40 | Deprecations, unusual conditions |
| `info` | 30 | Normal operations (startup, requests) |
| `debug` | 20 | Detailed debugging |
| `trace` | 10 | Very detailed debugging |

Production recommendation: `LOG_LEVEL=warn` (reduces noise, logs errors and above).

#### What is logged for each request

- `method` (GET, POST, etc.)
- `url` (path only, no query parameters with secrets)
- `status` (HTTP status code)
- `durationMs` (response time in milliseconds)

#### What is NEVER logged

- Passwords or password hashes
- JWT access tokens
- Refresh tokens
- Authorization header values
- Payment credentials
- Bootstrap admin credentials
- Environment variables
- Secrets of any kind

#### Viewing logs

```bash
# Follow live logs
journalctl -u mercury -f

# Last 100 lines
journalctl -u mercury -n 100

# Today's logs
journalctl -u mercury --since today

# Logs since a specific time
journalctl -u mercury --since "10 minutes ago"

# JSON logs (filter with jq)
journalctl -u mercury --since today -o json | jq '. | select(.status >= 500)'
```

### Nginx access logs

Standard Nginx combined log format. Location: `/var/log/nginx/mercury-access.log`.

### Nginx error logs

Location: `/var/log/nginx/mercury-error.log`.

### PostgreSQL logs

Location: `/var/log/postgresql/postgresql-16-main.log`.

### Log rotation

- **systemd journal**: automatically rotated and limited (`SystemMaxUse=1G` in `/etc/systemd/journald.conf`)
- **Nginx**: `logrotate` handles rotation (default configuration)
- **PostgreSQL**: `logrotate` handles rotation (default configuration)

No manual rotation is required unless custom log locations are configured.

---

## 4. Process Management

### systemd service

The Mercury service is managed by systemd. See `deployment.md §11` for the service file.

### Common commands

```bash
# Status
sudo systemctl status mercury

# Start
sudo systemctl start mercury

# Stop
sudo systemctl stop mercury

# Restart
sudo systemctl restart mercury

# Enable on boot
sudo systemctl enable mercury

# Disable on boot
sudo systemctl disable mercury

# View logs
sudo journalctl -u mercury -f
```

### Status interpretation

```
● mercury.service - Mercury Ecommerce Engine
     Loaded: loaded (/etc/systemd/system/mercury.service; enabled; vendor preset: enabled)
     Active: active (running) since Thu 2026-08-28 12:00:00 UTC; 1h 30min ago
   Main PID: 1234 (node)
      Tasks: 11 (limit: 2345)
     Memory: 85.2M
        CPU: 2.345s
```

- **Active: running** → Healthy
- **Active: exited** → Process exited unexpectedly (check `journalctl -u mercury -e`)
- **Failed** → Could not start or crashed

### Crash recovery

`Restart=always` in the service file means systemd will restart Mercury on any crash. After 5 restarts within 10 seconds, systemd enters a waiting state (restart delay escalates). This prevents restart loops.

If Mercury is failing to start:

1. Check `.env` configuration
2. Check PostgreSQL connectivity
3. Check migration status
4. Check logs: `journalctl -u mercury -e`

---

## 5. Backups

### PostgreSQL backup

#### Automated daily backup (pg_dump)

Create `/etc/cron.daily/mercury-backup`:

```bash
#!/bin/bash
BACKUP_DIR="/backups/mercury"
RETENTION_DAYS=30

mkdir -p "$BACKUP_DIR"

# Dump database
pg_dump -Fc mercury > "$BACKUP_DIR/mercury-$(date +%Y%m%d%H%M%S).dump"

# Remove backups older than retention period
find "$BACKUP_DIR" -name "*.dump" -mtime +$RETENTION_DAYS -delete

# Log
echo "$(date): Backed up mercury to $BACKUP_DIR" >> /var/log/mercury-backup.log
```

Make executable:

```bash
sudo chmod +x /etc/cron.daily/mercury-backup
```

#### Retention

- **Frequency**: Daily
- **Retention**: 30 days (configurable)
- **Storage**: `/backups/mercury/` on the VPS

#### Off-server backup (recommended)

For true disaster recovery, backups should be copied off the VPS:

```bash
# Example: rsync to another server
rsync -avz /backups/mercury/ user@backup-server:/backups/mercury/

# Or: upload to object storage (future)
```

This is a recommendation; it is not currently configured.

#### Backup security

- Backup files contain database credentials and user data
- Restrict access: `chmod 600 /backups/mercury/*.dump`
- Consider encrypting backups: `gpg -c --batch --passphrase "..." backup.dump`

### Critical rule

> **A backup that has never been restored is not considered verified.**

Test your restore procedure at least quarterly.

---

## 6. Restore Procedure

### Full restore

```bash
# 1. Stop the application
sudo systemctl stop mercury

# 2. Drop and recreate the database
sudo -u postgres psql -c "DROP DATABASE IF EXISTS mercury;"
sudo -u postgres psql -c "CREATE DATABASE mercury OWNER mercury;"

# 3. Restore from backup
sudo -u postgres pg_restore -d mercury --clean --if-exists \
  /backups/mercury/mercury-20260828-120000.dump

# 4. Start the application
sudo systemctl start mercury

# 5. Verify
curl -f http://127.0.0.1:3000/health
```

### Granular restore (single table)

```bash
# Extract a single table
pg_restore -d mercury --clean --if-exists --table=products \
  /backups/mercury/mercury-20260828-120000.dump
```

### Point-in-time recovery (PITR)

PITR is not currently configured. It requires:

- `wal_level = replica` in `postgresql.conf`
- Continuous WAL archiving
- A base backup

If PITR is needed, it must be configured before the failure occurs. This is deferred.

---

## 7. PostgreSQL Maintenance

### Connection monitoring

```bash
# Active connections
sudo -u postgres psql -c "SELECT count(*) FROM pg_stat_activity WHERE datname = 'mercury';"

# Long-running queries
sudo -u postgres psql -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state FROM pg_stat_activity WHERE state != 'idle' AND datname = 'mercury' ORDER BY duration DESC;"
```

### Vacuuming

PostgreSQL auto-vacuum handles routine maintenance. Monitor:

```bash
sudo -u postgres psql -c "SELECT relname, n_dead_tup, last_vacuum, last_autovacuum FROM pg_stat_user_tables WHERE n_dead_tup > 1000;"
```

### Index health

```bash
sudo -u postgres psql -c "SELECT schemaname, tablename, indexname, idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes ORDER BY idx_scan;"
```

### Disk usage

```bash
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('mercury')) AS database_size;"
sudo -u postgres psql -c "SELECT relname, pg_size_pretty(pg_relation_size(relid)) AS table_size FROM pg_stat_user_tables ORDER BY pg_relation_size(relid) DESC;"
```

### Migration verification

```bash
sudo -u postgres psql -d mercury -c "SELECT name, executed_at, migration_name FROM kysely_migration ORDER BY id;"
```

All 19 migrations should be present.

---

## 8. Security Considerations

### Current security posture

| Area | Implementation | Status |
|------|---------------|--------|
| **Password hashing** | bcrypt, 12 rounds | ✅ |
| **JWT signing** | HMAC-SHA256, configurable secret | ✅ |
| **JWT validation** | Signature + issuer + type + expiration | ✅ |
| **Refresh token hashing** | SHA-256 of token stored in DB | ✅ |
| **Refresh rotation** | Delete old + insert new in transaction (FOR UPDATE) | ✅ |
| **Replay protection** | One-time use; rotated tokens are invalidated | ✅ |
| **Concurrent refresh** | FOR UPDATE prevents race conditions | ✅ |
| **Authorization** | DB-authoritative role lookup (`authorize('admin')`) | ✅ |
| **Ownership isolation** | All user-owned resources scoped by user_id in WHERE clause | ✅ |
| **Rate limiting** | In-memory sliding-window; 10-30 req/min per endpoint | ✅ |
| **Security headers** | Helmet (X-Content-Type-Options, X-Frame-Options, HSTS, etc.) | ✅ |
| **Body size limit** | 100kb via `express.json({ limit: '100kb' })` | ✅ |
| **413 handling** | Entity too large → structured JSON error response | ✅ |
| **SQL injection** | All queries parameterized via Kysely or raw `$N` placeholders | ✅ |
| **DB constraints** | UNIQUE, CHECK, FK, ON DELETE CASCADE/RESTRICT/SET NULL | ✅ |
| **Transaction isolation** | FOR UPDATE used in checkout, payments, shipping, refresh | ✅ |
| **Production config validation** | Fails fast on dev defaults in production mode | ✅ |
| **Error responses** | No stack traces, no internals, no secrets | ✅ |
| **Logging** | No secrets logged; only method/url/status/duration | ✅ |
| **Dependency audit** | `npm audit` — 0 vulnerabilities | ✅ |
| **CORS** | Not configured (no frontend yet) | ⚪️ Deferred |

### Rate limiter limitation

> **The current rate limiter is process-local.** All entries are stored in an in-memory `Map`. If Mercury is scaled to multiple processes or instances, the rate limit counters will not be shared. Each process has its own budget.

If multi-process deployment becomes necessary, the rate limiter must be replaced with a shared store (Redis, PostgreSQL, or similar). For a single-process systemd deployment, the in-memory limiter is adequate.

### Common maintenance tasks

#### Checking for known vulnerabilities

```bash
cd /opt/mercury/current
npm audit
```

Run this after each deployment and periodically (monthly) to check for vulnerabilities in production dependencies.

#### Verifying configuration

```bash
# Verify .env permissions
ls -la /opt/mercury/.env
# Should show: -rw------- 1 mercury mercury ...

# Verify no secrets in logs
sudo journalctl -u mercury | grep -i "secret\|password\|token\|jwt"
# Should produce no output
```

#### Certificate renewal check

```bash
sudo certbot renew --dry-run
```

---

## 9. Operational Runbook

### Routine procedures

#### Restart

```bash
sudo systemctl restart mercury
sudo journalctl -u mercury -f --since "30 seconds ago"
```

#### Application update

See [Subsequent Deployment Runbook](deployment.md#13-subsequent-deployment-runbook).

#### Migration

```bash
# 1. Backup
sudo -u postgres pg_dump -Fc mercury > /backups/mercury/pre-migrate-$(date +%Y%m%d%H%M%S).dump

# 2. Check current state
cd /opt/mercury/current
sudo -u mercury npm run migrate:list

# 3. Run pending
sudo -u mercury npm run migrate

# 4. Verify
sudo -u mercury npm run migrate:list
```

#### Rollback

See [Rollback Procedure](deployment.md#14-rollback-procedure).

#### Backup

```bash
# Manual backup
sudo -u postgres pg_dump -Fc mercury > /backups/mercury/manual-$(date +%Y%m%d%H%M%S).dump
```

#### Restore

See [Restore Procedure](#6-restore-procedure).

#### Log inspection

```bash
# Application errors today
sudo journalctl -u mercury --since today -p err

# 500 errors
sudo journalctl -u mercury --since today -o json | jq 'select(.status >= 500)'

# Nginx errors
tail -f /var/log/nginx/mercury-error.log

# PostgreSQL errors
tail -f /var/log/postgresql/postgresql-16-main.log
```

#### Health verification

```bash
curl -f https://yourdomain.com/health
curl -f https://yourdomain.com/products
curl -f https://yourdomain.com/categories
```

#### Disk usage

```bash
df -h
du -sh /opt/mercury/
du -sh /backups/
du -sh /var/log/
```

#### Memory/CPU

```bash
top -b -n 1 | head -10
free -h
```

#### PostgreSQL maintenance

```bash
# Check for long-running queries
sudo -u postgres psql -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state FROM pg_stat_activity WHERE state != 'idle' AND datname = 'mercury' ORDER BY duration DESC;"
```

---

## 10. Disaster / Recovery Planning

### Application crash

| Step | Action |
|------|--------|
| **Detection** | systemd `Restart=always` restarts automatically; external monitoring alerts |
| **Immediate** | `journalctl -u mercury -e` to see crash reason |
| **Recovery** | Most crashes are transient; systemd handles restart. If persistent, check config, DB connection, and disk space. |
| **Verification** | `curl -f http://127.0.0.1:3000/health` and `systemctl status mercury` |

### VPS failure

| Step | Action |
|------|--------|
| **Detection** | External monitoring timeout; SSH failure; Hostinger support ticket |
| **Immediate** | Check Hostinger status page; reboot via Hostinger control panel |
| **Recovery** | If VPS is unrecoverable, provision a new VPS, restore from backup (see §6) |
| **Verification** | DNS propagation check; health endpoint; manual smoke test |

### PostgreSQL corruption

| Step | Action |
|------|--------|
| **Detection** | Application 500 errors; `journalctl` shows DB errors; `pg_isready` may fail |
| **Immediate** | Stop Mercury: `sudo systemctl stop mercury` |
| **Recovery** | Restore from most recent backup (see §6) |
| **Verification** | Start Mercury; verify health; run smoke tests |

### Accidental data deletion

| Step | Action |
|------|--------|
| **Detection** | User reports missing data; admin notices |
| **Immediate** | Stop the application: `sudo systemctl stop mercury` |
| **Recovery** | Restore from backup (full restore or single-table restore) |
| **Verification** | Confirm data is restored; identify root cause |

### Expired TLS certificate

| Step | Action |
|------|--------|
| **Detection** | Users see certificate warnings; monitoring alerts; Certbot cron failure |
| **Immediate** | Run `sudo certbot renew` manually |
| **Recovery** | If automatic renewal failed, check for port 80/443 accessibility and DNS resolution |
| **Verification** | `curl -I https://yourdomain.com/health` shows valid certificate |
| **Prevention** | Certbot auto-renewal timer; monitor `certbot renew --dry-run` output |

### Full disk

| Step | Action |
|------|--------|
| **Detection** | Application crash; `journalctl` shows disk errors; monitoring alerts |
| **Immediate** | Find large files: `du -sh /* 2>/dev/null \| sort -rh \| head -10` |
| **Recovery** | Remove old backups, logs, or temporary files. If PostgreSQL is full, you may need to free space before it can restart. |
| **Verification** | `df -h` shows available space; restart Mercury |
| **Prevention** | Monitor disk usage; set up log rotation; limit backup retention |

### Bad deployment

| Step | Action |
|------|--------|
| **Detection** | Health check fails after deployment; smoke tests fail |
| **Immediate** | `sudo systemctl stop mercury` |
| **Recovery** | Roll back to previous release (see [deployment.md §14](deployment.md#14-rollback-procedure)) |
| **Verification** | Health check; smoke test |

### Compromised credentials

| Step | Action |
|------|--------|
| **Detection** | Suspicious activity; unauthorized access logs |
| **Immediate** | Revoke compromised credentials (SSH key, DB password, JWT_SECRET) |
| **Recovery** | 1. Rotate `JWT_SECRET` (all existing tokens become invalid, users must re-login) |
| | 2. Rotate `DATABASE_URL` password |
| | 3. Rotate SSH keys |
| | 4. Rotate admin bootstrap password |
| | 5. Check `audit_log` for suspicious activity |
| **Verification** | Verify new credentials work; confirm old credentials are rejected |
| **Prevention** | SSH key-only auth; strong passwords; regular credential rotation |

### Lost SSH access

| Step | Action |
|------|--------|
| **Detection** | `ssh: connect to host port 22: Connection refused` |
| **Immediate** | Check from multiple networks (firewall may have changed) |
| **Recovery** | Use Hostinger out-of-band console (VPS panel → Browser console) |
| **Verification** | Once logged in via console, fix SSH/firewall configuration |
| **Prevention** | Always have a backup SSH session when changing firewall rules; use Hostinger's console as fallback