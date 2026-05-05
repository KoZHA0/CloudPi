/**
 * CRYPTO UTILITIES
 * ================
 * Provides SHA-256 hashing and AES-256-GCM encryption for file security.
 *
 * SHA-256 HASHING:
 *   - Computes a unique fingerprint of each file on upload
 *   - Verifies file integrity on download (detects corruption/tampering)
 *
 * AES-256-GCM ENCRYPTION:
 *   - Encrypts files at rest so raw disk access doesn't expose user data
 *   - Uses authenticated encryption (GCM) which also detects tampering
 *   - Each file gets a unique random IV (initialization vector)
 *
 * FILE FORMAT (encrypted files on disk):
 *   [12 bytes IV][16 bytes Auth Tag][...encrypted data...]
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// AES-256-GCM constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;        // GCM recommended IV length
const AUTH_TAG_LENGTH = 16;  // GCM auth tag length
const KEY_LENGTH = 32;       // 256 bits

/**
 * Get or generate the encryption key.
 * Reads from CLOUDPI_ENCRYPTION_KEY env var.
 * If not set, generates a random key and saves it to .env file.
 *
 * @returns {Buffer} 32-byte encryption key
 */
function getEncryptionKey() {
    let keyHex = process.env.CLOUDPI_ENCRYPTION_KEY;

    if (keyHex && keyHex.trim().length === 64) {
        return Buffer.from(keyHex.trim(), 'hex');
    }

    // Generate a new random key
    const newKey = crypto.randomBytes(KEY_LENGTH);
    const newKeyHex = newKey.toString('hex');

    // Save to .env file
    const envPath = path.join(__dirname, '..', '.env');
    try {
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }

        if (envContent.includes('CLOUDPI_ENCRYPTION_KEY=')) {
            // Replace existing empty key
            envContent = envContent.replace(
                /CLOUDPI_ENCRYPTION_KEY=.*/,
                `CLOUDPI_ENCRYPTION_KEY=${newKeyHex}`
            );
        } else {
            // Append the key
            envContent += `\nCLOUDPI_ENCRYPTION_KEY=${newKeyHex}\n`;
        }

        fs.writeFileSync(envPath, envContent);
        console.log('🔐 Generated new encryption key and saved to .env');
    } catch (err) {
        console.error('⚠️  Could not save encryption key to .env:', err.message);
        console.error('   Store this key safely — without it, encrypted files are unrecoverable!');
        console.error(`   CLOUDPI_ENCRYPTION_KEY=${newKeyHex}`);
    }

    // Update process.env so subsequent calls don't regenerate
    process.env.CLOUDPI_ENCRYPTION_KEY = newKeyHex;

    return newKey;
}

// ============================================
// SHA-256 HASHING
// ============================================

/**
 * Compute SHA-256 hash of a file.
 * Reads the file as a stream for memory efficiency (handles large files).
 *
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<string>} Hex-encoded SHA-256 hash
 */
function computeFileHash(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);

        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err) => reject(err));
    });
}

/**
 * Verify a file's SHA-256 hash against an expected value.
 *
 * @param {string} filePath - Absolute path to the file
 * @param {string} expectedHash - Expected hex-encoded SHA-256 hash
 * @returns {Promise<{valid: boolean, computedHash: string}>}
 */
async function verifyFileHash(filePath, expectedHash) {
    const computedHash = await computeFileHash(filePath);
    return {
        valid: computedHash === expectedHash,
        computedHash
    };
}

// ============================================
// AES-256-GCM ENCRYPTION
// ============================================

/**
 * Encrypt a file using AES-256-GCM.
 * Reads the entire file, encrypts it, and writes the ciphertext
 * with IV and auth tag prepended.
 *
 * File format: [12-byte IV][16-byte AuthTag][ciphertext...]
 *
 * @param {string} inputPath - Path to plaintext file
 * @param {string} outputPath - Path to write encrypted file (can be same as input)
 * @returns {Promise<void>}
 */
function encryptFile(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            const key = getEncryptionKey();
            const iv = crypto.randomBytes(IV_LENGTH);

            // Read plaintext
            const plaintext = fs.readFileSync(inputPath);

            // Encrypt
            const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
                authTagLength: AUTH_TAG_LENGTH
            });
            const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            const authTag = cipher.getAuthTag();

            // Write: IV + AuthTag + Ciphertext
            const output = Buffer.concat([iv, authTag, encrypted]);
            fs.writeFileSync(outputPath, output);

            resolve();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Decrypt a file that was encrypted with encryptFile().
 * Reads IV and auth tag from the file header, decrypts the rest.
 *
 * @param {string} inputPath - Path to encrypted file
 * @param {string} outputPath - Path to write decrypted file
 * @returns {Promise<void>}
 */
