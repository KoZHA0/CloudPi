'use strict';

const MAX_VERSIONS_PER_FILE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function splitFileName(name) {
    const ext = require('path').extname(name || '');
    if (!ext) return { base: name || 'item', ext: '' };
    return { base: name.slice(0, -ext.length), ext };
}

function isVaultInternalItem(row) {
    return !!row && row.vault_root_id !== null && row.vault_root_id !== undefined && row.is_secure_vault !== 1;
}

function isVisibleVersioningSibling(row) {
    return !!row && row.trashed === 0 && !isVaultInternalItem(row);
}

function isVersionableFile(row) {
    return !!row && row.type !== 'folder' && !isVaultInternalItem(row) && row.is_secure_vault !== 1;
}

function sortableTimestamp(row) {
    return row.modified_at || row.created_at || '';
}

function newestFirst(a, b) {
    const byDate = sortableTimestamp(b).localeCompare(sortableTimestamp(a));
    if (byDate !== 0) return byDate;
    return Number(b.id) - Number(a.id);
}

function oldestFirst(a, b) {
    const byDate = sortableTimestamp(a).localeCompare(sortableTimestamp(b));
    if (byDate !== 0) return byDate;
    return Number(a.id) - Number(b.id);
}

function ensureFileVersioningSchema(db) {
    try {
        db.exec('ALTER TABLE files ADD COLUMN version_number INTEGER NOT NULL DEFAULT 1');
    } catch (_) {
        // Column already exists.
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS file_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            version_number INTEGER NOT NULL,
            path TEXT NOT NULL,
            storage_source_id TEXT REFERENCES storage_sources(id),
            type TEXT NOT NULL,
            size INTEGER DEFAULT 0,
            mime_type TEXT,
            sha256_hash TEXT DEFAULT NULL,
            encrypted INTEGER DEFAULT 0,
            e2ee_iv TEXT DEFAULT NULL,
            encryption_auth_tag TEXT DEFAULT NULL,
            integrity_failed INTEGER DEFAULT 0,
            archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
            UNIQUE(file_id, version_number)
        )
    `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_file_versions_file_id ON file_versions(file_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_file_versions_storage_source ON file_versions(storage_source_id)');
}

function createFileVersionUniqueIndexes(db) {
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_files_unique_active_root_name
        ON files(user_id, name)
        WHERE parent_id IS NULL
          AND trashed = 0
          AND (vault_root_id IS NULL OR is_secure_vault = 1)
    `);

    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_files_unique_active_nested_name
        ON files(user_id, parent_id, name)
        WHERE parent_id IS NOT NULL
          AND trashed = 0
          AND (vault_root_id IS NULL OR is_secure_vault = 1)
    `);
}

function hasActiveManagedNameConflict(db, userId, parentId, name, excludeId = null) {
    const params = [userId, name];
    let sql = `
        SELECT id FROM files
        WHERE user_id = ?
          AND name = ?
          AND trashed = 0
          AND (vault_root_id IS NULL OR is_secure_vault = 1)
    `;

    if (excludeId !== null && excludeId !== undefined) {
        sql += ' AND id != ?';
        params.push(excludeId);
    }

    if (parentId === null || parentId === undefined) {
        sql += ' AND parent_id IS NULL';
    } else {
        sql += ' AND parent_id = ?';
        params.push(parentId);
    }

    return !!db.prepare(sql).get(...params);
}

function uniqueSiblingName(db, row) {
    const { base, ext } = splitFileName(row.name);
    for (let counter = 1; counter < 10000; counter += 1) {
        const candidate = `${base} (${counter})${ext}`;
        if (!hasActiveManagedNameConflict(db, row.user_id, row.parent_id, candidate, row.id)) {
            return candidate;
        }
    }
    return `${base} (${row.id})${ext}`;
}

function renameRowUniquely(db, row) {
    const nextName = uniqueSiblingName(db, row);
    db.prepare('UPDATE files SET name = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(nextName, row.id);
    return { renamed: 1, nextName };
}

function consolidateShares(db, sourceFileId, targetFileId) {
    if (Number(sourceFileId) === Number(targetFileId)) return 0;
    const changed = db.prepare('UPDATE shares SET file_id = ? WHERE file_id = ?').run(targetFileId, sourceFileId).changes;

    db.prepare(`
        DELETE FROM shares
        WHERE shared_with IS NOT NULL
          AND file_id = ?
          AND id NOT IN (
              SELECT MIN(id)
              FROM shares
              WHERE shared_with IS NOT NULL AND file_id = ?
              GROUP BY shared_by, shared_with, COALESCE(permission, '')
          )
    `).run(targetFileId, targetFileId);

    return changed;
}

function maxExistingVersionNumber(db, fileId) {
    const row = db.prepare(`
        SELECT COALESCE(MAX(version_number), 0) AS maxVersion
        FROM file_versions
        WHERE file_id = ?
    `).get(fileId);
    return Number(row?.maxVersion || 0);
}

function nextAvailableVersionNumber(db, fileId, preferred) {
    let candidate = Number(preferred) || 1;
    const maxExisting = maxExistingVersionNumber(db, fileId);
    if (candidate <= maxExisting) candidate = maxExisting + 1;
    while (db.prepare('SELECT id FROM file_versions WHERE file_id = ? AND version_number = ?').get(fileId, candidate)) {
        candidate += 1;
    }
    return candidate;
}

function insertFileVersion(db, file, versionNumber, archivedAt = null) {
    return db.prepare(`
        INSERT INTO file_versions (
            file_id, version_number, path, storage_source_id, type, size, mime_type,
            sha256_hash, encrypted, e2ee_iv, encryption_auth_tag, integrity_failed, archived_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `).run(
        file.id,
        versionNumber,
        file.path,
        file.storage_source_id || 'internal',
        file.type,
        file.size || 0,
        file.mime_type || null,
        file.sha256_hash || null,
        file.encrypted || 0,
        file.e2ee_iv || null,
        file.encryption_auth_tag || null,
        file.integrity_failed || 0,
        archivedAt,
    );
}

function archiveCurrentVersion(db, file, archivedAt = null) {
    if (!isVersionableFile(file)) {
        throw new Error('Only regular files can be versioned');
    }
    const versionNumber = nextAvailableVersionNumber(db, file.id, file.version_number || 1);
    insertFileVersion(db, file, versionNumber, archivedAt);
    return versionNumber;
}

function getActiveNameConflict(db, userId, parentId, name) {
    const params = [userId, name];
    let sql = `
        SELECT * FROM files
        WHERE user_id = ?
          AND name = ?
          AND trashed = 0
          AND (vault_root_id IS NULL OR is_secure_vault = 1)
    `;
    if (parentId === null || parentId === undefined) {
        sql += ' AND parent_id IS NULL';
    } else {
        sql += ' AND parent_id = ?';
        params.push(parentId);
    }
    sql += ' ORDER BY modified_at DESC, id DESC LIMIT 1';
    return db.prepare(sql).get(...params);
}

function createNameConflictError(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
}

function saveUploadedFileVersionAware(db, metadata) {
    const parentId = metadata.parentId === undefined ? null : metadata.parentId;

    return db.transaction(() => {
        const existing = getActiveNameConflict(db, metadata.userId, parentId, metadata.name);

        if (existing && existing.type === 'folder') {
            throw createNameConflictError('A folder with this name already exists');
        }
        if (existing && !isVersionableFile(existing)) {
            throw createNameConflictError('An item with this name cannot be overwritten');
        }

        if (existing) {
            const archivedVersion = archiveCurrentVersion(db, existing);
            const nextVersion = Math.max(Number(existing.version_number) || 1, archivedVersion) + 1;
            db.prepare(`
                UPDATE files
                SET path = ?,
                    type = ?,
                    size = ?,
                    mime_type = ?,
                    storage_source_id = ?,
                    sha256_hash = ?,
                    encrypted = ?,
                    e2ee_iv = ?,
                    encryption_auth_tag = ?,
                    integrity_failed = 0,
                    version_number = ?,
                    modified_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `).run(
                metadata.path,
                metadata.type,
                metadata.size || 0,
                metadata.mimeType || null,
                metadata.storageSourceId || 'internal',
                metadata.sha256Hash || null,
                metadata.encrypted || 0,
                metadata.e2eeIv || null,
                metadata.encryptionAuthTag || null,
                nextVersion,
                existing.id,
            );
            return db.prepare('SELECT * FROM files WHERE id = ?').get(existing.id);
        }

        const inserted = db.prepare(`
            INSERT INTO files (
                user_id, name, path, type, size, mime_type, parent_id,
                storage_source_id, sha256_hash, encrypted, e2ee_iv,
                encryption_auth_tag, version_number
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
            metadata.userId,
            metadata.name,
            metadata.path,
            metadata.type,
            metadata.size || 0,
            metadata.mimeType || null,
            parentId,
            metadata.storageSourceId || 'internal',
            metadata.sha256Hash || null,
            metadata.encrypted || 0,
            metadata.e2eeIv || null,
            metadata.encryptionAuthTag || null,
        );

        return db.prepare('SELECT * FROM files WHERE id = ?').get(inserted.lastInsertRowid);
    })();
}

