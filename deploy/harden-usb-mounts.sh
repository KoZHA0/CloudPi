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
    rmdir "$MOUNT_POINT" || true
fi
EOF
chmod +x "$MOUNT_SCRIPT"
echo -e "${GREEN}✓ Created custom USB mount script${NC}"

# 2. Create systemd service to handle the mount/umount lifecycle
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
ExecStop=/usr/local/bin/cloudpi-usbmount umount %i
EOF
echo -e "${GREEN}✓ Created systemd mount service${NC}"

# 3. Create udev rule to trigger systemd on USB plug
UDEV_RULE="/etc/udev/rules.d/99-cloudpi-usb.rules"
cat > "$UDEV_RULE" << 'EOF'
KERNEL=="sd[a-z][0-9]", SUBSYSTEMS=="usb", ACTION=="add", ENV{SYSTEMD_WANTS}="cloudpi-usb@%k.service"
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
echo -e "${GREEN}  ✓ USB mount hardening complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Mount options applied: nosuid,nodev,noexec,noatime"
echo "Mount points:          /media/pi/sda1, /media/pi/sdb1, etc."
echo ""
echo -e "${YELLOW}NOTE: Plug in a USB drive to test. Check with:${NC}"
echo "  mount | grep /media/pi"
echo ""
