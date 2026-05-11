/**
 * CRYPTO UTILITIES — AES-256-GCM File Encryption + SHA-256 Hashing
 * =================================================================
 * Provides:
 *   - SHA-256 file hashing for integrity verification
 *   - AES-256-GCM streaming file encryption/decryption
 *
 * MASTER KEY LIFECYCLE:
 *   The 256-bit master encryption key is loaded from the CLOUDPI_ENCRYPTION_KEY
 *   environment variable once at module load time. It is held in application
 *   memory for the duration of the server process. No disk read is required
 *   for individual encrypt/decrypt operations.
 *
 * ENCRYPTED FILE BINARY FORMAT:
 *   Bytes  0–11:  Initialization Vector (12 bytes, unique per file)
 *   Bytes 12–27:  GCM Authentication Tag (16 bytes, integrity proof)
 *   Bytes 28–EOF: Ciphertext (AES-256-GCM encrypted file content)
 *
 * SECURITY MODEL:
 *   - An attacker who steals only the external drive gets encrypted ciphertext
 *     with no means of decryption (key lives on the Pi's SD card / env file).
 *   - An attacker who steals only the Pi gets the key but no encrypted data.
 *   - Both components are required simultaneously.
 */

const crypto = require('crypto');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { Transform } = require('stream');

// ── Constants ─────────────────────────────────────────────────────────────────
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;       // 96 bits — recommended for GCM
const AUTH_TAG_LENGTH = 16;  // 128 bits
const HEADER_LENGTH = IV_LENGTH + AUTH_TAG_LENGTH; // 28 bytes
const CHUNK_SIZE = 64 * 1024; // 64 KB streaming chunks

// ── Master Key ────────────────────────────────────────────────────────────────
let _masterKey = null;

/**
 * Load the master encryption key from environment.
 * Called once at server startup. Throws if the key is missing or invalid.
 */
function loadMasterKey() {
    const hexKey = process.env.CLOUDPI_ENCRYPTION_KEY;
    if (!hexKey || hexKey.length !== 64) {
        throw new Error(
            'CLOUDPI_ENCRYPTION_KEY must be a 64-character hex string (256 bits). ' +
            'Generate one with: openssl rand -hex 32'
        );
    }
    _masterKey = Buffer.from(hexKey, 'hex');
    console.log('🔐 Master encryption key loaded successfully');
}

/**
 * Check whether the master key is available in memory.
 * @returns {boolean}
 */
function isEncryptionAvailable() {
    return _masterKey !== null && _masterKey.length === 32;
}

/**
 * Get the master key, throwing if not loaded.
 * @returns {Buffer}
 */
function getMasterKey() {
    if (!isEncryptionAvailable()) {
        throw new Error('Master encryption key not loaded — call loadMasterKey() first');
    }
    return _masterKey;
}

// ── Hashing ───────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of a file on disk.
 * Used during upload to record a hash for later integrity verification.
 * IMPORTANT: Always hash the PLAINTEXT before encryption so identical files
 * produce the same hash regardless of their unique IVs.
 *
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

// ── Encryption ────────────────────────────────────────────────────────────────

/**
 * Encrypt a file using AES-256-GCM streaming.
 * Reads plaintext from inputPath, writes encrypted output to outputPath
 * in the binary format: [IV (12B)][AuthTag (16B)][Ciphertext].
 *
 * Memory usage is constant regardless of file size (streams in 64KB chunks).
 *
 * @param {string} inputPath  - Path to the plaintext file
 * @param {string} outputPath - Path to write the encrypted file
 * @returns {Promise<{iv: Buffer, authTag: Buffer, encryptedSize: number}>}
 */
