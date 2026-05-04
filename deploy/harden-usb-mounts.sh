#!/bin/bash
# ==============================================================
# CloudPi — USB Mount Hardening Script
# ==============================================================
# Run this ONCE on the Raspberry Pi host (not inside Docker).
# Configures usbmount with security-hardened mount options.
#
# Usage:
#   sudo bash deploy/harden-usb-mounts.sh
#
# What it does:
#   1. Installs usbmount (if not present)
#   2. Sets nosuid,nodev,noexec,noatime mount options
#   3. Restricts mount points to /media/pi
#   4. Creates a systemd override for proper permissions
# ==============================================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  CloudPi — USB Mount Hardening${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Check root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}✗ This script must be run as root (sudo)${NC}"
    exit 1
fi

# Install usbmount if not present
if ! dpkg -l | grep -q usbmount; then
    echo -e "${YELLOW}→ Installing usbmount...${NC}"
    apt-get update -qq && apt-get install -y -qq usbmount
    echo -e "${GREEN}✓ usbmount installed${NC}"
else
    echo -e "${GREEN}✓ usbmount already installed${NC}"
fi

# Backup existing config
USBMOUNT_CONF="/etc/usbmount/usbmount.conf"
if [ -f "$USBMOUNT_CONF" ]; then
    cp "$USBMOUNT_CONF" "${USBMOUNT_CONF}.bak.$(date +%Y%m%d%H%M%S)"
    echo -e "${GREEN}✓ Backed up existing config${NC}"
fi

# Write hardened config
cat > "$USBMOUNT_CONF" << 'EOF'
# ==============================================================
# CloudPi — Hardened USB Mount Configuration
# ==============================================================
# Security options:
#   nosuid  — Block setuid binaries on USB drives
#   nodev   — Block device files on USB drives
#   noexec  — Block executable files on USB drives
#   noatime — Don't update access timestamps (performance)
# ==============================================================

ENABLED=1

# Filesystem types to mount automatically
FILESYSTEMS="vfat ext2 ext3 ext4 ntfs exfat"

# Mount points (up to 8 USB drives)
MOUNTPOINTS="/media/pi/usb0 /media/pi/usb1 /media/pi/usb2 /media/pi/usb3 /media/pi/usb4 /media/pi/usb5 /media/pi/usb6 /media/pi/usb7"

# SECURITY: Hardened mount options — no setuid, no devices, no executables
MOUNTOPTIONS="nosuid,nodev,noexec,noatime"

# FAT/NTFS specific: pin ownership to the cloudpi user
# Adjust uid/gid if your cloudpi container runs as a different user
FS_MOUNTOPTIONS="-fstype=vfat,uid=1000,gid=1000,umask=027 -fstype=ntfs,uid=1000,gid=1000,umask=027"

# Verbose logging (disable in production if not needed)
VERBOSE=no
EOF

echo -e "${GREEN}✓ Hardened usbmount.conf written${NC}"

# Create mount point directories
for i in $(seq 0 7); do
    mkdir -p "/media/pi/usb${i}"
done
echo -e "${GREEN}✓ Mount points created (/media/pi/usb0..usb7)${NC}"

# Fix systemd-udevd PrivateMounts issue (common on Raspberry Pi OS Bookworm)
# Without this override, usbmount fails silently
OVERRIDE_DIR="/etc/systemd/system/systemd-udevd.service.d"
mkdir -p "$OVERRIDE_DIR"
cat > "${OVERRIDE_DIR}/cloudpi-override.conf" << 'EOF'
# Allow usbmount to work with systemd-udevd
# Without this, mount operations from udev rules are invisible to the host
[Service]
PrivateMounts=no
MountFlags=shared
EOF

systemctl daemon-reload
echo -e "${GREEN}✓ systemd-udevd override applied${NC}"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ USB mount hardening complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Mount options applied: nosuid,nodev,noexec,noatime"
echo "Mount points:          /media/pi/usb0 .. usb7"
echo ""
echo -e "${YELLOW}NOTE: Plug in a USB drive to test. Check with:${NC}"
echo "  mount | grep /media/pi"
echo ""