function listFileVersions(db, userId, fileId) {
    const file = db.prepare(`
        SELECT * FROM files
        WHERE id = ? AND user_id = ? AND type != 'folder' AND trashed = 0
    `).get(fileId, userId);
    if (!file || !isVersionableFile(file)) return null;

    const versions = db.prepare(`
        SELECT id, file_id, version_number, type, size, mime_type, sha256_hash,
               encrypted, integrity_failed, archived_at
        FROM file_versions
        WHERE file_id = ?
        ORDER BY version_number DESC, archived_at DESC, id DESC
    `).all(fileId);

    const bytesRow = db.prepare(`
        SELECT COALESCE(SUM(size), 0) AS bytes
        FROM file_versions
        WHERE file_id = ?
    `).get(fileId);

    return {
        fileId: file.id,
        currentVersion: file.version_number || 1,
        versionStorageBytes: bytesRow?.bytes || 0,
        versions,
    };
}

function restoreFileVersion(db, userId, fileId, versionId) {
    return db.transaction(() => {
        const file = db.prepare(`
            SELECT * FROM files
            WHERE id = ? AND user_id = ? AND type != 'folder' AND trashed = 0
        `).get(fileId, userId);
        if (!file || !isVersionableFile(file)) return null;

        const version = db.prepare(`
            SELECT * FROM file_versions
            WHERE id = ? AND file_id = ?
        `).get(versionId, fileId);
        if (!version) return null;

        const archivedVersion = archiveCurrentVersion(db, file);
        const nextVersion = Math.max(Number(file.version_number) || 1, archivedVersion) + 1;

        db.prepare('DELETE FROM file_versions WHERE id = ?').run(version.id);
        db.prepare(`
            UPDATE files
            SET path = ?,
                storage_source_id = ?,
                type = ?,
                size = ?,
                mime_type = ?,
                sha256_hash = ?,
                encrypted = ?,
                e2ee_iv = ?,
                encryption_auth_tag = ?,
                integrity_failed = ?,
                version_number = ?,
                modified_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(
            version.path,
            version.storage_source_id || 'internal',
            version.type,
            version.size || 0,
            version.mime_type || null,
            version.sha256_hash || null,
            version.encrypted || 0,
            version.e2ee_iv || null,
            version.encryption_auth_tag || null,
            version.integrity_failed || 0,
            nextVersion,
            file.id,
        );

        return db.prepare('SELECT * FROM files WHERE id = ?').get(file.id);
    })();
}

function getVersionWithOwner(db, userId, fileId, versionId) {
    return db.prepare(`
        SELECT v.*, f.user_id
        FROM file_versions v
        JOIN files f ON f.id = v.file_id
        WHERE v.id = ? AND v.file_id = ? AND f.user_id = ?
    `).get(versionId, fileId, userId);
}

function deleteFileVersion(db, userId, fileId, versionId, deleteVersionBlob) {
    const version = getVersionWithOwner(db, userId, fileId, versionId);
    if (!version) return null;
    deleteVersionBlob(version);
    db.prepare('DELETE FROM file_versions WHERE id = ?').run(version.id);
    return version;
}

function deleteAllVersionsForFile(db, fileId, deleteVersionBlob) {
    const versions = db.prepare(`
        SELECT v.*, f.user_id
        FROM file_versions v
        JOIN files f ON f.id = v.file_id
        WHERE v.file_id = ?
        ORDER BY v.id ASC
    `).all(fileId);

    for (const version of versions) {
        deleteVersionBlob(version);
    }
    db.prepare('DELETE FROM file_versions WHERE file_id = ?').run(fileId);
    return versions.length;
}

function dayKey(date) {
    return date.toISOString().slice(0, 10);
}

function weekKey(date) {
    const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const dayOfYear = Math.floor((date - start) / DAY_MS);
    return `${date.getUTCFullYear()}-W${Math.floor(dayOfYear / 7)}`;
}

function versionsToPrune(versions, now = new Date()) {
    const sorted = [...versions].sort((a, b) => {
        const byDate = String(b.archived_at || '').localeCompare(String(a.archived_at || ''));
        if (byDate !== 0) return byDate;
        return Number(b.id) - Number(a.id);
    });

    const keep = new Set();
    const daily = new Set();
    const weekly = new Set();

    for (const version of sorted) {
        const archivedAt = new Date(version.archived_at);
        if (Number.isNaN(archivedAt.getTime())) continue;

        const ageMs = now.getTime() - archivedAt.getTime();
        const ageDays = Math.floor(ageMs / DAY_MS);

        if (ageMs < DAY_MS) {
            keep.add(version.id);
        } else if (ageDays <= 7) {
            const key = dayKey(archivedAt);
            if (!daily.has(key)) {
                daily.add(key);
                keep.add(version.id);
            }
        } else if (ageDays <= 30) {
            const key = weekKey(archivedAt);
            if (!weekly.has(key)) {
                weekly.add(key);
                keep.add(version.id);
            }
        }
    }

    const cappedKeep = new Set(sorted.filter(v => keep.has(v.id)).slice(0, MAX_VERSIONS_PER_FILE).map(v => v.id));
    return sorted.filter(version => !cappedKeep.has(version.id));
}

function pruneFileVersions(db, fileId, deleteVersionBlob, now = new Date()) {
    const versions = db.prepare(`
        SELECT v.*, f.user_id
        FROM file_versions v
        JOIN files f ON f.id = v.file_id
        WHERE v.file_id = ?
        ORDER BY v.archived_at DESC, v.id DESC
    `).all(fileId);

    const prune = versionsToPrune(versions, now);
    for (const version of prune) {
        deleteVersionBlob(version);
        db.prepare('DELETE FROM file_versions WHERE id = ?').run(version.id);
    }
    return prune.length;
}

function getLiveBytesForUser(db, userId, includeTrashed = false) {
    let sql = "SELECT COALESCE(SUM(size), 0) AS bytes FROM files WHERE user_id = ? AND type != 'folder'";
    if (!includeTrashed) sql += ' AND trashed = 0';
    return db.prepare(sql).get(userId).bytes || 0;
}

function getVersionBytesForUser(db, userId, includeTrashed = false) {
    let sql = `
        SELECT COALESCE(SUM(v.size), 0) AS bytes
        FROM file_versions v
        JOIN files f ON f.id = v.file_id
        WHERE f.user_id = ? AND f.type != 'folder'
    `;
    if (!includeTrashed) sql += ' AND f.trashed = 0';
    return db.prepare(sql).get(userId).bytes || 0;
}

function getTotalUsedBytesForUser(db, userId, includeTrashed = false) {
    return getLiveBytesForUser(db, userId, includeTrashed) + getVersionBytesForUser(db, userId, includeTrashed);
}

function getVersionBytesForStorageSource(db, storageSourceId) {
    return db.prepare(`
        SELECT COALESCE(SUM(size), 0) AS bytes
        FROM file_versions
        WHERE storage_source_id = ?
    `).get(storageSourceId).bytes || 0;
}

function getStorageSourceReferenceCount(db, storageSourceId) {
    const live = db.prepare('SELECT COUNT(*) AS count FROM files WHERE storage_source_id = ?').get(storageSourceId).count || 0;
    const versions = db.prepare('SELECT COUNT(*) AS count FROM file_versions WHERE storage_source_id = ?').get(storageSourceId).count || 0;
    return live + versions;
}

function findDuplicateGroups(db, parentId = undefined) {
    const params = [];
    let sql = `
        SELECT user_id, parent_id, name, COUNT(*) AS count
        FROM files
        WHERE trashed = 0
          AND (vault_root_id IS NULL OR is_secure_vault = 1)
    `;

    if (parentId !== undefined) {
        if (parentId === null) {
            sql += ' AND parent_id IS NULL';
        } else {
            sql += ' AND parent_id = ?';
            params.push(parentId);
        }
    }

    sql += `
        GROUP BY user_id, parent_id, name
        HAVING COUNT(*) > 1
        ORDER BY parent_id IS NOT NULL, parent_id, name
    `;

    return db.prepare(sql).all(...params);
}

function getSiblingRows(db, group) {
    const params = [group.user_id, group.name];
    let sql = `
        SELECT * FROM files
        WHERE user_id = ?
          AND name = ?
          AND trashed = 0
          AND (vault_root_id IS NULL OR is_secure_vault = 1)
    `;

    if (group.parent_id === null || group.parent_id === undefined) {
        sql += ' AND parent_id IS NULL';
    } else {
        sql += ' AND parent_id = ?';
        params.push(group.parent_id);
    }

    return db.prepare(sql).all(...params).sort(newestFirst);
}

function mergeDuplicateFiles(db, rows) {
    const sorted = [...rows].sort(newestFirst);
    const survivor = sorted[0];
    const archived = sorted.slice(1).sort(oldestFirst);
    let versionNumber = maxExistingVersionNumber(db, survivor.id);
    let changed = { fileRowsMerged: 0, sharesMoved: 0 };

    const shouldStar = sorted.some(row => row.starred === 1) ? 1 : survivor.starred || 0;

    for (const row of archived) {
        versionNumber += 1;
        insertFileVersion(db, { ...row, id: survivor.id }, versionNumber, row.modified_at || row.created_at || null);
        changed.sharesMoved += consolidateShares(db, row.id, survivor.id);
        db.prepare('DELETE FROM files WHERE id = ?').run(row.id);
        changed.fileRowsMerged += 1;
    }

    const liveVersionNumber = Math.max(Number(survivor.version_number) || 1, versionNumber + 1);
    db.prepare('UPDATE files SET starred = ?, version_number = ? WHERE id = ?')
        .run(shouldStar, liveVersionNumber, survivor.id);

    return changed;
}

function mergeDuplicateFolders(db, rows) {
    const sorted = [...rows].sort(newestFirst);
    const survivor = sorted[0];
    const duplicates = sorted.slice(1);
    let changed = { folderRowsMerged: 0, sharesMoved: 0, renamed: 0, fileRowsMerged: 0 };
    const shouldStar = sorted.some(row => row.starred === 1) ? 1 : survivor.starred || 0;

    db.prepare('UPDATE files SET starred = ? WHERE id = ?').run(shouldStar, survivor.id);

    for (const folder of duplicates) {
        changed.sharesMoved += consolidateShares(db, folder.id, survivor.id);
        db.prepare('UPDATE files SET parent_id = ? WHERE parent_id = ?')
            .run(survivor.id, folder.id);
        db.prepare('DELETE FROM files WHERE id = ?').run(folder.id);
        changed.folderRowsMerged += 1;

        const childGroups = findDuplicateGroups(db, survivor.id);
        for (const group of childGroups) {
            const childChanged = resolveDuplicateGroup(db, group);
            changed = mergeChangeCounts(changed, childChanged);
        }
    }

    return changed;
}

function mergeChangeCounts(a, b) {
    const merged = { ...a };
    for (const [key, value] of Object.entries(b || {})) {
        merged[key] = (merged[key] || 0) + (value || 0);
    }
    return merged;
}

function resolveDuplicateGroup(db, group) {
    let rows = getSiblingRows(db, group);
    let changed = { renamed: 0, fileRowsMerged: 0, folderRowsMerged: 0, sharesMoved: 0 };
    if (rows.length < 2) return changed;

    const secureRoots = rows.filter(row => row.type === 'folder' && row.is_secure_vault === 1);
    if (secureRoots.length > 0) {
        const keepSecureRootId = secureRoots.length === rows.length ? [...secureRoots].sort(newestFirst)[0].id : null;
        for (const row of secureRoots) {
            if (row.id !== keepSecureRootId) {
                changed = mergeChangeCounts(changed, renameRowUniquely(db, row));
            }
        }
        rows = getSiblingRows(db, group);
        if (rows.length < 2) return changed;
    }

    const allFiles = rows.every(row => row.type !== 'folder' && isVisibleVersioningSibling(row));
    if (allFiles) {
        return mergeChangeCounts(changed, mergeDuplicateFiles(db, rows));
    }

    const allRegularFolders = rows.every(row => row.type === 'folder' && row.is_secure_vault !== 1 && !isVaultInternalItem(row));
    if (allRegularFolders) {
        return mergeChangeCounts(changed, mergeDuplicateFolders(db, rows));
    }

    const sorted = [...rows].sort(newestFirst);
    for (const row of sorted.slice(1)) {
        changed = mergeChangeCounts(changed, renameRowUniquely(db, row));
    }
    return changed;
}

function migrateDuplicateActiveSiblings(db) {
    const run = db.transaction(() => {
        let totals = { renamed: 0, fileRowsMerged: 0, folderRowsMerged: 0, sharesMoved: 0 };
        for (let pass = 0; pass < 1000; pass += 1) {
            const groups = findDuplicateGroups(db);
            if (groups.length === 0) return totals;
            for (const group of groups) {
                totals = mergeChangeCounts(totals, resolveDuplicateGroup(db, group));
            }
        }
        throw new Error('Unable to resolve duplicate active file names after 1000 passes');
    });

    return run();
}

module.exports = {
    MAX_VERSIONS_PER_FILE,
    ensureFileVersioningSchema,
    createFileVersionUniqueIndexes,
    migrateDuplicateActiveSiblings,
    isVersionableFile,
    saveUploadedFileVersionAware,
    archiveCurrentVersion,
    listFileVersions,
    restoreFileVersion,
    deleteFileVersion,
    deleteAllVersionsForFile,
    pruneFileVersions,
    versionsToPrune,
    getLiveBytesForUser,
    getVersionBytesForUser,
    getTotalUsedBytesForUser,
    getVersionBytesForStorageSource,
    getStorageSourceReferenceCount,
};
