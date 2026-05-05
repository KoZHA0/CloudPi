/**
 * Tests for backend/utils/key-wrap.js
 *
 * Run with:
 *   node --test tests/key-wrap.test.js
 */

'use strict';

const { test } = require('node:test');
const assert   = require('node:assert/strict');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const crypto   = require('crypto');

const {
    createKeyBlob,
    unwrapDEK,
    getActiveDEK,
    clearDEK,
    hasKeyBlob,
    isDriveUnlocked
} = require('../utils/key-wrap');

// ── Helper: create a temporary directory ─────────────────────────────────────
function makeTmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'cloudpi-keywrap-test-'));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test('createKeyBlob writes a valid key.blob to the drive directory', () => {
    const tmpDir = makeTmpDir();
    try {
        const dek = createKeyBlob('correct-horse-battery-staple', tmpDir, 'test-drive-1');

        // Should return a 32-byte DEK
        assert.ok(Buffer.isBuffer(dek), 'DEK should be a Buffer');
        assert.equal(dek.length, 32, 'DEK should be 32 bytes');

        // key.blob should exist
        const blobPath = path.join(tmpDir, 'key.blob');
        assert.ok(fs.existsSync(blobPath), 'key.blob should be created');

        // key.blob should be valid JSON with required fields
        const blob = JSON.parse(fs.readFileSync(blobPath, 'utf8'));
        assert.equal(blob.version, 1);
        assert.equal(blob.kdf, 'scrypt');
        assert.ok(blob.kdfParams, 'kdfParams should be present');
        assert.equal(typeof blob.kdfParams.N, 'number');
        assert.equal(typeof blob.kdfParams.salt, 'string');
        assert.equal(blob.kdfParams.salt.length, 64, 'salt should be 32 bytes (64 hex chars)');
        assert.equal(typeof blob.wrapIv, 'string');
        assert.equal(blob.wrapIv.length, 24, 'wrapIv should be 12 bytes (24 hex chars)');
        assert.equal(typeof blob.wrappedDek, 'string');
        assert.equal(blob.wrappedDek.length, 96, 'wrappedDek should be 48 bytes (96 hex chars)');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('createKeyBlob caches the DEK in memory', () => {
    const tmpDir = makeTmpDir();
    try {
        clearDEK('test-drive-cache');
        assert.equal(getActiveDEK('test-drive-cache'), null, 'DEK should not be cached before createKeyBlob');

        createKeyBlob('passphrase123', tmpDir, 'test-drive-cache');

        const cached = getActiveDEK('test-drive-cache');
        assert.ok(cached !== null, 'DEK should be cached after createKeyBlob');
        assert.ok(Buffer.isBuffer(cached));
        assert.equal(cached.length, 32);
    } finally {
        clearDEK('test-drive-cache');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('createKeyBlob throws if key.blob already exists', () => {
    const tmpDir = makeTmpDir();
    try {
        createKeyBlob('first-passphrase', tmpDir, 'test-drive-dup');
        assert.throws(
            () => createKeyBlob('second-passphrase', tmpDir, 'test-drive-dup'),
            /key\.blob already exists/
        );
    } finally {
        clearDEK('test-drive-dup');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('createKeyBlob throws if passphrase is empty', () => {
    const tmpDir = makeTmpDir();
    try {
        assert.throws(
            () => createKeyBlob('', tmpDir, 'test-drive-empty'),
            /Passphrase must not be empty/
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('unwrapDEK returns the same DEK created by createKeyBlob', () => {
    const tmpDir = makeTmpDir();
    try {
        const passphrase = 'my-super-secret-passphrase';
        const originalDek = createKeyBlob(passphrase, tmpDir, 'test-drive-unwrap');
        clearDEK('test-drive-unwrap'); // remove from cache to test unwrap

        const unwrapped = unwrapDEK(passphrase, tmpDir, 'test-drive-unwrap');
        assert.ok(Buffer.isBuffer(unwrapped));
        assert.equal(unwrapped.length, 32);
        assert.ok(originalDek.equals(unwrapped), 'Unwrapped DEK should match original DEK');
    } finally {
        clearDEK('test-drive-unwrap');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('unwrapDEK caches the DEK in memory', () => {
    const tmpDir = makeTmpDir();
    try {
        const passphrase = 'cache-test-passphrase';
        createKeyBlob(passphrase, tmpDir, 'test-drive-cache2');
        clearDEK('test-drive-cache2');

        assert.equal(isDriveUnlocked('test-drive-cache2'), false, 'Drive should be locked after clearDEK');

        unwrapDEK(passphrase, tmpDir, 'test-drive-cache2');

        assert.equal(isDriveUnlocked('test-drive-cache2'), true, 'Drive should be unlocked after unwrapDEK');
    } finally {
        clearDEK('test-drive-cache2');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('unwrapDEK throws on wrong passphrase', () => {
    const tmpDir = makeTmpDir();
    try {
        createKeyBlob('correct-passphrase', tmpDir, 'test-drive-wrong');
        clearDEK('test-drive-wrong');

        assert.throws(
            () => unwrapDEK('wrong-passphrase', tmpDir, 'test-drive-wrong'),
            /Wrong passphrase|authentication failed/
        );
    } finally {
        clearDEK('test-drive-wrong');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('unwrapDEK throws if key.blob is missing', () => {
    const tmpDir = makeTmpDir();
    try {
        assert.throws(
            () => unwrapDEK('some-passphrase', tmpDir, 'test-drive-nofile'),
            /key\.blob not found/
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('hasKeyBlob returns true after createKeyBlob, false on empty dir', () => {
    const tmpDir = makeTmpDir();
    try {
        assert.equal(hasKeyBlob(tmpDir), false, 'hasKeyBlob should be false before setup');

        createKeyBlob('test-passphrase-hkb', tmpDir, 'test-drive-hkb');
        assert.equal(hasKeyBlob(tmpDir), true, 'hasKeyBlob should be true after setup');
    } finally {
        clearDEK('test-drive-hkb');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('clearDEK removes the DEK from memory', () => {
    const tmpDir = makeTmpDir();
    try {
        createKeyBlob('clear-test-passphrase', tmpDir, 'test-drive-clear');
        assert.ok(getActiveDEK('test-drive-clear') !== null, 'DEK should be in cache');

        clearDEK('test-drive-clear');
        assert.equal(getActiveDEK('test-drive-clear'), null, 'DEK should be gone after clearDEK');
        assert.equal(isDriveUnlocked('test-drive-clear'), false);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('two drives with the same passphrase produce different DEKs and salts', () => {
    const tmpDir1 = makeTmpDir();
    const tmpDir2 = makeTmpDir();
    try {
        const passphrase = 'shared-passphrase';
        const dek1 = createKeyBlob(passphrase, tmpDir1, 'test-drive-multi1');
        const dek2 = createKeyBlob(passphrase, tmpDir2, 'test-drive-multi2');

        // DEKs are random — must differ
        assert.ok(!dek1.equals(dek2), 'DEKs for different drives must differ');

        // Salts must differ
        const blob1 = JSON.parse(fs.readFileSync(path.join(tmpDir1, 'key.blob'), 'utf8'));
        const blob2 = JSON.parse(fs.readFileSync(path.join(tmpDir2, 'key.blob'), 'utf8'));
        assert.notEqual(blob1.kdfParams.salt, blob2.kdfParams.salt, 'Salts must differ between drives');
    } finally {
        clearDEK('test-drive-multi1');
        clearDEK('test-drive-multi2');
        fs.rmSync(tmpDir1, { recursive: true, force: true });
        fs.rmSync(tmpDir2, { recursive: true, force: true });
    }
});

test('key.blob is not plaintext-searchable for the DEK', () => {
    const tmpDir = makeTmpDir();
    try {
        const dek = createKeyBlob('plaintext-check-passphrase', tmpDir, 'test-drive-plain');
        const blobContent = fs.readFileSync(path.join(tmpDir, 'key.blob'), 'utf8');

        // The plaintext DEK hex should NOT appear in key.blob
        assert.ok(
            !blobContent.includes(dek.toString('hex')),
            'Plaintext DEK must not appear in key.blob'
        );
    } finally {
        clearDEK('test-drive-plain');
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('encryptFileWithKey and decryptFileToBufferWithKey round-trip', async () => {
    const tmpDir = makeTmpDir();
    const plainPath = path.join(tmpDir, 'plain.txt');
    const encPath   = path.join(tmpDir, 'enc.bin');
    try {
        const { encryptFileWithKey, decryptFileToBufferWithKey } = require('../utils/crypto-utils');

        const plaintext = Buffer.from('Hello, CloudPi key-wrapping!');
        fs.writeFileSync(plainPath, plaintext);

        const dek = crypto.randomBytes(32);
        await encryptFileWithKey(plainPath, encPath, dek);

        // Encrypted file should differ from plaintext
        const encData = fs.readFileSync(encPath);
        assert.ok(!encData.equals(plaintext), 'Encrypted file must differ from plaintext');
        assert.ok(encData.length > plaintext.length, 'Encrypted file must be longer (IV + authTag)');

        // Decrypt and compare
        const decrypted = await decryptFileToBufferWithKey(encPath, dek);
        assert.ok(decrypted.equals(plaintext), 'Decrypted content must match original');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('decryptFileToBufferWithKey throws with wrong key', async () => {
    const tmpDir = makeTmpDir();
    const plainPath = path.join(tmpDir, 'plain.txt');
    const encPath   = path.join(tmpDir, 'enc.bin');
    try {
        const { encryptFileWithKey, decryptFileToBufferWithKey } = require('../utils/crypto-utils');

        fs.writeFileSync(plainPath, 'secret data');
        const correctKey = crypto.randomBytes(32);
        const wrongKey   = crypto.randomBytes(32);

        await encryptFileWithKey(plainPath, encPath, correctKey);
        await assert.rejects(
            () => decryptFileToBufferWithKey(encPath, wrongKey),
            'Should reject with wrong key'
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
