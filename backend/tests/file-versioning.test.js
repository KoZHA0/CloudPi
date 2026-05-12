'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
    ensureFileVersioningSchema,
    createFileVersionUniqueIndexes,
    migrateDuplicateActiveSiblings,
    saveUploadedFileVersionAware,
    restoreFileVersion,
    deleteFileVersion,
    deleteAllVersionsForFile,
    pruneFileVersions,
    getTotalUsedBytesForUser,
} = require('../utils/file-versioning');

function buildDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL
        );

        CREATE TABLE storage_sources (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            path TEXT NOT NULL,
            type TEXT DEFAULT 'external',
            is_active INTEGER DEFAULT 1,
            is_accessible INTEGER DEFAULT 1,
            total_bytes INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            type TEXT NOT NULL,
            size INTEGER DEFAULT 0,
            mime_type TEXT,
            parent_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
            starred INTEGER DEFAULT 0,
            trashed INTEGER DEFAULT 0,
            trashed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            storage_source_id TEXT REFERENCES storage_sources(id),
            sha256_hash TEXT DEFAULT NULL,
            encrypted INTEGER DEFAULT 0,
            encryption_auth_tag TEXT DEFAULT NULL,
            integrity_failed INTEGER DEFAULT 0,
            storage_id TEXT DEFAULT NULL,
            encrypted_metadata TEXT DEFAULT NULL,
            e2ee_iv TEXT DEFAULT NULL,
            is_chunked INTEGER DEFAULT 0,
            chunk_count INTEGER DEFAULT 0,
            vault_root_id INTEGER REFERENCES files(id),
            is_secure_vault INTEGER DEFAULT 0
        );

        CREATE TABLE shares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            shared_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            shared_with INTEGER REFERENCES users(id) ON DELETE CASCADE,
            shared_with_email TEXT,
            permission TEXT DEFAULT 'view',
            share_link TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    db.prepare("INSERT INTO users (username) VALUES ('owner'), ('friend')").run();
    db.prepare("INSERT INTO storage_sources (id, label, path, type) VALUES ('internal', 'Internal', ?, 'internal')").run(os.tmpdir());
    ensureFileVersioningSchema(db);
    return db;
}

