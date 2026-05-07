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

# Remove usbmount if it was installed
if dpkg -l | grep -q usbmount; then
    echo -e "${YELLOW}→ Removing legacy usbmount...${NC}"
    apt-get remove -y -qq usbmount
fi

# 1. Create custom mount script
MOUNT_SCRIPT="/usr/local/bin/cloudpi-usbmount"
cat > "$MOUNT_SCRIPT" << 'EOF'
#!/bin/bash
ACTION=$1
DEVBASE=$2
DEVICE="/dev/${DEVBASE}"
MOUNT_POINT="/media/pi/${DEVBASE}"

# SECURITY: Hardened mount options — no setuid, no devices, no executables
OPTIONS="nosuid,nodev,noexec,noatime"

if [ "$ACTION" == "mount" ]; then
    mkdir -p "$MOUNT_POINT"
    # Find filesystem type
    FSTYPE=$(lsblk -n -o FSTYPE "$DEVICE" | tr -d '[:space:]')
    
    # FAT/NTFS specific: pin ownership to the cloudpi user (uid 1000)
    if [[ "$FSTYPE" == "vfat" || "$FSTYPE" == "exfat" || "$FSTYPE" == "ntfs" || "$FSTYPE" == "msdos" ]]; then
        OPTIONS="${OPTIONS},uid=1000,gid=1000,umask=027"
    fi
    
    mount -o "$OPTIONS" "$DEVICE" "$MOUNT_POINT"
elif [ "$ACTION" == "umount" ]; then
    umount -l "$MOUNT_POINT" || true
    # Clean up orphan files that may persist on root after lazy unmount.
    # These are NOT user files — they are CloudPi metadata that was on the USB.
    # After umount, the mount point dir reverts to root fs and may retain them.
    rm -f "$MOUNT_POINT/.cloudpi-id" 2>/dev/null || true
    rm -rf "$MOUNT_POINT/cloudpi-data" 2>/dev/null || true
    rmdir "$MOUNT_POINT" 2>/dev/null || true
fi
EOF
chmod +x "$MOUNT_SCRIPT"
echo -e "${GREEN}✓ Created custom USB mount script${NC}"

# 2. Install the drive notification script
NOTIFY_SCRIPT="/usr/local/bin/cloudpi-drive-notify"
cp "$(dirname "$0")/cloudpi-drive-notify.sh" "$NOTIFY_SCRIPT"
chmod +x "$NOTIFY_SCRIPT"
echo -e "${GREEN}✓ Installed drive notification script${NC}"

# 3. Generate udev webhook secret (if not already set)
SECRET_FILE="/etc/cloudpi/udev-secret"
if [ ! -f "$SECRET_FILE" ]; then
    mkdir -p /etc/cloudpi
    openssl rand -hex 32 > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo -e "${GREEN}✓ Generated udev webhook secret${NC}"
    echo -e "${YELLOW}  → Add to backend .env: CLOUDPI_UDEV_SECRET=$(cat $SECRET_FILE)${NC}"
else
    echo -e "${GREEN}✓ Udev webhook secret already exists${NC}"
fi

# 4. Create systemd service to handle the mount/umount lifecycle
# ExecStartPost/ExecStopPost: notify the backend after mount/unmount completes
SERVICE_FILE="/etc/systemd/system/cloudpi-usb@.service"
cat > "$SERVICE_FILE" << 'EOF'
[Unit]
Description=CloudPi USB Mount on %i
BindsTo=dev-%i.device
After=dev-%i.device

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/bin/cloudpi-usbmount mount %i
ExecStartPost=-/usr/local/bin/cloudpi-drive-notify add %i
ExecStop=/usr/local/bin/cloudpi-usbmount umount %i
ExecStopPost=-/usr/local/bin/cloudpi-drive-notify remove %i
EOF
echo -e "${GREEN}✓ Created systemd mount service (with notification)${NC}"

# 5. Create udev rule to trigger systemd on USB plug/unplug
UDEV_RULE="/etc/udev/rules.d/99-cloudpi-usb.rules"
cat > "$UDEV_RULE" << 'EOF'
KERNEL=="sd[a-z][0-9]", SUBSYSTEMS=="usb", ACTION=="add", ENV{SYSTEMD_WANTS}="cloudpi-usb@%k.service"
KERNEL=="sd[a-z][0-9]", SUBSYSTEMS=="usb", ACTION=="remove", RUN+="/usr/local/bin/cloudpi-drive-notify remove %k"
EOF
echo -e "${GREEN}✓ Created udev rule for auto-mounting${NC}"

# 4. Fix systemd-udevd MountFlags to ensure mounts propagate to host/Docker
OVERRIDE_DIR="/etc/systemd/system/systemd-udevd.service.d"
mkdir -p "$OVERRIDE_DIR"
cat > "${OVERRIDE_DIR}/cloudpi-override.conf" << 'EOF'
# Allow mounts to work and propagate to Docker containers
[Service]
PrivateMounts=no
MountFlags=shared
EOF

# Reload system services
systemctl daemon-reload
udevadm control --reload-rules
echo -e "${GREEN}✓ Reloaded systemd and udev rules${NC}"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✓ USB mount hardening + event notification complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Mount options applied: nosuid,nodev,noexec,noatime"
echo "Mount points:          /media/pi/sda1, /media/pi/sdb1, etc."
echo "Event notification:    udev → cloudpi-drive-notify → backend webhook"
echo ""
echo -e "${YELLOW}IMPORTANT: Add the webhook secret to your backend .env:${NC}"
echo "  CLOUDPI_UDEV_SECRET=$(cat /etc/cloudpi/udev-secret 2>/dev/null || echo '<generate with: openssl rand -hex 32>')"
echo ""
echo -e "${YELLOW}Test drive events:${NC}"
echo "  mount | grep /media/pi"
echo "  journalctl -t cloudpi-udev -f"
echo ""
