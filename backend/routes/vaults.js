const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { JWT_SECRET } = require('../utils/auth-config');

const router = express.Router();

const DEFAULT_STORAGE_DIR = path.join(__dirname, '..', 'storage');
const SECURE_STORAGE_ROOT = '.vault';
const SECURE_UPLOAD_TEMP_ROOT = '.vault-tmp';
const MAX_CHUNK_UPLOAD_BYTES = 6 * 1024 * 1024;

function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = db.prepare('SELECT token_version, is_admin, is_disabled FROM users WHERE id = ?').get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        if (user.is_disabled) {
            return res.status(403).json({ error: 'Account is disabled' });
        }

        const tokenVersion = decoded.tokenVersion || 0;
        const dbTokenVersion = user.token_version || 1;
        if (tokenVersion !== dbTokenVersion) {
            return res.status(401).json({ error: 'Token expired or invalidated' });
        }

        req.user = { ...decoded, is_admin: user.is_admin };
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Vault auth error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
}

function normalizeParentId(parentId) {
    if (parentId === null || parentId === undefined || parentId === '') return null;
    const parsed = Number(parentId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function getStorageBasePath(storageSourceId, userId) {
    if (!storageSourceId || storageSourceId === 'internal') {
        return path.join(DEFAULT_STORAGE_DIR, String(userId));
    }

    const source = db.prepare('SELECT path, is_active FROM storage_sources WHERE id = ?').get(storageSourceId);
    if (!source || !source.is_active) {
        return path.join(DEFAULT_STORAGE_DIR, String(userId));
    }

    return path.join(source.path, 'cloudpi-data', String(userId));
}

function getUserStorageId(userId) {
    const user = db.prepare('SELECT default_storage_id FROM users WHERE id = ?').get(userId);
    const storageId = (user && user.default_storage_id) || 'internal';

    if (storageId !== 'internal') {
        const source = db.prepare('SELECT path, is_active, is_accessible FROM storage_sources WHERE id = ?').get(storageId);
        if (!source || !source.is_active || !source.is_accessible) {
            return 'internal';
        }
    }

    return storageId;
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getVaultRelativePath(storageId) {
    return path.join(SECURE_STORAGE_ROOT, storageId);
}

function getVaultAbsolutePath(storageSourceId, userId, storageId) {
    return path.join(getStorageBasePath(storageSourceId, userId), getVaultRelativePath(storageId));
}

function getUploadTempPath(storageSourceId, userId, uploadId) {
    return path.join(getStorageBasePath(storageSourceId, userId), SECURE_UPLOAD_TEMP_ROOT, uploadId);
}

function getChunkFilePath(baseDir, index) {
    return path.join(baseDir, `chunk-${String(index).padStart(6, '0')}.bin`);
}

function getFileType(mimeType) {
    if (!mimeType) return 'document';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.includes('pdf')) return 'document';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar')) return 'archive';
    return 'document';
}

function loadFolder(userId, folderId) {
    return db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ? AND type = \'folder\' AND trashed = 0').get(folderId, userId);
}

function loadVault(userId, vaultId) {
    return db.prepare(
        'SELECT f.*, l.salt, l.encrypted_dek, l.dek_iv FROM files f JOIN folder_locks l ON l.folder_id = f.id WHERE f.id = ? AND f.user_id = ? AND f.type = \'folder\' AND f.is_secure_vault = 1 AND f.trashed = 0'
    ).get(vaultId, userId);
}

function ensureFolderInVault(userId, folderId, vaultId) {
    let current = loadFolder(userId, folderId);

    while (current) {
        if (Number(current.id) === Number(vaultId) && current.is_secure_vault === 1) {
            return true;
        }
        if (!current.parent_id) {
            break;
        }
        current = loadFolder(userId, current.parent_id);
    }

    return false;
}

function removePathRecursive(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) {
        return;
    }
    fs.rmSync(targetPath, { recursive: true, force: true });
}