function insertFile(db, attrs) {
    const defaults = {
        user_id: 1,
        name: 'file.txt',
        path: `blob-${Math.random()}`,
        type: 'document',
        size: 1,
        mime_type: 'text/plain',
        parent_id: null,
        starred: 0,
        trashed: 0,
        modified_at: '2026-01-01 00:00:00',
        storage_source_id: 'internal',
        sha256_hash: null,
        encrypted: 0,
        e2ee_iv: null,
        encryption_auth_tag: null,
        integrity_failed: 0,
        vault_root_id: null,
        is_secure_vault: 0,
        version_number: 1,
    };
    const row = { ...defaults, ...attrs };
    const result = db.prepare(`
        INSERT INTO files (
            user_id, name, path, type, size, mime_type, parent_id, starred,
            trashed, modified_at, storage_source_id, sha256_hash, encrypted,
            e2ee_iv, encryption_auth_tag, integrity_failed, vault_root_id,
            is_secure_vault, version_number
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        row.user_id,
        row.name,
        row.path,
        row.type,
        row.size,
        row.mime_type,
        row.parent_id,
        row.starred,
        row.trashed,
        row.modified_at,
        row.storage_source_id,
        row.sha256_hash,
        row.encrypted,
        row.e2ee_iv,
        row.encryption_auth_tag,
        row.integrity_failed,
        row.vault_root_id,
        row.is_secure_vault,
        row.version_number,
    );
    return result.lastInsertRowid;
}

function testDuplicateFilesMergeIntoVersions() {
    const db = buildDb();
    const oldId = insertFile(db, {
        name: 'report.txt',
        path: 'old-report',
        size: 11,
        starred: 1,
        modified_at: '2026-01-01 10:00:00',
        sha256_hash: 'oldhash',
        encrypted: 1,
        e2ee_iv: 'oldiv',
        encryption_auth_tag: 'oldtag',
    });
    const liveId = insertFile(db, {
        name: 'report.txt',
        path: 'new-report',
        size: 22,
        modified_at: '2026-01-02 10:00:00',
    });
    db.prepare("INSERT INTO shares (file_id, shared_by, shared_with, permission, share_link) VALUES (?, 1, 2, 'view', 'old-link')").run(oldId);
    db.prepare("INSERT INTO shares (file_id, shared_by, shared_with, permission, share_link) VALUES (?, 1, NULL, 'view', 'public-link')").run(oldId);

    const result = migrateDuplicateActiveSiblings(db);
    createFileVersionUniqueIndexes(db);

    assert.strictEqual(result.fileRowsMerged, 1);
    const liveRows = db.prepare("SELECT * FROM files WHERE name = 'report.txt'").all();
    assert.strictEqual(liveRows.length, 1);
    assert.strictEqual(liveRows[0].id, liveId);
    assert.strictEqual(liveRows[0].path, 'new-report');
    assert.strictEqual(liveRows[0].starred, 1);
    assert.strictEqual(liveRows[0].version_number, 2);

    const versions = db.prepare('SELECT * FROM file_versions WHERE file_id = ?').all(liveId);
    assert.strictEqual(versions.length, 1);
    assert.strictEqual(versions[0].path, 'old-report');
    assert.strictEqual(versions[0].sha256_hash, 'oldhash');
    assert.strictEqual(versions[0].e2ee_iv, 'oldiv');
    assert.strictEqual(versions[0].encryption_auth_tag, 'oldtag');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM shares WHERE file_id = ?').get(liveId).count, 2);
    db.close();
}

function testDuplicateFoldersMergeRecursively() {
    const db = buildDb();
    const oldFolder = insertFile(db, {
        name: 'Projects',
        path: '',
        type: 'folder',
        size: 0,
        mime_type: null,
        modified_at: '2026-01-01 10:00:00',
    });
    const liveFolder = insertFile(db, {
        name: 'Projects',
        path: '',
        type: 'folder',
        size: 0,
        mime_type: null,
        modified_at: '2026-01-02 10:00:00',
    });
    insertFile(db, { name: 'notes.txt', path: 'old-notes', size: 12, parent_id: oldFolder, modified_at: '2026-01-01 11:00:00' });
    insertFile(db, { name: 'notes.txt', path: 'new-notes', size: 21, parent_id: liveFolder, modified_at: '2026-01-02 11:00:00' });

    const result = migrateDuplicateActiveSiblings(db);
    createFileVersionUniqueIndexes(db);

    assert.strictEqual(result.folderRowsMerged, 1);
    assert.strictEqual(result.fileRowsMerged, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM files WHERE name = 'Projects'").get().count, 1);
    const child = db.prepare("SELECT * FROM files WHERE name = 'notes.txt'").get();
    assert.strictEqual(child.parent_id, liveFolder);
    assert.strictEqual(child.path, 'new-notes');
    assert.strictEqual(db.prepare('SELECT path FROM file_versions WHERE file_id = ?').get(child.id).path, 'old-notes');
    db.close();
}

function testVaultRowsAreHandledSafely() {
    const db = buildDb();
    const olderVault = insertFile(db, {
        name: 'Vault',
        path: '',
        type: 'folder',
        size: 0,
        mime_type: null,
        is_secure_vault: 1,
        modified_at: '2026-01-01 10:00:00',
    });
    db.prepare('UPDATE files SET vault_root_id = ? WHERE id = ?').run(olderVault, olderVault);
    const newerVault = insertFile(db, {
        name: 'Vault',
        path: '',
        type: 'folder',
        size: 0,
        mime_type: null,
        is_secure_vault: 1,
        modified_at: '2026-01-02 10:00:00',
    });
    db.prepare('UPDATE files SET vault_root_id = ? WHERE id = ?').run(newerVault, newerVault);

    insertFile(db, {
        name: 'Encrypted file',
        path: 'vault-blob-1',
        parent_id: newerVault,
        vault_root_id: newerVault,
        encrypted: 1,
    });
    insertFile(db, {
        name: 'Encrypted file',
        path: 'vault-blob-2',
        parent_id: newerVault,
        vault_root_id: newerVault,
        encrypted: 1,
    });

    const result = migrateDuplicateActiveSiblings(db);
    createFileVersionUniqueIndexes(db);

    assert.strictEqual(result.renamed, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM files WHERE name = 'Vault' AND is_secure_vault = 1").get().count, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM files WHERE name LIKE 'Vault (%)' AND is_secure_vault = 1").get().count, 1);
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS count FROM files WHERE name = 'Encrypted file' AND vault_root_id = ?").get(newerVault).count, 2);
    db.close();
}

function testOverwriteRestoreAndQuotaAccounting() {
    const db = buildDb();
    const first = saveUploadedFileVersionAware(db, {
        userId: 1,
        parentId: null,
        name: 'draft.txt',
        path: 'draft-v1',
        type: 'document',
        size: 100,
        mimeType: 'text/plain',
        storageSourceId: 'internal',
        sha256Hash: 'h1',
        encrypted: 1,
        e2eeIv: 'iv1',
        encryptionAuthTag: 'tag1',
    });
    const second = saveUploadedFileVersionAware(db, {
        userId: 1,
        parentId: null,
        name: 'draft.txt',
        path: 'draft-v2',
        type: 'document',
        size: 200,
        mimeType: 'text/markdown',
        storageSourceId: 'internal',
        sha256Hash: 'h2',
        encrypted: 1,
        e2eeIv: 'iv2',
        encryptionAuthTag: 'tag2',
    });

    assert.strictEqual(second.id, first.id);
    assert.strictEqual(second.version_number, 2);
    assert.strictEqual(second.path, 'draft-v2');
    assert.strictEqual(getTotalUsedBytesForUser(db, 1), 300);

    const archived = db.prepare('SELECT * FROM file_versions WHERE file_id = ?').get(first.id);
    assert.strictEqual(archived.path, 'draft-v1');
    assert.strictEqual(archived.e2ee_iv, 'iv1');
    assert.strictEqual(archived.encryption_auth_tag, 'tag1');

    const restored = restoreFileVersion(db, 1, first.id, archived.id);
    assert.strictEqual(restored.path, 'draft-v1');
    assert.strictEqual(restored.version_number, 3);
    const remainingVersions = db.prepare('SELECT path FROM file_versions WHERE file_id = ?').all(first.id).map(v => v.path);
    assert.deepStrictEqual(remainingVersions, ['draft-v2']);
    db.close();
}

function testFolderConflictDeleteAndPrune() {
    const db = buildDb();
    insertFile(db, {
        name: 'blocked.txt',
        path: '',
        type: 'folder',
        size: 0,
        mime_type: null,
    });

    assert.throws(() => saveUploadedFileVersionAware(db, {
        userId: 1,
        parentId: null,
        name: 'blocked.txt',
        path: 'should-not-insert',
        type: 'document',
        size: 1,
        mimeType: 'text/plain',
        storageSourceId: 'internal',
    }), error => error.statusCode === 409);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudpi-version-test-'));
    const live = saveUploadedFileVersionAware(db, {
        userId: 1,
        parentId: null,
        name: 'history.txt',
        path: 'live',
        type: 'document',
        size: 1,
        mimeType: 'text/plain',
        storageSourceId: 'internal',
    });

    for (let i = 1; i <= 12; i += 1) {
        const blob = `version-${i}`;
        fs.writeFileSync(path.join(tmpDir, blob), String(i));
        db.prepare(`
            INSERT INTO file_versions (file_id, version_number, path, storage_source_id, type, size, mime_type, archived_at)
            VALUES (?, ?, ?, 'internal', 'document', 1, 'text/plain', ?)
        `).run(live.id, i, blob, new Date(Date.UTC(2026, 0, i, 12)).toISOString());
    }

    const deleteBlob = version => {
        const target = path.join(tmpDir, version.path);
        if (fs.existsSync(target)) fs.unlinkSync(target);
    };

    const deletedOne = deleteFileVersion(db, 1, live.id, 1, deleteBlob);
    assert.strictEqual(deletedOne.path, 'version-1');
    assert.strictEqual(fs.existsSync(path.join(tmpDir, 'version-1')), false);

    const pruned = pruneFileVersions(db, live.id, deleteBlob, new Date(Date.UTC(2026, 1, 15, 12)));
    assert.ok(pruned > 0);
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM file_versions WHERE file_id = ?').get(live.id).count <= 10);

    deleteAllVersionsForFile(db, live.id, deleteBlob);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM file_versions WHERE file_id = ?').get(live.id).count, 0);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    db.close();
}

const tests = [
    testDuplicateFilesMergeIntoVersions,
    testDuplicateFoldersMergeRecursively,
    testVaultRowsAreHandledSafely,
    testOverwriteRestoreAndQuotaAccounting,
    testFolderConflictDeleteAndPrune,
];

let passed = 0;
for (const test of tests) {
    test();
    console.log(`  OK ${test.name}`);
    passed += 1;
}

console.log(`file-versioning.test.js: ${passed} test(s) passed`);
