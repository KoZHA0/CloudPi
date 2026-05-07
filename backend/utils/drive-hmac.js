/**
 * DRIVE HMAC — Identity Verification
 * ====================================
 * Shared HMAC helpers for .cloudpi-id integrity.
 * Uses the server's CLOUDPI_ENCRYPTION_KEY to sign and verify drive IDs.
 * Prevents attackers from crafting a fake .cloudpi-id on a rogue USB.
 *
 * Used by:
 *   - admin.js  (drive registration + drive scan)
 *   - events.js (drive reconnection webhook)
 */

const crypto = require('crypto');

/**
 * Compute an HMAC-SHA256 signature for a drive ID.
 * @param {string} driveId - The drive's UUID
 * @returns {string|null} Hex-encoded HMAC, or null if no key configured
 */
function computeDriveHmac(driveId) {
    const key = process.env.CLOUDPI_ENCRYPTION_KEY;
    if (!key || key.length !== 64) return null;
    return crypto.createHmac('sha256', Buffer.from(key, 'hex'))
        .update(driveId)
        .digest('hex');
}

/**
 * Verify a drive ID's HMAC signature (constant-time comparison).
 * @param {string} driveId - The drive's UUID
 * @param {string} hmac - The HMAC to verify
 * @returns {boolean} True if the HMAC is valid
 */
function verifyDriveHmac(driveId, hmac) {
    const expected = computeDriveHmac(driveId);
    if (!expected || !hmac) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hmac, 'hex'));
    } catch {
        return false;
    }
}

module.exports = { computeDriveHmac, verifyDriveHmac };
