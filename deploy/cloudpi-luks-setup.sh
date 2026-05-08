#!/bin/bash
# ==============================================================
# CloudPi — LUKS + Docker Bootstrap Script
# ==============================================================
# One-time Raspberry Pi host setup for Layer 1 encryption.
#
# What this script does:
#   1. Shows available block devices
#   2. Formats the selected partition as LUKS2 + ext4
#   3. Mounts it at /media/cloudpi-data (or your chosen mount point)
#   4. Creates CloudPi data directories on the encrypted filesystem
#   5. Reconfigures docker-compose to use host bind mounts via project .env
#   6. Migrates existing Docker volume data (DB, storage, uploads)
#   7. Starts the CloudPi stack on the encrypted mount
#
# WARNING:
#   This script destroys all data on the target device.
#
# Usage:
#   sudo bash deploy/cloudpi-luks-setup.sh
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
COMPOSE_ENV_FILE="${PROJECT_DIR}/.env"

DEFAULT_LUKS_DEVICE="${LUKS_DEVICE:-/dev/sda1}"
DEFAULT_MAPPER_NAME="${LUKS_MAPPER_NAME:-cloudpi-data}"
DEFAULT_MOUNT_POINT="${LUKS_MOUNT_POINT:-/media/cloudpi-data}"

APPDATA_SUBDIR="appdata"
STORAGE_SUBDIR="storage"
UPLOADS_SUBDIR="uploads"
USERS_SUBDIR="users"
BACKUPS_SUBDIR="backups"
MARKER_FILE=".cloudpi-luks-ready"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_step() { echo -e "\n${BLUE}[STEP]${NC} $1"; }
print_ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
print_warn() { echo -e "${YELLOW}  !${NC} $1"; }
print_err()  { echo -e "${RED}  x${NC} $1"; }

require_root() {
    if [ "${EUID}" -ne 0 ]; then
        print_err "Run this script with sudo."
        exit 1
    fi
}

require_commands() {
    local missing=()
    local commands=(cryptsetup lsblk findmnt mount umount mkfs.ext4 docker awk sed grep)
    for cmd in "${commands[@]}"; do
        if ! command -v "${cmd}" >/dev/null 2>&1; then
            missing+=("${cmd}")
        fi
    done

    if [ "${#missing[@]}" -gt 0 ]; then
        print_err "Missing required commands: ${missing[*]}"
        exit 1
    fi
}

show_devices() {
    echo ""
    echo "Available block devices:"
    lsblk -dpno NAME,SIZE,FSTYPE,TYPE,MOUNTPOINT,MODEL | sed 's/^/  /'
    echo ""
}

prompt_value() {
    local prompt="$1"
    local default_value="$2"
    local result

    read -r -p "${prompt} [${default_value}]: " result
    if [ -z "${result}" ]; then
        result="${default_value}"
    fi
    printf '%s' "${result}"
}

prompt_passphrase() {
    local first=""
    local second=""

    while true; do
        read -r -s -p "Enter new LUKS passphrase: " first
        echo ""
        read -r -s -p "Confirm LUKS passphrase: " second
        echo ""

        if [ -z "${first}" ]; then
            print_warn "Passphrase cannot be empty."
            continue
        fi
        if [ "${first}" != "${second}" ]; then
            print_warn "Passphrases did not match. Try again."
            continue
        fi
        LUKS_PASSPHRASE="${first}"
        return
    done
}

confirm_destructive_action() {
    local device="$1"
    echo ""
    echo -e "${RED}This will ERASE all data on ${device}.${NC}"
    echo "Type exactly: ERASE ${device}"
    local confirmation=""
    read -r -p "> " confirmation
    if [ "${confirmation}" != "ERASE ${device}" ]; then
        print_err "Confirmation did not match. Aborting."
        exit 1
    fi
}

