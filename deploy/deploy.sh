#!/bin/bash
# ==============================================================
# CloudPi — Deploy Script (run on Raspberry Pi)
# ==============================================================
# This script automates the full migration from PM2 to systemd.
#
# Usage:
#   chmod +x deploy.sh
#   sudo ./deploy.sh
#
# Prerequisites:
#   - Frontend already built (frontend/dist/ exists)
#   - All deploy/ files copied to Pi alongside the project
# ==============================================================

set -euo pipefail

# ── Configuration ────────────────────────────────────────────
CLOUDPI_DIR="/home/pi/cloudpi"
CLOUDPI_USER="pi"
CLOUDPI_GROUP="pi"
BACKUP_DIR="/home/pi/cloudpi-backups"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_step() { echo -e "\n${BLUE}[STEP]${NC} $1"; }
print_ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
print_warn() { echo -e "${YELLOW}  ⚠${NC} $1"; }
print_err()  { echo -e "${RED}  ✗${NC} $1"; }

# ── Check prerequisites ─────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║    CloudPi — Production Deploy Script    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

if [ "$EUID" -ne 0 ]; then
    print_err "Please run with sudo: sudo ./deploy.sh"
    exit 1
fi

if [ ! -d "$CLOUDPI_DIR/frontend/dist" ]; then
    print_err "Frontend not built! Run 'npm run build' in frontend/ first."
    print_err "Expected: $CLOUDPI_DIR/frontend/dist/"
    exit 1
fi

if [ ! -f "$CLOUDPI_DIR/backend/server.js" ]; then
    print_err "Backend not found at $CLOUDPI_DIR/backend/server.js"
    exit 1
fi

# ── Step 1: Install systemd service ─────────────────────────
print_step "Installing systemd service for backend..."

cp "$CLOUDPI_DIR/deploy/cloudpi-backend.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable cloudpi-backend
print_ok "systemd service installed and enabled"

# ── Step 2: Install Nginx config ────────────────────────────
print_step "Installing Nginx configuration..."

# Check if using SSL
if tailscale status &>/dev/null; then
    TS_HOSTNAME=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
    if [ -f "/etc/ssl/certs/${TS_HOSTNAME}.crt" ]; then
        print_ok "Tailscale certs found for $TS_HOSTNAME — using HTTPS config"
        sed "s/YOUR_TAILSCALE_HOSTNAME/${TS_HOSTNAME}/g" \
            "$CLOUDPI_DIR/deploy/cloudpi-nginx-ssl.conf" \
            > /etc/nginx/sites-available/cloudpi
    else
        print_warn "Tailscale running but no certs found — using HTTP config"
        print_warn "Generate certs: sudo tailscale cert $TS_HOSTNAME"
        cp "$CLOUDPI_DIR/deploy/cloudpi-nginx.conf" /etc/nginx/sites-available/cloudpi
    fi
else
    print_warn "Tailscale not running — using HTTP config"
    cp "$CLOUDPI_DIR/deploy/cloudpi-nginx.conf" /etc/nginx/sites-available/cloudpi
fi

# Enable site
ln -sf /etc/nginx/sites-available/cloudpi /etc/nginx/sites-enabled/cloudpi
rm -f /etc/nginx/sites-enabled/default

# Test and reload
if nginx -t 2>/dev/null; then
    systemctl reload nginx
    print_ok "Nginx configured and reloaded"
else
    print_err "Nginx config test failed! Check: sudo nginx -t"
    exit 1
fi

# ── Step 3: Stop PM2 (if running) ───────────────────────────
print_step "Checking for PM2..."

if command -v pm2 &>/dev/null; then
    print_warn "PM2 found — stopping and removing all processes"
    sudo -u "$CLOUDPI_USER" pm2 stop all 2>/dev/null || true
    sudo -u "$CLOUDPI_USER" pm2 delete all 2>/dev/null || true
    pm2 unstartup systemd 2>/dev/null || true
    print_ok "PM2 processes stopped (you can uninstall PM2 manually: npm uninstall -g pm2)"