function decryptFile(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        try {
            const key = getEncryptionKey();

            // Read encrypted file
            const data = fs.readFileSync(inputPath);

            if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
                return reject(new Error('Encrypted file is too small — possibly corrupted'));
            }

            // Extract IV, auth tag, and ciphertext
            const iv = data.subarray(0, IV_LENGTH);
            const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
            const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

            // Decrypt
            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
                authTagLength: AUTH_TAG_LENGTH
            });
            decipher.setAuthTag(authTag);
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

            fs.writeFileSync(outputPath, decrypted);

            resolve();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Decrypt a file and return the plaintext as a Buffer (no temp file).
 * Useful for streaming previews and downloads.
 *
 * @param {string} inputPath - Path to encrypted file
 * @returns {Promise<Buffer>} Decrypted file contents
 */
function decryptFileToBuffer(inputPath) {
    return new Promise((resolve, reject) => {
        try {
            const key = getEncryptionKey();
            const data = fs.readFileSync(inputPath);

            if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
                return reject(new Error('Encrypted file is too small — possibly corrupted'));
            }

            const iv = data.subarray(0, IV_LENGTH);
            const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
            const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
                authTagLength: AUTH_TAG_LENGTH
            });
            decipher.setAuthTag(authTag);
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

            resolve(decrypted);
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Check if encryption is enabled in admin settings.
 * Reads the 'encryption_enabled' key from the settings table.
 *
 * @param {object} db - better-sqlite3 database instance
 * @returns {boolean}
 */
function isEncryptionEnabled(db) {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'encryption_enabled'").get();
        return row ? row.value === '1' : true; // Default: enabled
    } catch (err) {
        return true; // Default: enabled if we can't read settings
    }
}

// ============================================
// EXPLICIT-KEY VARIANTS (used with per-drive DEKs)
// ============================================

/**
 * Encrypt a file using AES-256-GCM with an explicitly supplied key.
 * Used when a per-drive DEK has been unlocked via key-wrap.js.
 * File format is identical to encryptFile() — [12-byte IV][16-byte AuthTag][ciphertext].
 *
 * @param {string} inputPath  - Path to plaintext file
 * @param {string} outputPath - Path to write encrypted file (can be same as input)
 * @param {Buffer} key        - 32-byte AES-256 key (the unwrapped DEK)
 * @returns {Promise<void>}
 */
function encryptFileWithKey(inputPath, outputPath, key) {
    return new Promise((resolve, reject) => {
        try {
            if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
                return reject(new Error('encryptFileWithKey: key must be a 32-byte Buffer'));
            }

            const iv        = crypto.randomBytes(IV_LENGTH);
            const plaintext = fs.readFileSync(inputPath);

            const cipher    = crypto.createCipheriv(ALGORITHM, key, iv, {
                authTagLength: AUTH_TAG_LENGTH
            });
            const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
            const authTag   = cipher.getAuthTag();

            fs.writeFileSync(outputPath, Buffer.concat([iv, authTag, encrypted]));
            resolve();
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Decrypt a file encrypted with encryptFileWithKey() and return the plaintext as a Buffer.
 *
 * @param {string} inputPath - Path to encrypted file
 * @param {Buffer} key       - 32-byte AES-256 key (the unwrapped DEK)
 * @returns {Promise<Buffer>} Decrypted file contents
 */
function decryptFileToBufferWithKey(inputPath, key) {
    return new Promise((resolve, reject) => {
        try {
            if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
                return reject(new Error('decryptFileToBufferWithKey: key must be a 32-byte Buffer'));
            }

            const data = fs.readFileSync(inputPath);

            if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
                return reject(new Error('Encrypted file is too small — possibly corrupted'));
            }

            const iv         = data.subarray(0, IV_LENGTH);
            const authTag    = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
            const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

            const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
                authTagLength: AUTH_TAG_LENGTH
            });
            decipher.setAuthTag(authTag);
            const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

            resolve(decrypted);
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = {
    computeFileHash,
    verifyFileHash,
    encryptFile,
    decryptFile,
    decryptFileToBuffer,
    encryptFileWithKey,
    decryptFileToBufferWithKey,
    getEncryptionKey,
    isEncryptionEnabled
};
