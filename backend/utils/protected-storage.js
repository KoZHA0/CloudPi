const fs = require('fs');
const path = require('path');

const LUKS_MOUNT_POINT = process.env.LUKS_MOUNT_POINT || '/media/cloudpi-data';
const LUKS_MOUNT_MARKER = process.env.LUKS_MOUNT_MARKER || '.cloudpi-luks-ready';
const INTERNAL_STORAGE_REQUIRES_LUKS = process.env.CLOUDPI_INTERNAL_STORAGE_REQUIRES_LUKS === '1';

function isProtectedInternalStorageRequired() {
    return INTERNAL_STORAGE_REQUIRES_LUKS;
}

function getProtectedMountMarkerPath() {
    return path.join(LUKS_MOUNT_POINT, LUKS_MOUNT_MARKER);
}

function isProtectedMountAvailable() {
    return fs.existsSync(getProtectedMountMarkerPath());
}

function ensureProtectedInternalStorageAvailable() {
    if (!isProtectedInternalStorageRequired()) return;
    if (isProtectedMountAvailable()) return;

    const error = new Error(
        'CloudPi encrypted internal storage is unavailable. Reconnect or unlock the LUKS drive before accessing internal files.'
    );
    error.code = 'LUKS_STORAGE_UNAVAILABLE';
    throw error;
}

module.exports = {
    isProtectedInternalStorageRequired,
    isProtectedMountAvailable,
    ensureProtectedInternalStorageAvailable,
};