async function encryptFile(inputPath, outputPath) {
    const key = getMasterKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });

    const readStream = fs.createReadStream(inputPath, { highWaterMark: CHUNK_SIZE });
    const writeStream = fs.createWriteStream(outputPath);

    // Write the IV as the file header (first 12 bytes)
    writeStream.write(iv);

    // Reserve 16 bytes for the auth tag (we'll write it after encryption completes)
    const authTagPlaceholder = Buffer.alloc(AUTH_TAG_LENGTH);
    writeStream.write(authTagPlaceholder);

    // Stream plaintext → cipher → output file
    await pipeline(readStream, cipher, writeStream);

    // Retrieve the auth tag (available only after cipher.final())
    const authTag = cipher.getAuthTag();

    // Write the auth tag at byte offset 12 (overwrite the placeholder)
    const fd = fs.openSync(outputPath, 'r+');
    fs.writeSync(fd, authTag, 0, AUTH_TAG_LENGTH, IV_LENGTH);
    fs.closeSync(fd);

    const encryptedSize = fs.statSync(outputPath).size;

    return { iv, authTag, encryptedSize };
}

/**
 * Create a readable stream of decrypted plaintext from an encrypted file.
 * Parses the 28-byte header (IV + authTag), verifies the GCM authentication
 * tag, and streams decrypted content.
 *
 * If the auth tag does not match (file tampered or corrupted), the decipher
 * stream will emit an error — no partial plaintext is produced.
 *
 * @param {string} encryptedFilePath - Path to the encrypted file on disk
 * @returns {{ stream: import('stream').Readable, iv: Buffer, authTag: Buffer }}
 */
function createDecryptStream(encryptedFilePath) {
    const key = getMasterKey();

    // Read the 28-byte header synchronously (fast, microseconds)
    const fd = fs.openSync(encryptedFilePath, 'r');
    const headerBuf = Buffer.alloc(HEADER_LENGTH);
    fs.readSync(fd, headerBuf, 0, HEADER_LENGTH, 0);
    fs.closeSync(fd);

    const iv = headerBuf.subarray(0, IV_LENGTH);
    const authTag = headerBuf.subarray(IV_LENGTH, HEADER_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    // Read ciphertext starting after the 28-byte header
    const readStream = fs.createReadStream(encryptedFilePath, {
        start: HEADER_LENGTH,
        highWaterMark: CHUNK_SIZE,
    });

    // Pipe ciphertext through the decipher to produce plaintext
    const decryptedStream = readStream.pipe(decipher);

    return { stream: decryptedStream, iv, authTag };
}

/**
 * Decrypt an encrypted file and stream the plaintext into a writable stream
 * (typically an HTTP response). Handles auth tag verification errors gracefully.
 *
 * @param {string} encryptedFilePath - Path to the encrypted file
 * @param {import('stream').Writable} destination - Where to pipe decrypted data (e.g. res)
 * @returns {Promise<void>}
 * @throws {Error} If auth tag verification fails or read errors occur
 */
async function decryptToStream(encryptedFilePath, destination) {
    const { stream } = createDecryptStream(encryptedFilePath);

    return new Promise((resolve, reject) => {
        stream.on('error', (err) => {
            // GCM auth tag failure produces an error with message:
            // "Unsupported state or unable to authenticate data"
            if (err.message.includes('authenticate')) {
                reject(new Error('FILE_INTEGRITY_FAILED: The file authentication tag does not match. The file may be corrupted or tampered with.'));
            } else {
                reject(err);
            }
        });

        stream.pipe(destination);

        stream.on('end', resolve);
        destination.on('error', reject);
    });
}

// ── Settings Helper ───────────────────────────────────────────────────────────

/**
 * Check if encryption is enabled in the admin settings.
 * @param {object} db - The better-sqlite3 database instance
 * @returns {boolean}
 */
function isEncryptionEnabled(db) {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'encryption_enabled'").get();
    return row && row.value === '1';
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
    // Key management
    loadMasterKey,
    isEncryptionAvailable,

    // Hashing
    computeFileHash,
    verifyFileHash,

    // Encryption / Decryption
    encryptFile,
    createDecryptStream,
    decryptToStream,
    isEncryptionEnabled,

    // Constants (for testing / external use)
    IV_LENGTH,
    AUTH_TAG_LENGTH,
    HEADER_LENGTH,
};