router.post('/', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const parentId = normalizeParentId(req.body.parent_id);
        const { name, salt, encrypted_dek: encryptedDek, dek_iv: dekIv } = req.body;
        let storageSourceId = getUserStorageId(userId);

        if (!name || !String(name).trim()) {
            return res.status(400).json({ error: 'Vault name is required' });
        }

        if (!salt || !encryptedDek || !dekIv) {
            return res.status(400).json({ error: 'Vault key metadata is required' });
        }

        if (parentId) {
            const parent = db.prepare(
                'SELECT id, is_secure_vault, vault_root_id, storage_source_id FROM files WHERE id = ? AND user_id = ? AND type = \'folder\' AND trashed = 0'
            ).get(parentId, userId);
            if (!parent) {
                return res.status(400).json({ error: 'Parent folder not found' });
            }
            if (parent.vault_root_id || parent.is_secure_vault === 1) {
                return res.status(400).json({ error: 'Nested vault roots are not supported' });
            }
            storageSourceId = parent.storage_source_id || storageSourceId;
        }

        let existingQuery = 'SELECT id FROM files WHERE user_id = ? AND name = ? AND type = \'folder\' AND trashed = 0';
        const params = [userId, String(name).trim()];
        if (parentId) {
            existingQuery += ' AND parent_id = ?';
            params.push(parentId);
        } else {
            existingQuery += ' AND parent_id IS NULL';
        }

        if (db.prepare(existingQuery).get(...params)) {
            return res.status(400).json({ error: 'Folder with this name already exists' });
        }

        const inserted = db.prepare(`
            INSERT INTO files (user_id, name, path, type, parent_id, storage_source_id, is_secure_vault)
            VALUES (?, ?, '', 'folder', ?, ?, 1)
        `).run(userId, String(name).trim(), parentId, storageSourceId);

        const vaultId = inserted.lastInsertRowid;
        db.prepare('UPDATE files SET vault_root_id = ? WHERE id = ?').run(vaultId, vaultId);
        db.prepare(`
            INSERT INTO folder_locks (folder_id, user_id, salt, encrypted_dek, dek_iv)
            VALUES (?, ?, ?, ?, ?)
        `).run(vaultId, userId, salt, encryptedDek, dekIv);

        const vault = db.prepare('SELECT * FROM files WHERE id = ?').get(vaultId);
        return res.status(201).json({
            message: 'Secure vault created successfully',
            folder: vault,
        });
    } catch (error) {
        console.error('Create vault error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.get('/:id', requireAuth, (req, res) => {
    try {
        const vault = loadVault(req.user.userId, Number(req.params.id));
        if (!vault) {
            return res.status(404).json({ error: 'Vault not found' });
        }

        return res.json({
            vault: {
                id: vault.id,
                name: vault.name,
                parent_id: vault.parent_id,
                salt: vault.salt,
                encrypted_dek: vault.encrypted_dek,
                dek_iv: vault.dek_iv,
                created_at: vault.created_at,
            },
        });
    } catch (error) {
        console.error('Get vault error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.put('/:id/pin', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const vaultId = Number(req.params.id);
        const { salt, encrypted_dek: encryptedDek, dek_iv: dekIv } = req.body;

        if (!salt || !encryptedDek || !dekIv) {
            return res.status(400).json({ error: 'Updated vault key metadata is required' });
        }

        const vault = loadVault(userId, vaultId);
        if (!vault) {
            return res.status(404).json({ error: 'Vault not found' });
        }

        db.prepare('UPDATE folder_locks SET salt = ?, encrypted_dek = ?, dek_iv = ? WHERE folder_id = ? AND user_id = ?')
            .run(salt, encryptedDek, dekIv, vaultId, userId);

        return res.json({ message: 'Vault PIN updated successfully' });
    } catch (error) {
        console.error('Change vault PIN error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.post('/:vaultId/folders', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const vaultId = Number(req.params.vaultId);
        const parentId = normalizeParentId(req.body.parent_id) || vaultId;
        const { encrypted_metadata: encryptedMetadata } = req.body;

        if (!encryptedMetadata) {
            return res.status(400).json({ error: 'Encrypted folder metadata is required' });
        }

        const vault = loadVault(userId, vaultId);
        if (!vault) {
            return res.status(404).json({ error: 'Vault not found' });
        }

        const parentFolder = loadFolder(userId, parentId);
        if (!parentFolder || !ensureFolderInVault(userId, parentId, vaultId)) {
            return res.status(400).json({ error: 'Parent folder is not inside this vault' });
        }

        const result = db.prepare(`
            INSERT INTO files (
                user_id, name, path, type, parent_id, storage_source_id,
                encrypted_metadata, vault_root_id
            )
            VALUES (?, 'Encrypted folder', '', 'folder', ?, ?, ?, ?)
        `).run(
            userId,
            parentId,
            vault.storage_source_id || 'internal',
            encryptedMetadata,
            vaultId,
        );

        const folder = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid);
        return res.status(201).json({
            message: 'Encrypted folder created successfully',
            folder,
        });
    } catch (error) {
        console.error('Create secure child folder error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.put('/items/:id', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const itemId = Number(req.params.id);
        const { encrypted_metadata: encryptedMetadata } = req.body;

        if (!encryptedMetadata) {
            return res.status(400).json({ error: 'Encrypted metadata is required' });
        }

        const item = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ? AND trashed = 0').get(itemId, userId);
        if (!item || !item.vault_root_id || item.is_secure_vault === 1) {
            return res.status(404).json({ error: 'Secure vault item not found' });
        }

        db.prepare('UPDATE files SET encrypted_metadata = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(encryptedMetadata, itemId);

        return res.json({ message: 'Encrypted item renamed successfully' });
    } catch (error) {
        console.error('Rename secure item error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.post('/:vaultId/uploads/init', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const vaultId = Number(req.params.vaultId);
        const parentId = normalizeParentId(req.body.parent_id) || vaultId;
        const {
            storage_id: storageId,
            encrypted_metadata: encryptedMetadata,
            e2ee_iv: e2eeIv,
            chunk_count: chunkCount,
            size,
            mime_type: mimeType,
        } = req.body;

        if (!storageId || !encryptedMetadata || !e2eeIv) {
            return res.status(400).json({ error: 'Secure upload metadata is incomplete' });
        }

        const parsedChunkCount = Number(chunkCount);
        const parsedSize = Number(size);
        if (!Number.isInteger(parsedChunkCount) || parsedChunkCount < 1) {
            return res.status(400).json({ error: 'Invalid chunk count' });
        }
        if (!Number.isFinite(parsedSize) || parsedSize < 0) {
            return res.status(400).json({ error: 'Invalid file size' });
        }

        const vault = loadVault(userId, vaultId);
        if (!vault) {
            return res.status(404).json({ error: 'Vault not found' });
        }

        const parentFolder = loadFolder(userId, parentId);
        if (!parentFolder || !ensureFolderInVault(userId, parentId, vaultId)) {
            return res.status(400).json({ error: 'Parent folder is not inside this vault' });
        }

        const uploadId = uuidv4();
        const tempPath = getUploadTempPath(vault.storage_source_id || 'internal', userId, uploadId);
        ensureDir(tempPath);

        db.prepare(`
            INSERT INTO vault_upload_sessions (
                id, user_id, vault_root_id, parent_id, storage_source_id, storage_id,
                mime_type, size, chunk_count, encrypted_metadata, e2ee_iv, temp_path
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            uploadId,
            userId,
            vaultId,
            parentId,
            vault.storage_source_id || 'internal',
            storageId,
            mimeType || null,
            parsedSize,
            parsedChunkCount,
            encryptedMetadata,
            e2eeIv,
            tempPath,
        );

        return res.status(201).json({
            upload: {
                id: uploadId,
                chunk_count: parsedChunkCount,
            },
        });
    } catch (error) {
        console.error('Init secure upload error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.put(
    '/uploads/:uploadId/chunks/:index',
    requireAuth,
    express.raw({ type: 'application/octet-stream', limit: `${MAX_CHUNK_UPLOAD_BYTES}b` }),
    (req, res) => {
        try {
            const userId = req.user.userId;
            const uploadId = String(req.params.uploadId);
            const index = Number(req.params.index);

            const session = db.prepare('SELECT * FROM vault_upload_sessions WHERE id = ? AND user_id = ?').get(uploadId, userId);
            if (!session) {
                return res.status(404).json({ error: 'Upload session not found' });
            }

            if (!Number.isInteger(index) || index < 0 || index >= session.chunk_count) {
                return res.status(400).json({ error: 'Chunk index is out of range' });
            }

            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                return res.status(400).json({ error: 'Chunk body is required' });
            }

            ensureDir(session.temp_path);
            fs.writeFileSync(getChunkFilePath(session.temp_path, index), req.body);

            return res.json({ message: 'Chunk stored' });
        } catch (error) {
            console.error('Store secure upload chunk error:', error);
            return res.status(500).json({ error: 'Server error' });
        }
    },
);

router.post('/uploads/:uploadId/complete', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const uploadId = String(req.params.uploadId);
        const session = db.prepare('SELECT * FROM vault_upload_sessions WHERE id = ? AND user_id = ?').get(uploadId, userId);

        if (!session) {
            return res.status(404).json({ error: 'Upload session not found' });
        }

        for (let index = 0; index < session.chunk_count; index += 1) {
            if (!fs.existsSync(getChunkFilePath(session.temp_path, index))) {
                return res.status(400).json({ error: `Missing uploaded chunk ${index + 1}` });
            }
        }

        const finalPath = getVaultAbsolutePath(session.storage_source_id, userId, session.storage_id);
        const finalParent = path.dirname(finalPath);
        ensureDir(finalParent);
        removePathRecursive(finalPath);
        fs.renameSync(session.temp_path, finalPath);

        const result = db.prepare(`
            INSERT INTO files (
                user_id, name, path, type, size, mime_type, parent_id, storage_source_id,
                storage_id, encrypted_metadata, e2ee_iv, is_chunked, chunk_count,
                vault_root_id, encrypted
            )
            VALUES (?, 'Encrypted file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run(
            userId,
            getVaultRelativePath(session.storage_id),
            getFileType(session.mime_type),
            session.size,
            session.mime_type,
            session.parent_id,
            session.storage_source_id,
            session.storage_id,
            session.encrypted_metadata,
            session.e2ee_iv,
            session.chunk_count > 1 ? 1 : 0,
            session.chunk_count,
            session.vault_root_id,
        );

        db.prepare('DELETE FROM vault_upload_sessions WHERE id = ?').run(uploadId);
        const file = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid);

        return res.status(201).json({
            message: 'Encrypted upload completed successfully',
            file,
        });
    } catch (error) {
        console.error('Complete secure upload error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/uploads/:uploadId', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const uploadId = String(req.params.uploadId);
        const session = db.prepare('SELECT * FROM vault_upload_sessions WHERE id = ? AND user_id = ?').get(uploadId, userId);

        if (!session) {
            return res.status(404).json({ error: 'Upload session not found' });
        }

        removePathRecursive(session.temp_path);
        db.prepare('DELETE FROM vault_upload_sessions WHERE id = ?').run(uploadId);

        return res.json({ message: 'Upload session aborted' });
    } catch (error) {
        console.error('Abort secure upload error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.get('/files/:id/chunks/:index', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = Number(req.params.id);
        const index = Number(req.params.index);

        const file = db.prepare(`
            SELECT * FROM files
            WHERE id = ? AND user_id = ? AND type != 'folder' AND trashed = 0 AND vault_root_id IS NOT NULL
        `).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'Secure file not found' });
        }

        if (!Number.isInteger(index) || index < 0 || index >= (file.chunk_count || 0)) {
            return res.status(400).json({ error: 'Chunk index is out of range' });
        }

        const chunkPath = getChunkFilePath(path.join(getStorageBasePath(file.storage_source_id, userId), file.path), index);
        if (!fs.existsSync(chunkPath)) {
            return res.status(404).json({ error: 'Chunk not found on disk' });
        }

        res.set('Content-Type', 'application/octet-stream');
        res.set('Cache-Control', 'no-store');
        const stream = fs.createReadStream(path.resolve(chunkPath));
        stream.on('error', (streamError) => {
            console.error('Stream secure file chunk error:', streamError);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Server error streaming secure chunk' });
            } else {
                res.destroy(streamError);
            }
        });
        return stream.pipe(res);
    } catch (error) {
        console.error('Get secure file chunk error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