is_mounted() {
    local target="$1"
    if [[ "${target}" == /dev/* ]]; then
        findmnt -n -S "${target}" >/dev/null 2>&1
    else
        findmnt -n "${target}" >/dev/null 2>&1
    fi
}

write_env_setting() {
    local key="$1"
    local value="$2"

    touch "${COMPOSE_ENV_FILE}"
    if grep -q "^${key}=" "${COMPOSE_ENV_FILE}"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "${COMPOSE_ENV_FILE}"
    else
        echo "${key}=${value}" >> "${COMPOSE_ENV_FILE}"
    fi
}

resolve_volume_name() {
    local suffix="$1"
    docker volume ls --format '{{.Name}}' | grep -E "(^|_)${suffix}$" | head -n 1 || true
}

copy_volume_to_path() {
    local volume_name="$1"
    local destination="$2"

    if [ -z "${volume_name}" ]; then
        print_warn "No existing Docker volume found for ${destination}; skipping migration."
        return
    fi

    mkdir -p "${destination}"

    local has_data
    has_data="$(docker run --rm -v "${volume_name}:/from:ro" alpine sh -c 'find /from -mindepth 1 -print -quit 2>/dev/null' || true)"
    if [ -z "${has_data}" ]; then
        print_ok "Volume ${volume_name} is empty; nothing to migrate."
        return
    fi

    print_step "Migrating ${volume_name} -> ${destination}"
    docker run --rm \
        -v "${volume_name}:/from:ro" \
        -v "${destination}:/to" \
        alpine sh -c 'cp -a /from/. /to/'
    print_ok "Migrated data from ${volume_name}"
}

ensure_mount_dirs() {
    local mount_point="$1"
    mkdir -p "${mount_point}/${APPDATA_SUBDIR}"
    mkdir -p "${mount_point}/${STORAGE_SUBDIR}"
    mkdir -p "${mount_point}/${UPLOADS_SUBDIR}"
    mkdir -p "${mount_point}/${USERS_SUBDIR}"
    mkdir -p "${mount_point}/${BACKUPS_SUBDIR}"
    touch "${mount_point}/${MARKER_FILE}"
    chown -R 1000:1000 "${mount_point}/${APPDATA_SUBDIR}" "${mount_point}/${STORAGE_SUBDIR}" "${mount_point}/${UPLOADS_SUBDIR}"
}

stop_stack() {
    if [ -f "${COMPOSE_FILE}" ]; then
        print_step "Stopping current Docker stack"
        (cd "${PROJECT_DIR}" && docker compose down || true)
        print_ok "Docker stack stopped"
    fi
}

start_stack() {
    print_step "Starting CloudPi on the encrypted mount"
    (cd "${PROJECT_DIR}" && docker compose up -d --build)
    print_ok "Docker stack started"
}

main() {
    require_root
    require_commands

    echo ""
    echo "╔══════════════════════════════════════════════╗"
    echo "║   CloudPi — LUKS + Docker Bootstrap Setup   ║"
    echo "╚══════════════════════════════════════════════╝"

    if [ ! -f "${COMPOSE_FILE}" ]; then
        print_err "docker-compose.yml not found at ${COMPOSE_FILE}"
        exit 1
    fi

    show_devices

    local luks_device mapper_name mount_point mapper_device
    luks_device="$(prompt_value 'Target LUKS partition' "${DEFAULT_LUKS_DEVICE}")"
    mapper_name="$(prompt_value 'LUKS mapper name' "${DEFAULT_MAPPER_NAME}")"
    mount_point="$(prompt_value 'LUKS mount point' "${DEFAULT_MOUNT_POINT}")"
    mapper_device="/dev/mapper/${mapper_name}"

    if [ ! -b "${luks_device}" ]; then
        print_err "Device ${luks_device} does not exist or is not a block device."
        exit 1
    fi

    if is_mounted "${luks_device}" || is_mounted "${mount_point}"; then
        print_err "The target device or mount point is already mounted. Unmount it first."
        exit 1
    fi

    prompt_passphrase
    confirm_destructive_action "${luks_device}"

    stop_stack

    print_step "Formatting ${luks_device} as LUKS2"
    printf '%s' "${LUKS_PASSPHRASE}" | cryptsetup luksFormat --type luks2 --batch-mode "${luks_device}" -
    print_ok "LUKS container created"

    print_step "Opening encrypted device"
    printf '%s' "${LUKS_PASSPHRASE}" | cryptsetup luksOpen "${luks_device}" "${mapper_name}" --key-file=-
    print_ok "Mapper opened at ${mapper_device}"

    print_step "Creating ext4 filesystem"
    mkfs.ext4 -F -L CloudPiData "${mapper_device}" >/dev/null
    print_ok "Filesystem created"

    print_step "Mounting encrypted filesystem"
    mkdir -p "${mount_point}"
    mount "${mapper_device}" "${mount_point}"
    ensure_mount_dirs "${mount_point}"
    print_ok "Mounted at ${mount_point}"

    print_step "Configuring Docker bind mounts in project .env"
    write_env_setting "LUKS_DEVICE" "${luks_device}"
    write_env_setting "LUKS_MAPPER_NAME" "${mapper_name}"
    write_env_setting "LUKS_MOUNT_POINT" "${mount_point}"
    write_env_setting "CLOUDPI_DB_MOUNT" "${mount_point}/${APPDATA_SUBDIR}"
    write_env_setting "CLOUDPI_STORAGE_MOUNT" "${mount_point}/${STORAGE_SUBDIR}"
    write_env_setting "CLOUDPI_UPLOADS_MOUNT" "${mount_point}/${UPLOADS_SUBDIR}"
    print_ok "Updated ${COMPOSE_ENV_FILE}"

    copy_volume_to_path "$(resolve_volume_name 'cloudpi-db')" "${mount_point}/${APPDATA_SUBDIR}"
    copy_volume_to_path "$(resolve_volume_name 'cloudpi-storage')" "${mount_point}/${STORAGE_SUBDIR}"
    copy_volume_to_path "$(resolve_volume_name 'cloudpi-uploads')" "${mount_point}/${UPLOADS_SUBDIR}"

    ensure_mount_dirs "${mount_point}"
    start_stack

    echo ""
    echo -e "${GREEN}Layer 1 setup complete.${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Visit CloudPi Admin -> Layer 1: LUKS Disk Encryption"
    echo "  2. Confirm status shows the mounted device"
    echo "  3. Test secure vault creation and upload"
    echo ""
    echo "Daily host control script:"
    echo "  sudo bash deploy/cloudpi-luks-stack.sh status"
    echo "  sudo bash deploy/cloudpi-luks-stack.sh lock"
    echo "  sudo bash deploy/cloudpi-luks-stack.sh unlock --start"
    echo ""
}

main "$@"
