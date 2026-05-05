/**
 * KEY WRAPPING
 * ============
 * Per-drive Data Encryption Key (DEK) management with passphrase-based key wrapping.
 *
 * WHY THIS EXISTS:
 *   The original implementation used a single server-side master key stored in .env.
 *   Files encrypted that way can only be decrypted on the server that holds the key —
 *   unplugging a USB drive and connecting it to another device leaves the files
 *   inaccessible. Key wrapping solves this: each drive carries its own DEK inside a
 *   file called key.blob. The DEK is encrypted ("wrapped") using a key derived from a
 *   user passphrase via scrypt. Anyone with the passphrase can unwrap the DEK and thus
 *   decrypt the files, on any machine.
 *
 * KEY.BLOB FORMAT (JSON written to <drivePath>/key.blob):
 * {
 *   "version":  1,              // Format version for future migrations
 *   "kdf":      "scrypt",       // Key derivation function identifier
 *   "kdfParams": {
 *     "N": 16384,               // CPU/memory cost (2^14 — min. recommended for interactive)
 *     "r": 8,                   // Block size
 *     "p": 1,                   // Parallelisation factor
 *     "salt": "<64 hex chars>"  // 32-byte (256-bit) random salt, unique per drive
 *   },
 *   "wrapIv":     "<24 hex chars>",   // 12-byte random IV used for AES-256-GCM wrapping
 *   "wrappedDek": "<96 hex chars>"    // 32-byte ciphertext + 16-byte auth tag (AES-256-GCM)
 * }
 *
 * WHY A RANDOM SALT?
 *   scrypt is a password-based KDF. Without a per-drive random salt, two drives
 *   protected with the same passphrase would produce identical wrapping keys, letting
 *   an attacker confirm passphrase reuse across drives. The random salt ensures every
 *   drive's wrapping key is unique even when the passphrase is reused.
 *
 * WRAPPING WORKFLOW (setup):
 *   1. Generate a random 32-byte DEK (the actual AES-256-GCM file encryption key).
 *   2. Generate a random 32-byte salt.
 *   3. Derive a 32-byte wrapKey:  scrypt(passphrase, salt, { N, r, p }).
 *   4. Generate a random 12-byte IV.
 *   5. Wrap the DEK:  AES-256-GCM-Encrypt(DEK, wrapKey, IV) → ciphertext + authTag.
 *   6. Write key.blob (JSON) to the drive root.
 *   7. Cache the DEK in memory; it is NEVER written to disk in plaintext.
 *
 * UNWRAPPING WORKFLOW (unlock at runtime):
 *   1. Read key.blob from the drive.
 *   2. Derive wrapKey from passphrase + stored salt (same scrypt params).
 *   3. AES-256-GCM-Decrypt(wrappedDek, wrapKey, IV) → DEK.
 *   4. Cache DEK in memory until the server restarts or the drive is locked.
 *
 * MIGRATION NOTE:
 *   Files already encrypted with the server-side master key (CLOUDPI_ENCRYPTION_KEY
 *   in .env) remain decryptable via the master-key code path as long as that env var
 *   is present. The key.blob workflow only applies to storage sources explicitly set
 *   up with the setup-key admin endpoint. See docs/key-wrapping.md for a full
 *   migration guide.
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ── AES-256-GCM constants (same as crypto-utils.js) ──────────────────────────
const ALGORITHM      = 'aes-256-gcm';
const IV_LENGTH      = 12;   // bytes — GCM recommended length
const AUTH_TAG_LEN   = 16;   // bytes

// ── DEK / salt sizes ──────────────────────────────────────────────────────────
const KEY_LENGTH  = 32;   // 256-bit DEK
const SALT_LENGTH = 32;   // 256-bit random salt

// ── scrypt parameters ─────────────────────────────────────────────────────────
// N = 16384 (2^14) is the OWASP-recommended minimum for interactive logins.
// Increase N to 65536+ on less time-sensitive setups for higher brute-force cost.
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

// ── In-memory DEK cache ───────────────────────────────────────────────────────
// Maps storage-source ID → 32-byte Buffer (the plaintext DEK).
// DEKs live only in process memory and are lost on server restart.
// Drives must be re-unlocked after each restart.
const dekCache = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Synchronously derive a 32-byte wrapping key from a passphrase and salt.
 *
 * @param {string|Buffer} passphrase
 * @param {Buffer}        salt - 32-byte random salt
 * @param {object}        [params] - override scrypt params (N, r, p); defaults to module constants
 * @returns {Buffer} 32-byte derived key
 */
