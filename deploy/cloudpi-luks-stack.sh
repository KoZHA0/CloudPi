#!/bin/bash
# ==============================================================
# CloudPi — LUKS Host Control Script
# ==============================================================
# Simple host-side operations for admins after bootstrap:
#   status            Show drive + stack status
#   unlock            Open and mount the LUKS filesystem
#   unlock --start    Open/mount and start Docker
#   start             Start Docker only if the encrypted mount is present
#   stop              Stop Docker
#   lock              Stop Docker, unmount, close LUKS
#
# Usage:
#   sudo bash deploy/cloudpi-luks-stack.sh status
#   sudo bash deploy/cloudpi-luks-stack.sh unlock --start
#   sudo bash deploy/cloudpi-luks-stack.sh lock
# ==============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_ENV_FILE="${PROJECT_DIR}/.env"

LUKS_DEVICE="${LUKS_DEVICE:-/dev/sda1}"
LUKS_MAPPER_NAME="${LUKS_MAPPER_NAME:-cloudpi-data}"
LUKS_MOUNT_POINT="${LUKS_MOUNT_POINT:-/media/cloudpi-data}"
MAPPER_DEVICE="/dev/mapper/${LUKS_MAPPER_NAME}"
MARKER_FILE=".cloudpi-luks-ready"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_ok()   { echo -e "${GREEN}  ✓${NC} $1"; }
print_warn() { echo -e "${YELLOW}  !${NC} $1"; }
print_err()  { echo -e "${RED}  x${NC} $1"; }

require_root() {
    if [ "${EUID}" -ne 0 ]; then
        print_err "Run this script with sudo."
        exit 1
    fi
}

load_env() {
    if [ -f "${COMPOSE_ENV_FILE}" ]; then
        # shellcheck disable=SC1090
        set -a && source "${COMPOSE_ENV_FILE}" && set +a
        LUKS_DEVICE="${LUKS_DEVICE:-/dev/sda1}"
        LUKS_MAPPER_NAME="${LUKS_MAPPER_NAME:-cloudpi-data}"
        LUKS_MOUNT_POINT="${LUKS_MOUNT_POINT:-/media/cloudpi-data}"
        MAPPER_DEVICE="/dev/mapper/${LUKS_MAPPER_NAME}"
    fi
}

is_mapper_open() {
    [ -e "${MAPPER_DEVICE}" ]
}

is_mount_ready() {
    findmnt -n "${LUKS_MOUNT_POINT}" >/dev/null 2>&1 && [ -f "${LUKS_MOUNT_POINT}/${MARKER_FILE}" ]
}

ensure_mount_dirs() {
    mkdir -p "${LUKS_MOUNT_POINT}/appdata" "${LUKS_MOUNT_POINT}/storage" "${LUKS_MOUNT_POINT}/uploads" "${LUKS_MOUNT_POINT}/users"
    touch "${LUKS_MOUNT_POINT}/${MARKER_FILE}"
    chown -R 1000:1000 "${LUKS_MOUNT_POINT}/appdata" "${LUKS_MOUNT_POINT}/storage" "${LUKS_MOUNT_POINT}/uploads"
}

stack_up() {
    if ! is_mount_ready; then
        print_err "Encrypted mount is not ready at ${LUKS_MOUNT_POINT}."
        exit 1
    fi
    (cd "${PROJECT_DIR}" && docker compose up -d)
    print_ok "Docker stack started"
}

stack_down() {
    (cd "${PROJECT_DIR}" && docker compose down || true)
    print_ok "Docker stack stopped"
}

unlock_drive() {
    if is_mount_ready; then
        print_ok "LUKS filesystem is already mounted at ${LUKS_MOUNT_POINT}"
        return
    fi

    if ! is_mapper_open; then
        local passphrase=""
        read -r -s -p "LUKS passphrase: " passphrase
        echo ""
        printf '%s' "${passphrase}" | cryptsetup luksOpen "${LUKS_DEVICE}" "${LUKS_MAPPER_NAME}" --key-file=-
        print_ok "LUKS mapper opened"
    else
        print_ok "LUKS mapper already open"
    fi

    mkdir -p "${LUKS_MOUNT_POINT}"
    mount "${MAPPER_DEVICE}" "${LUKS_MOUNT_POINT}"
    ensure_mount_dirs
    print_ok "Mounted at ${LUKS_MOUNT_POINT}"
}

lock_drive() {
    stack_down
    if findmnt -n "${LUKS_MOUNT_POINT}" >/dev/null 2>&1; then
        umount "${LUKS_MOUNT_POINT}"
        print_ok "Unmounted ${LUKS_MOUNT_POINT}"
    else
        print_warn "Mount point was already unmounted"
    fi

    if is_mapper_open; then
        cryptsetup luksClose "${LUKS_MAPPER_NAME}"
        print_ok "Closed mapper ${LUKS_MAPPER_NAME}"
    else
        print_warn "Mapper was already closed"
    fi
}

show_status() {
    echo "Project:      ${PROJECT_DIR}"
    echo "LUKS device:  ${LUKS_DEVICE}"
    echo "Mapper:       ${MAPPER_DEVICE}"
    echo "Mount point:  ${LUKS_MOUNT_POINT}"

    if [ -b "${LUKS_DEVICE}" ]; then
        print_ok "Block device is present"
    else
        print_warn "Block device is not present"
    fi

    if is_mapper_open; then
        print_ok "LUKS mapper is open"
    else
        print_warn "LUKS mapper is closed"
    fi

    if findmnt -n "${LUKS_MOUNT_POINT}" >/dev/null 2>&1; then
        print_ok "Filesystem is mounted"
    else
        print_warn "Filesystem is not mounted"
    fi

    if is_mount_ready; then
        print_ok "Encrypted mount marker is present"
    else
        print_warn "Encrypted mount marker is missing"
    fi

    docker compose -f "${PROJECT_DIR}/docker-compose.yml" ps || true
}

main() {
    require_root
    load_env

    local command="${1:-status}"
    local option="${2:-}"

    case "${command}" in
        status)
            show_status
            ;;
        unlock)
            unlock_drive
            if [ "${option}" = "--start" ]; then
                stack_up
            fi
            ;;
        start)
            stack_up
            ;;
        stop)
            stack_down
            ;;
        lock)
            lock_drive
            ;;
        *)
            echo "Usage: $0 {status|unlock [--start]|start|stop|lock}"
            exit 1
            ;;
    esac
}

main "$@"
