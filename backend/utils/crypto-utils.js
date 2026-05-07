/**
 * CRYPTO UTILITIES — Hash-only
 * ============================
 * Provides SHA-256 file hashing for integrity verification.
 * 
 * NOTE: AES-GCM file encryption was removed during the LUKS migration.
 * Disk-level encryption is now handled by LUKS, and per-user encryption
 * by Cryptomator vaults. This file only contains the hash utilities
 * that are still needed for download integrity checks.
 */

const crypto = require('crypto');
const fs = require('fs');

/**
 * Compute SHA-256 hash of a file on disk.
 * Used during upload to record a hash for later integrity verification.
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
function computeFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

/**
 * Verify a file's SHA-256 hash matches an expected value.
 * Used during download to detect corruption or tampering.
 * @param {string} filePath - Absolute path to the file
 * @param {string} expectedHash - Expected hex-encoded SHA-256 hash
 * @returns {Promise<{valid: boolean, actual: string}>}
 */
async function verifyFileHash(filePath, expectedHash) {
    const actual = await computeFileHash(filePath);
    return {
        valid: actual === expectedHash,
        actual
    };
}

module.exports = {
    computeFileHash,
    verifyFileHash,
};
