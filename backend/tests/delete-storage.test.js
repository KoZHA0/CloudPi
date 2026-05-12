/**
 * Test: DELETE /api/admin/storage/:id FK constraint fix
 *
 * Validates that removing a storage source does not throw a
 * FOREIGN KEY constraint error when users still reference it
 * via default_storage_id (users.default_storage_id → storage_sources.id).
 *
 * Uses an in-memory SQLite database so it does not affect production data.
 */
'use strict';

const Database = require('better-sqlite3');

// Build a minimal in-memory DB that mirrors the relevant schema
function buildTestDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    db.exec(`
        CREATE TABLE storage_sources (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            path TEXT NOT NULL,
            type TEXT DEFAULT 'external',
            is_active INTEGER DEFAULT 1,
            total_bytes INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            default_storage_id TEXT REFERENCES storage_sources(id)
        );

        CREATE TABLE files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            storage_source_id TEXT REFERENCES storage_sources(id),
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            size INTEGER DEFAULT 0,
            type TEXT DEFAULT 'file'
        );

        CREATE TABLE file_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
            storage_source_id TEXT REFERENCES storage_sources(id),
            path TEXT NOT NULL,
            size INTEGER DEFAULT 0
        );
    `);

    return db;
}

/**
 * Simulates the delete-storage logic from admin.js, including the FK fix.
 * Returns { ok, error, clearedUserIds } so tests can assert on the outcome.
 */
function deleteStorage(db, sourceId) {
    const source = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(sourceId);
    if (!source) return { ok: false, error: 'not_found' };
    if (source.type === 'internal') return { ok: false, error: 'internal' };

    const liveCount = db.prepare(
        'SELECT COUNT(*) as count FROM files WHERE storage_source_id = ?'
    ).get(sourceId).count;
    const versionCount = db.prepare(
        'SELECT COUNT(*) as count FROM file_versions WHERE storage_source_id = ?'
    ).get(sourceId).count;
    if (liveCount + versionCount > 0) return { ok: false, error: 'has_files' };

    // Clear dependent user default_storage_id references before deletion
    const affectedUsers = db.prepare(
        'SELECT id FROM users WHERE default_storage_id = ?'
    ).all(sourceId).map(u => u.id);
    if (affectedUsers.length > 0) {
        db.prepare('UPDATE users SET default_storage_id = NULL WHERE default_storage_id = ?').run(sourceId);
    }

    db.prepare('DELETE FROM storage_sources WHERE id = ?').run(sourceId);
    return { ok: true, clearedUserIds: affectedUsers };
}

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failed++;
    }
}

// ─── Test 1: delete with no dependents succeeds ──────────────────────────────
{
    const db = buildTestDb();
    db.prepare('INSERT INTO storage_sources (id, label, path, type) VALUES (?, ?, ?, ?)').run(
        'drive-1', 'USB Drive 1', '/media/pi/USB1', 'external'
    );

    const result = deleteStorage(db, 'drive-1');
    assert(result.ok === true, 'deletes storage source with no dependents');
    const row = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get('drive-1');
    assert(row === undefined, 'row is gone from storage_sources');
}

// ─── Test 2: delete clears users.default_storage_id and succeeds ─────────────
{
    const db = buildTestDb();
    db.prepare('INSERT INTO storage_sources (id, label, path, type) VALUES (?, ?, ?, ?)').run(
        'drive-2', 'USB Drive 2', '/media/pi/USB2', 'external'
    );
    // User whose default storage points at the drive being deleted
    db.prepare('INSERT INTO users (username, default_storage_id) VALUES (?, ?)').run('alice', 'drive-2');

    let threwFK = false;
    let result;
    try {
        result = deleteStorage(db, 'drive-2');
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') threwFK = true;
    }

    assert(!threwFK, 'no FOREIGN KEY constraint error is thrown');
    assert(result && result.ok === true, 'delete returns ok=true');
    assert(result && result.clearedUserIds && result.clearedUserIds.length === 1,
        'one user ID is reported as cleared');

    const driveRow = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get('drive-2');
    assert(driveRow === undefined, 'storage source is removed from DB');

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get('alice');
    assert(user !== undefined, 'user record still exists');
    assert(user.default_storage_id === null, 'user.default_storage_id is set to NULL');
}

// ─── Test 3: delete blocked when files reference the source ──────────────────
{
    const db = buildTestDb();
    db.prepare('INSERT INTO storage_sources (id, label, path, type) VALUES (?, ?, ?, ?)').run(
        'drive-3', 'USB Drive 3', '/media/pi/USB3', 'external'
    );
    db.prepare('INSERT INTO users (username) VALUES (?)').run('bob');
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get('bob');
    db.prepare('INSERT INTO files (user_id, storage_source_id, name, path) VALUES (?, ?, ?, ?)').run(
        user.id, 'drive-3', 'report.pdf', 'report.pdf'
    );

    const result = deleteStorage(db, 'drive-3');
    assert(result.ok === false && result.error === 'has_files',
        'delete is blocked when files still reference the storage source');

    const driveRow = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get('drive-3');
    assert(driveRow !== undefined, 'storage source is NOT removed (still has files)');
}

// ─── Test 4: delete blocked when versions reference the source ───────────────
{
    const db = buildTestDb();
    db.prepare('INSERT INTO storage_sources (id, label, path, type) VALUES (?, ?, ?, ?)').run(
        'drive-4', 'USB Drive 4', '/media/pi/USB4', 'external'
    );
    db.prepare('INSERT INTO storage_sources (id, label, path, type) VALUES (?, ?, ?, ?)').run(
        'internal', 'Internal Storage', '/app/backend/storage', 'internal'
    );
    db.prepare('INSERT INTO users (username) VALUES (?)').run('carol');
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get('carol');
    const file = db.prepare('INSERT INTO files (user_id, storage_source_id, name, path) VALUES (?, ?, ?, ?)').run(
        user.id, 'internal', 'report.pdf', 'live.pdf'
    );
    db.prepare('INSERT INTO file_versions (file_id, storage_source_id, path, size) VALUES (?, ?, ?, ?)').run(
        file.lastInsertRowid, 'drive-4', 'old-report.pdf', 10
    );

    const result = deleteStorage(db, 'drive-4');
    assert(result.ok === false && result.error === 'has_files',
        'delete is blocked when file versions still reference the storage source');

    const driveRow = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get('drive-4');
    assert(driveRow !== undefined, 'storage source is NOT removed (still has versions)');
}

// ─── Test 5: delete blocked for internal storage ─────────────────────────────
{
    const db = buildTestDb();
    db.prepare('INSERT INTO storage_sources (id, label, path, type) VALUES (?, ?, ?, ?)').run(
        'internal', 'Internal Storage', '/app/backend/storage', 'internal'
    );

    const result = deleteStorage(db, 'internal');
    assert(result.ok === false && result.error === 'internal',
        'delete is blocked for internal storage');
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} test(s): ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
