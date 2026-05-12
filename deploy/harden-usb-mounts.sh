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
#   1. Removes legacy usbmount if present
#   2. Installs common filesystem helpers
#   3. Sets nosuid,nodev,noexec,noatime mount options
#   4. Mounts USB partitions/filesystems under /media/pi
#   5. Creates a systemd override for mount propagation
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

# Install common filesystem helpers. Kernel-backed filesystems such as ext4
# already work, but these packages improve USB-drive compatibility.
echo -e "${YELLOW}→ Installing common filesystem support...${NC}"
apt-get update -qq
FS_PACKAGES=()
for pkg in exfatprogs ntfs-3g dosfstools e2fsprogs xfsprogs btrfs-progs f2fs-tools; do
    if apt-cache show "$pkg" >/dev/null 2>&1; then
        FS_PACKAGES+=("$pkg")
    fi
done
if [ "${#FS_PACKAGES[@]}" -gt 0 ]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${FS_PACKAGES[@]}"
    apt-get clean
fi

# 1. Create custom mount script
MOUNT_SCRIPT="/usr/local/bin/cloudpi-usbmount"
cat > "$MOUNT_SCRIPT" << 'EOF'
#!/bin/bash
set -euo pipefail

ACTION=$1
DEVBASE=$2
DEVICE="/dev/${DEVBASE}"
MOUNT_POINT="/media/pi/${DEVBASE}"

# SECURITY: Hardened mount options — no setuid, no devices, no executables
BASE_OPTIONS="nosuid,nodev,noexec,noatime"
CLOUDPI_UID="${CLOUDPI_UID:-1000}"
CLOUDPI_GID="${CLOUDPI_GID:-1000}"

get_fstype() {
    blkid -o value -s TYPE "$DEVICE" 2>/dev/null || lsblk -n -o FSTYPE "$DEVICE" 2>/dev/null | tr -d '[:space:]'
}

mount_options_for() {
    local fstype="$1"
    case "$fstype" in
        vfat|msdos|exfat|ntfs|ntfs3)
            echo "${BASE_OPTIONS},uid=${CLOUDPI_UID},gid=${CLOUDPI_GID},umask=027"
            ;;
        ext2|ext3|ext4|xfs|btrfs|f2fs)
            echo "${BASE_OPTIONS}"
            ;;
        *)
            echo "${BASE_OPTIONS}"
            ;;
    esac
}

if [ "$ACTION" == "mount" ]; then
    if [ ! -b "$DEVICE" ]; then
        echo "Device does not exist or is not a block device: $DEVICE" >&2
        exit 1
    fi

    mkdir -p "$MOUNT_POINT"
    FSTYPE="$(get_fstype)"

    if [ -z "$FSTYPE" ]; then
        rmdir "$MOUNT_POINT" 2>/dev/null || true
        echo "No mountable filesystem detected on $DEVICE" >&2
        exit 1
    fi

    OPTIONS="$(mount_options_for "$FSTYPE")"
    mount -o "$OPTIONS" "$DEVICE" "$MOUNT_POINT"

    # For POSIX filesystems, make a writable CloudPi data root for uid 1000
    # without recursively changing ownership of an existing user drive.
    mkdir -p "$MOUNT_POINT/cloudpi-data"
    chown "$CLOUDPI_UID:$CLOUDPI_GID" "$MOUNT_POINT" "$MOUNT_POINT/cloudpi-data" 2>/dev/null || true
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
# Normal USB partitions, e.g. /dev/sda1, /dev/sdb1
KERNEL=="sd[a-z][0-9]", SUBSYSTEM=="block", SUBSYSTEMS=="usb", ENV{ID_FS_USAGE}=="filesystem", ACTION=="add", ENV{SYSTEMD_WANTS}+="cloudpi-usb@%k.service"
KERNEL=="sd[a-z][0-9]", SUBSYSTEM=="block", SUBSYSTEMS=="usb", ACTION=="remove", RUN+="/usr/local/bin/cloudpi-drive-notify remove %k"

# Whole-disk filesystems, e.g. a USB formatted directly as /dev/sda with no /dev/sda1
KERNEL=="sd[a-z]", SUBSYSTEM=="block", SUBSYSTEMS=="usb", ENV{ID_FS_USAGE}=="filesystem", ACTION=="add", ENV{SYSTEMD_WANTS}+="cloudpi-usb@%k.service"
KERNEL=="sd[a-z]", SUBSYSTEM=="block", SUBSYSTEMS=="usb", ENV{ID_FS_USAGE}=="filesystem", ACTION=="remove", RUN+="/usr/local/bin/cloudpi-drive-notify remove %k"
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
echo "Filesystem support:    exFAT, FAT32, NTFS, ext2/3/4, XFS, Btrfs, F2FS"
echo "Event notification:    udev → cloudpi-drive-notify → backend webhook"
echo ""
echo -e "${YELLOW}IMPORTANT: Add the webhook secret to your backend .env:${NC}"
echo "  CLOUDPI_UDEV_SECRET=$(cat /etc/cloudpi/udev-secret 2>/dev/null || echo '<generate with: openssl rand -hex 32>')"
echo ""
echo -e "${YELLOW}Test drive events:${NC}"
echo "  mount | grep /media/pi"
echo "  journalctl -t cloudpi-udev -f"
echo ""