else
    print_ok "PM2 not found — nothing to clean up"
fi

# ── Step 4: Start backend via systemd ───────────────────────
print_step "Starting CloudPi backend..."

systemctl start cloudpi-backend

# Wait a moment for it to start
sleep 3

if systemctl is-active --quiet cloudpi-backend; then
    print_ok "Backend is running!"
else
    print_err "Backend failed to start. Check: journalctl -u cloudpi-backend -n 50"
    exit 1
fi

# ── Step 5: Set up cron jobs ────────────────────────────────
print_step "Setting up maintenance cron jobs..."

# Health check
cat > /usr/local/bin/cloudpi-healthcheck.sh << 'HEALTHEOF'
#!/bin/bash
response=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/api/test" --max-time 10)
if [ "$response" != "200" ]; then
    echo "$(date): Backend DOWN (HTTP $response) — restarting..." >> /var/log/cloudpi-health.log
    systemctl restart cloudpi-backend
fi
HEALTHEOF
chmod +x /usr/local/bin/cloudpi-healthcheck.sh
echo "*/5 * * * * root /usr/local/bin/cloudpi-healthcheck.sh" > /etc/cron.d/cloudpi-health
print_ok "Health check (every 5 minutes)"

# Database backup
cat > /usr/local/bin/cloudpi-backup.sh << BACKUPEOF
#!/bin/bash
BACKUP_DIR="$BACKUP_DIR"
DB_PATH="$CLOUDPI_DIR/backend/cloudpi.db"
KEEP_DAYS=14
mkdir -p "\$BACKUP_DIR"
sqlite3 "\$DB_PATH" ".backup '\$BACKUP_DIR/cloudpi-\$(date +%Y%m%d-%H%M%S).db'"
find "\$BACKUP_DIR" -name "cloudpi-*.db" -mtime +\$KEEP_DAYS -delete
echo "\$(date): Backup completed" >> /var/log/cloudpi-backup.log
BACKUPEOF
chmod +x /usr/local/bin/cloudpi-backup.sh
echo "0 2 * * * $CLOUDPI_USER /usr/local/bin/cloudpi-backup.sh" > /etc/cron.d/cloudpi-backup
print_ok "Database backup (daily at 2 AM, keep 14 days)"

# Tailscale cert renewal
if tailscale status &>/dev/null; then
    cat > /usr/local/bin/renew-tailscale-certs.sh << 'CERTEOF'
#!/bin/bash
HOSTNAME=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
tailscale cert --cert-file /etc/ssl/certs/${HOSTNAME}.crt \
               --key-file /etc/ssl/private/${HOSTNAME}.key \
               ${HOSTNAME} 2>/dev/null
systemctl reload nginx
echo "$(date): Certs renewed for $HOSTNAME" >> /var/log/cloudpi-certs.log
CERTEOF
    chmod +x /usr/local/bin/renew-tailscale-certs.sh
    echo "0 3 * * 0 root /usr/local/bin/renew-tailscale-certs.sh" > /etc/cron.d/tailscale-certs
    print_ok "Tailscale cert renewal (weekly on Sunday at 3 AM)"
fi

# ── Done ────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║         ✅ Deployment Complete!          ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Services:"
echo "    Backend:   systemctl status cloudpi-backend"
echo "    Nginx:     systemctl status nginx"
echo "    Tailscale: systemctl status tailscaled"
echo ""
echo "  Logs:"
echo "    Backend:   journalctl -u cloudpi-backend -f"
echo "    Nginx:     tail -f /var/log/nginx/cloudpi-error.log"
echo "    Health:    tail -f /var/log/cloudpi-health.log"
echo "    Backups:   tail -f /var/log/cloudpi-backup.log"
echo ""
echo "  Backups:     ls -la $BACKUP_DIR/"
echo ""
