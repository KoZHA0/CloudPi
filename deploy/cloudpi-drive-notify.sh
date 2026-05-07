#!/bin/bash
# ==============================================================
# CloudPi — udev Drive Change Notification Script
# ==============================================================
# Called by the udev rule when a USB drive is plugged in or removed.
# Sends a webhook to the Node.js backend after a short delay to
# allow the OS to complete the mount/unmount operation.
#
# This script is triggered by:
#   /etc/udev/rules.d/99-cloudpi-usb.rules
#
# Environment (set in systemd service or udev rule):
#   CLOUDPI_UDEV_SECRET — shared secret for webhook authentication
#
# Usage (manual test):
#   sudo bash deploy/cloudpi-drive-notify.sh add sda1
#   sudo bash deploy/cloudpi-drive-notify.sh remove sda1
# ==============================================================

set -euo pipefail

ACTION="${1:-}"        # "add" or "remove"
DEVBASE="${2:-}"       # e.g. "sda1"
MOUNT_POINT="/media/pi/${DEVBASE}"
WEBHOOK_URL="http://localhost:3001/api/events/drive-change"

# Load secret from environment or fallback config file
SECRET="${CLOUDPI_UDEV_SECRET:-}"
if [ -z "$SECRET" ] && [ -f /etc/cloudpi/udev-secret ]; then
    SECRET=$(cat /etc/cloudpi/udev-secret)
fi

if [ -z "$ACTION" ] || [ -z "$DEVBASE" ]; then
    echo "Usage: $0 <add|remove> <device>"
    echo "Example: $0 add sda1"
    exit 1
fi

if [ -z "$SECRET" ]; then
    echo "ERROR: CLOUDPI_UDEV_SECRET not set and /etc/cloudpi/udev-secret not found"
    exit 1
fi

# ── Deliberate delay ──────────────────────────────────────────
# Wait for the OS to fully complete the mount/unmount operation.
# Without this, the filesystem state may be inconsistent when
# the backend checks it (race condition).
#   - "add":    mount needs time to complete
#   - "remove": unmount needs time to finalize
DELAY_SECONDS=2
sleep "$DELAY_SECONDS"

# ── Send webhook to Node.js backend ──────────────────────────
echo "[CloudPi] Drive ${ACTION}: ${DEVBASE} at ${MOUNT_POINT}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -H "X-Udev-Secret: ${SECRET}" \
    -d "{\"action\":\"${ACTION}\",\"device\":\"${DEVBASE}\",\"path\":\"${MOUNT_POINT}\"}" \
    --connect-timeout 5 \
    --max-time 10 \
    2>/dev/null) || HTTP_CODE="000"

if [ "$HTTP_CODE" = "200" ]; then
    echo "[CloudPi] ✓ Backend notified successfully (HTTP ${HTTP_CODE})"
else
    echo "[CloudPi] ✗ Backend notification failed (HTTP ${HTTP_CODE})"
    # Log to syslog for debugging
    logger -t cloudpi-udev "Drive ${ACTION} notification failed for ${DEVBASE} (HTTP ${HTTP_CODE})"
fi