function deriveWrapKey(passphrase, salt, params = {}) {
    const N = params.N || SCRYPT_N;
    const r = params.r || SCRYPT_R;
    const p = params.p || SCRYPT_P;
    return crypto.scryptSync(passphrase, salt, KEY_LENGTH, { N, r, p });
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a new key.blob on a drive (first-time setup).
 *
 * Generates a fresh random DEK, wraps it with a key derived from the passphrase,
 * and writes key.blob to `<drivePath>/key.blob`.
 *
 * @param {string} passphrase - User-supplied passphrase (min. recommended: 12 chars)
 * @param {string} drivePath  - Root directory of the drive (e.g. "/mnt/usb1")
 * @param {string} driveId    - Storage-source ID used for the in-memory DEK cache
 * @returns {Buffer}          - The newly created 32-byte DEK (also cached in memory)
 * @throws {Error}  If key.blob already exists, the path is not writable,
 *                  or the passphrase is empty
 */
function createKeyBlob(passphrase, drivePath, driveId) {
    if (!passphrase || String(passphrase).length === 0) {
        throw new Error('Passphrase must not be empty');
    }

    const blobPath = path.join(drivePath, 'key.blob');

    if (fs.existsSync(blobPath)) {
        throw new Error(
            'key.blob already exists on this drive. ' +
            'Use the unlock endpoint to load the existing DEK. ' +
            'To replace it, delete key.blob first — ' +
            'WARNING: existing encrypted files will become unrecoverable.'
        );
    }

    // 1. Generate a fresh random DEK
    const dek = crypto.randomBytes(KEY_LENGTH);

    // 2. Generate a random per-drive salt
    const salt = crypto.randomBytes(SALT_LENGTH);

    // 3. Derive the wrapping key from the passphrase + salt
    const wrapKey = deriveWrapKey(passphrase, salt);

    // 4. Generate a random IV for the wrapping cipher
    const wrapIv = crypto.randomBytes(IV_LENGTH);

    // 5. Wrap the DEK with AES-256-GCM
    const cipher = crypto.createCipheriv(ALGORITHM, wrapKey, wrapIv, {
        authTagLength: AUTH_TAG_LEN
    });
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag    = cipher.getAuthTag();

    // Store ciphertext + auth tag concatenated (both are fixed-size, easy to split)
    const wrappedDek = Buffer.concat([ciphertext, authTag]);

    // 6. Build the JSON blob
    const blob = {
        version: 1,
        kdf: 'scrypt',
        kdfParams: {
            N:    SCRYPT_N,
            r:    SCRYPT_R,
            p:    SCRYPT_P,
            salt: salt.toString('hex')
        },
        wrapIv:     wrapIv.toString('hex'),
        wrappedDek: wrappedDek.toString('hex')
    };

    fs.writeFileSync(blobPath, JSON.stringify(blob, null, 2), { encoding: 'utf8' });

    // 7. Cache the DEK in memory
    if (driveId) {
        dekCache.set(driveId, dek);
    }

    return dek;
}

/**
 * Load and unwrap the DEK from an existing key.blob using the passphrase.
 *
 * Reads key.blob from `<drivePath>/key.blob`, re-derives the wrapping key,
 * decrypts the DEK, and caches it in memory.
 *
 * @param {string} passphrase - User-supplied passphrase
 * @param {string} drivePath  - Root directory of the drive
 * @param {string} driveId    - Storage-source ID used for the in-memory DEK cache
 * @returns {Buffer}          - The 32-byte plaintext DEK (also cached in memory)
 * @throws {Error}  If key.blob is missing/corrupted, or the passphrase is wrong
 */
function unwrapDEK(passphrase, drivePath, driveId) {
    const blobPath = path.join(drivePath, 'key.blob');

    if (!fs.existsSync(blobPath)) {
        throw new Error(
            `key.blob not found at ${blobPath}. ` +
            'Run the setup-key admin endpoint first to create a wrapped DEK for this drive.'
        );
    }

    let blob;
    try {
        blob = JSON.parse(fs.readFileSync(blobPath, 'utf8'));
    } catch (err) {
        throw new Error(`Failed to parse key.blob: ${err.message}`);
    }

    if (blob.version !== 1) {
        throw new Error(`Unsupported key.blob version: ${blob.version}`);
    }
    if (blob.kdf !== 'scrypt') {
        throw new Error(`Unsupported KDF in key.blob: ${blob.kdf}`);
    }

    const { N, r, p, salt: saltHex } = blob.kdfParams;

    // Validate required fields
    if (!saltHex || !blob.wrapIv || !blob.wrappedDek) {
        throw new Error('key.blob is missing required fields — file may be corrupted');
    }

    const salt        = Buffer.from(saltHex, 'hex');
    const wrapIv      = Buffer.from(blob.wrapIv, 'hex');
    const wrappedBuf  = Buffer.from(blob.wrappedDek, 'hex');

    // wrappedDek = ciphertext(32 bytes) + authTag(16 bytes)
    if (wrappedBuf.length !== KEY_LENGTH + AUTH_TAG_LEN) {
        throw new Error(
            `key.blob wrappedDek has unexpected length (${wrappedBuf.length} bytes, ` +
            `expected ${KEY_LENGTH + AUTH_TAG_LEN}) — file may be corrupted`
        );
    }

    const ciphertext = wrappedBuf.subarray(0, KEY_LENGTH);
    const authTag    = wrappedBuf.subarray(KEY_LENGTH);

    // Re-derive the wrapping key with the stored scrypt parameters
    const wrapKey = deriveWrapKey(passphrase, salt, { N, r, p });

    // Decrypt the DEK — GCM auth-tag verification rejects wrong passphrases
    let dek;
    try {
        const decipher = crypto.createDecipheriv(ALGORITHM, wrapKey, wrapIv, {
            authTagLength: AUTH_TAG_LEN
        });
        decipher.setAuthTag(authTag);
        dek = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (_) {
        throw new Error(
            'Wrong passphrase or corrupted key.blob (AES-GCM authentication failed)'
        );
    }

    // Cache the DEK in memory
    if (driveId) {
        dekCache.set(driveId, dek);
    }

    return dek;
}

/**
 * Retrieve the cached (in-memory) DEK for a drive.
 *
 * @param {string} driveId - Storage-source ID
 * @returns {Buffer|null}  - The 32-byte DEK, or null if the drive is locked
 */
function getActiveDEK(driveId) {
    return dekCache.get(driveId) || null;
}

/**
 * Remove the cached DEK for a drive (lock it).
 * After this call, files on the drive cannot be encrypted or decrypted
 * until the drive is unlocked again.
 *
 * @param {string} driveId - Storage-source ID
 */
function clearDEK(driveId) {
    dekCache.delete(driveId);
}

/**
 * Check whether a drive has a key.blob file.
 *
 * @param {string} drivePath - Root directory of the drive
 * @returns {boolean}
 */
function hasKeyBlob(drivePath) {
    return fs.existsSync(path.join(drivePath, 'key.blob'));
}

/**
 * Check whether a drive's DEK is currently cached in memory.
 *
 * @param {string} driveId - Storage-source ID
 * @returns {boolean}
 */
function isDriveUnlocked(driveId) {
    return dekCache.has(driveId);
}

module.exports = {
    createKeyBlob,
    unwrapDEK,
    getActiveDEK,
    clearDEK,
    hasKeyBlob,
    isDriveUnlocked
};
