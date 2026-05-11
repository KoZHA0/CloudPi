/**
 * SHARES ROUTES
 * =============
 * Handles file sharing between users
 * 
 * Routes:
 *   POST   /api/shares              - Share a file with a user
 *   GET    /api/shares/my-shares     - Files I've shared with others
 *   GET    /api/shares/file/:fileId/access - List who has access to one file
 *   DELETE /api/shares/file/:fileId/access/:userId - Revoke one user's access
 *   GET    /api/shares/shared-with-me - Files shared with me
 *   DELETE /api/shares/:id           - Revoke a share
 *   GET    /api/shares/users         - List users to share with
 *   GET    /api/shares/public/:link  - Public share link access
 *   GET    /api/shares/public/:link/download - Download via share link
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../database/db');
const { JWT_SECRET } = require('../utils/auth-config');
const { ensureProtectedInternalStorageAvailable } = require('../utils/protected-storage');
const { decryptToStream, createDecryptStream } = require('../utils/crypto-utils');

const router = express.Router();

const STORAGE_DIR = path.join(__dirname, '..', 'storage');

function resolveSharedFilePath(file) {
    if (file.storage_source_id && file.storage_source_id !== 'internal') {
        const source = db.prepare('SELECT path FROM storage_sources WHERE id = ?').get(file.storage_source_id);
        if (source) {
            return path.join(source.path, 'cloudpi-data', String(file.user_id), file.path);
        }
    }
    ensureProtectedInternalStorageAvailable();
    return path.join(STORAGE_DIR, String(file.user_id), file.path);
}

// Auth middleware
function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const dbUser = db.prepare('SELECT token_version, is_disabled FROM users WHERE id = ?').get(decoded.userId);
        if (!dbUser) return res.status(401).json({ error: 'User not found' });
        if (dbUser.is_disabled) return res.status(403).json({ error: 'Account is disabled' });
        if (decoded.tokenVersion !== undefined) {
            if (decoded.tokenVersion !== (dbUser.token_version || 1)) {
                return res.status(401).json({ error: 'Token invalidated' });
            }
        }

        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        res.status(500).json({ error: 'Server error' });
    }
}

// ============================================
// STATIC ROUTES (must come before :id routes)
// ============================================

/**
 * GET /api/shares/users
 * List all users (for the share dialog) - excludes current user
 */
router.get('/users', requireAuth, (req, res) => {
    try {
        const users = db.prepare(
            'SELECT id, username FROM users WHERE id != ?'
        ).all(req.user.userId);

        res.json({ users });
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/shares/my-shares
 * List files I've shared with others
 */
router.get('/my-shares', requireAuth, (req, res) => {
    try {
        const shares = db.prepare(`
            SELECT s.*, f.name as file_name, f.type as file_type, f.size as file_size, f.mime_type,
                   u.username as shared_with_name
            FROM shares s
            JOIN files f ON s.file_id = f.id
            LEFT JOIN users u ON s.shared_with = u.id
            WHERE s.shared_by = ?
            ORDER BY s.created_at DESC
        `).all(req.user.userId);

        res.json({ shares });
    } catch (error) {
        console.error('List my shares error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/shares/file/:fileId/access
 * List all users who currently have access to this file
 */
router.get('/file/:fileId/access', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = Number(req.params.fileId);

        const file = db.prepare(
            'SELECT id, name, type FROM files WHERE id = ? AND user_id = ? AND trashed = 0'
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (file.is_secure_vault === 1 || file.vault_root_id !== null) {
            return res.status(400).json({ error: 'Encrypted vault items cannot be shared yet' });
        }

        const accessList = db.prepare(`
            SELECT s.id, s.file_id, s.shared_with, s.permission, s.created_at, s.share_link,
                   u.username as shared_with_name
            FROM shares s
            LEFT JOIN users u ON s.shared_with = u.id
            WHERE s.shared_by = ? AND s.file_id = ?
            ORDER BY s.created_at DESC
        `).all(userId, fileId);

        res.json({
            file: {
                id: file.id,
                name: file.name,
                type: file.type
            },
            access: accessList
        });
    } catch (error) {
        console.error('Get share access error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /api/shares/file/:fileId/access/:userId
 * Revoke a specific user's access to a file
 */
router.delete('/file/:fileId/access/:userId', requireAuth, (req, res) => {
    try {
        const ownerId = req.user.userId;
        const fileId = Number(req.params.fileId);
        const targetUserId = Number(req.params.userId);

        const share = db.prepare(
            'SELECT * FROM shares WHERE file_id = ? AND shared_by = ? AND shared_with = ?'
        ).get(fileId, ownerId, targetUserId);

        if (!share) {
            return res.status(404).json({ error: 'Share not found for this user' });
        }

        db.prepare('DELETE FROM shares WHERE id = ?').run(share.id);
        res.json({ message: 'Access revoked' });
    } catch (error) {
        console.error('Revoke share access error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/shares/shared-with-me
 * List files others have shared with me
 */
router.get('/shared-with-me', requireAuth, (req, res) => {
    try {
        const shares = db.prepare(`
            SELECT s.*, f.name as file_name, f.type as file_type, f.size as file_size, 
                   f.mime_type, f.path as file_path,
                   u.username as shared_by_name
            FROM shares s
            JOIN files f ON s.file_id = f.id
            JOIN users u ON s.shared_by = u.id
            WHERE s.shared_with = ?
            ORDER BY s.created_at DESC
        `).all(req.user.userId);

        res.json({ shares });
    } catch (error) {
        console.error('Shared with me error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/shares/shared-folder/:shareId/files
 * Browse inside a shared folder
 * Query: ?parent_id=<folderId>  (optional, defaults to the shared root folder)
 */
router.get('/shared-folder/:shareId/files', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const shareId = req.params.shareId;

        // Verify this share belongs to the requesting user
        const share = db.prepare(`
            SELECT s.*, f.type as file_type, f.user_id as owner_id
            FROM shares s
            JOIN files f ON s.file_id = f.id
            WHERE s.id = ? AND s.shared_with = ? AND f.type = 'folder'
        `).get(shareId, userId);

        if (!share) {
            return res.status(404).json({ error: 'Shared folder not found' });
        }

        const parentId = req.query.parent_id || share.file_id;

        // Verify the requested parent_id is within the shared folder tree
        if (String(parentId) !== String(share.file_id)) {
            let currentId = parentId;
            let isDescendant = false;
            while (currentId) {
                if (String(currentId) === String(share.file_id)) {
                    isDescendant = true;
                    break;
                }
                const parent = db.prepare(
                    'SELECT parent_id FROM files WHERE id = ? AND user_id = ?'
                ).get(currentId, share.owner_id);
                if (!parent) break;
                currentId = parent.parent_id;
            }
            if (!isDescendant) {
                return res.status(403).json({ error: 'Access denied — folder is outside the shared scope' });
            }
        }

        // List children of the folder
        const files = db.prepare(`
            SELECT id, name, type, size, mime_type, parent_id, created_at, modified_at
            FROM files
            WHERE parent_id = ? AND user_id = ? AND trashed = 0
            ORDER BY CASE WHEN type = 'folder' THEN 0 ELSE 1 END, name ASC
        `).all(parentId, share.owner_id);

        // Build breadcrumbs from parentId up to the shared root
        const breadcrumbs = [];
        let crumbId = parentId;
        while (crumbId && String(crumbId) !== String(share.file_id)) {
            const folder = db.prepare(
                'SELECT id, name, parent_id FROM files WHERE id = ? AND user_id = ?'
            ).get(crumbId, share.owner_id);
            if (folder) {
                breadcrumbs.unshift({ id: folder.id, name: folder.name });
                crumbId = folder.parent_id;
            } else {
                break;
            }
        }
        // Add the shared root folder itself
        const rootFolder = db.prepare('SELECT id, name FROM files WHERE id = ?').get(share.file_id);
        if (rootFolder) {
            breadcrumbs.unshift({ id: rootFolder.id, name: rootFolder.name });
        }

        res.json({ files, breadcrumbs, shareId: Number(shareId), rootFolderId: share.file_id });
    } catch (error) {
        console.error('Browse shared folder error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/shares/shared-folder/:shareId/download/:fileId
 * Download a file from inside a shared folder
 */
router.get('/shared-folder/:shareId/download/:fileId', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const shareId = req.params.shareId;
        const fileId = req.params.fileId;

        // Verify the share
        const share = db.prepare(`
            SELECT s.*, f.type as file_type, f.user_id as owner_id
            FROM shares s
            JOIN files f ON s.file_id = f.id
            WHERE s.id = ? AND s.shared_with = ?
        `).get(shareId, userId);

        if (!share) {
            return res.status(404).json({ error: 'Share not found' });
        }

        // Get the file
        const file = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ? AND trashed = 0'
        ).get(fileId, share.owner_id);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (file.is_secure_vault === 1 || file.vault_root_id !== null) {
            return res.status(400).json({ error: 'Encrypted vault items cannot be downloaded through shares' });
        }

        // Verify the file is inside the shared folder (walk up)
        if (String(file.id) !== String(share.file_id)) {
            let currentId = file.parent_id;
            let isDescendant = false;
            while (currentId) {
                if (String(currentId) === String(share.file_id)) {
                    isDescendant = true;
                    break;
                }
                const parent = db.prepare(
                    'SELECT parent_id FROM files WHERE id = ? AND user_id = ?'
                ).get(currentId, share.owner_id);
                if (!parent) break;
                currentId = parent.parent_id;
            }
            if (!isDescendant) {
                return res.status(403).json({ error: 'File is outside the shared scope' });
            }
        }

        // Resolve file path
        const storageDir = path.join(__dirname, '..', 'storage');
        let filePath;
        if (file.storage_source_id && file.storage_source_id !== 'internal') {
            const source = db.prepare('SELECT path FROM storage_sources WHERE id = ?').get(file.storage_source_id);
            if (source) {
                filePath = path.join(source.path, 'cloudpi-data', String(file.user_id), file.path);
            } else {
                filePath = path.join(storageDir, String(file.user_id), file.path);
            }
        } else {
            filePath = path.join(storageDir, String(file.user_id), file.path);
        }

        if (file.type !== 'folder') {
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'File not found on disk' });
            }
            // Decrypt and stream if encrypted, otherwise serve raw
            if (file.encrypted === 1) {
                res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
                res.set('Content-Type', file.mime_type || 'application/octet-stream');
                try {
                    await decryptToStream(filePath, res);
                } catch (decErr) {
                    console.error('Shared file decryption error:', decErr.message);
                    if (!res.headersSent) return res.status(503).json({ error: 'Failed to decrypt file' });
                }
                return;
            }
            return res.download(filePath, file.name);
        }

        // ZIP download for subfolders
        const archiver = require('archiver');

        function collectFiles(folderId, relativePath) {
            const children = db.prepare(
                'SELECT * FROM files WHERE parent_id = ? AND user_id = ? AND trashed = 0'
            ).all(folderId, share.owner_id);
            const collected = [];
            for (const child of children) {
                const childPath = relativePath ? `${relativePath}/${child.name}` : child.name;
                if (child.type === 'folder') {
                    collected.push(...collectFiles(child.id, childPath));
                } else {
                    let diskPath;
                    if (child.storage_source_id && child.storage_source_id !== 'internal') {
                        const src = db.prepare('SELECT path FROM storage_sources WHERE id = ?').get(child.storage_source_id);
                        diskPath = src
                            ? path.join(src.path, 'cloudpi-data', String(child.user_id), child.path)
                            : path.join(storageDir, String(child.user_id), child.path);
                    } else {
                        diskPath = path.join(storageDir, String(child.user_id), child.path);
                    }
                    if (fs.existsSync(diskPath)) {
                        collected.push({
                            diskPath,
                            archivePath: childPath,
                            encrypted: child.encrypted === 1
                        });
                    }
                }
            }
            return collected;
        }

        const filesToZip = collectFiles(file.id, '');
        if (filesToZip.length === 0) {
            return res.status(400).json({ error: 'Folder is empty' });
        }

        const zipName = `${file.name}.zip`;
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

        const archive = archiver('zip', { zlib: { level: 5 } });
        archive.on('error', (err) => {
            console.error('ZIP error:', err);
            if (!res.headersSent) res.status(500).json({ error: 'ZIP creation failed' });
        });
        archive.pipe(res);
        for (const { diskPath, archivePath, encrypted } of filesToZip) {
            if (encrypted) {
                try {
                    const { stream: decStream } = createDecryptStream(diskPath);
                    archive.append(decStream, { name: archivePath });
                } catch (decErr) {
                    console.error(`Skipping encrypted shared file in ZIP: ${archivePath}`, decErr.message);
                }
            } else {
                archive.file(diskPath, { name: archivePath });
            }
        }
        archive.finalize();
    } catch (error) {
        console.error('Download shared file error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/shares/shared-folder/:shareId/preview/:fileId
 * Preview a file from inside a shared folder (inline)
 */
router.get('/shared-folder/:shareId/preview/:fileId', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const shareId = req.params.shareId;
        const fileId = req.params.fileId;

        const share = db.prepare(`
            SELECT s.*, f.user_id as owner_id
            FROM shares s
            JOIN files f ON s.file_id = f.id
            WHERE s.id = ? AND s.shared_with = ?
        `).get(shareId, userId);

        if (!share) {
            return res.status(404).json({ error: 'Share not found' });
        }

        const file = db.prepare(
            "SELECT * FROM files WHERE id = ? AND user_id = ? AND type != 'folder' AND trashed = 0"
        ).get(fileId, share.owner_id);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (file.is_secure_vault === 1 || file.vault_root_id !== null) {
            return res.status(400).json({ error: 'Encrypted vault items cannot be previewed through shares' });
        }

        // Verify scope
        let currentId = file.parent_id;
        let isDescendant = String(file.id) === String(share.file_id);
        while (currentId && !isDescendant) {
            if (String(currentId) === String(share.file_id)) {
                isDescendant = true;
                break;
            }
            const parent = db.prepare(
                'SELECT parent_id FROM files WHERE id = ? AND user_id = ?'
            ).get(currentId, share.owner_id);
            if (!parent) break;
            currentId = parent.parent_id;
        }
        if (!isDescendant) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const storageDir = path.join(__dirname, '..', 'storage');
        let filePath;
        if (file.storage_source_id && file.storage_source_id !== 'internal') {
            const source = db.prepare('SELECT path FROM storage_sources WHERE id = ?').get(file.storage_source_id);
            filePath = source
                ? path.join(source.path, 'cloudpi-data', String(file.user_id), file.path)
                : path.join(storageDir, String(file.user_id), file.path);
        } else {
            filePath = path.join(storageDir, String(file.user_id), file.path);
        }

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.set('Content-Type', file.mime_type || 'application/octet-stream');
        res.set('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
        res.set('Cache-Control', 'public, max-age=86400');

        res.sendFile(filePath);
    } catch (error) {
        console.error('Preview shared file error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/shares
 * Share a file with a specific user
 * Body: { fileId, sharedWithId, permission? }
 */
router.post('/', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const { fileId, sharedWithId, permission = 'view' } = req.body;

        if (!fileId || !sharedWithId) {
            return res.status(400).json({ error: 'fileId and sharedWithId are required' });
        }

        if (sharedWithId === userId) {
            return res.status(400).json({ error: 'Cannot share with yourself' });
        }

        // Verify the file belongs to the user
        const file = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ?'
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (file.is_secure_vault === 1 || file.vault_root_id !== null) {
            return res.status(400).json({ error: 'Encrypted vault items cannot be shared yet' });
        }

        // Verify target user exists
        const targetUser = db.prepare('SELECT id, username FROM users WHERE id = ?').get(sharedWithId);
        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if already shared with this user
        const existingShare = db.prepare(
            'SELECT * FROM shares WHERE file_id = ? AND shared_by = ? AND shared_with = ?'
        ).get(fileId, userId, sharedWithId);

        if (existingShare) {
            return res.json({
                message: `Already shared with ${targetUser.username}`,
                share: existingShare
            });
        }

        // Generate share link
        const shareLink = crypto.randomBytes(16).toString('hex');

        const result = db.prepare(
            'INSERT INTO shares (file_id, shared_by, shared_with, permission, share_link) VALUES (?, ?, ?, ?, ?)'
        ).run(fileId, userId, sharedWithId, permission, shareLink);

        const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(result.lastInsertRowid);

        res.status(201).json({
            message: `Shared with ${targetUser.username}`,
            share
        });
    } catch (error) {
        console.error('Create share error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// DYNAMIC ROUTES
// ============================================

/**
 * DELETE /api/shares/:id
 * Revoke a share
 */
router.delete('/:id', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const shareId = req.params.id;

        const share = db.prepare(
            'SELECT * FROM shares WHERE id = ? AND shared_by = ?'
        ).get(shareId, userId);

        if (!share) {
            return res.status(404).json({ error: 'Share not found' });
        }

        db.prepare('DELETE FROM shares WHERE id = ?').run(shareId);
        res.json({ message: 'Share revoked' });
    } catch (error) {
        console.error('Delete share error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/shares/public/:link
 * Return metadata for a public share link (NO auth required)
 */
router.get('/public/:link', (req, res) => {
    try {
        const shareLink = req.params.link;

        const share = db.prepare(`
            SELECT s.permission, s.created_at,
                   f.name, f.type, f.size, f.mime_type, f.is_secure_vault, f.vault_root_id,
                   u.username as shared_by
            FROM shares s
            JOIN files f ON s.file_id = f.id
            JOIN users u ON s.shared_by = u.id
            WHERE s.share_link = ? AND f.trashed = 0
        `).get(shareLink);

        if (!share) {
            return res.status(404).json({ error: 'Share link not found' });
        }

        if (share.is_secure_vault === 1 || share.vault_root_id !== null) {
            return res.status(400).json({ error: 'Encrypted vault items cannot be shared publicly' });
        }

        res.json({
            file: {
                name: share.name,
                type: share.type,
                size: share.size,
                mime_type: share.mime_type,
                shared_by: share.shared_by,
                permission: share.permission,
                created_at: share.created_at
            }
        });
    } catch (error) {
        console.error('Public share metadata error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/shares/public/:link/download
 * Download a shared file (NO auth required)
 */
router.get('/public/:link/download', async (req, res) => {
    try {
        const shareLink = req.params.link;

        const share = db.prepare(`
            SELECT s.*, f.name as file_name, f.type as file_type, 
                   f.path as file_path, f.mime_type, f.encrypted, f.storage_source_id, f.user_id,
                   f.is_secure_vault, f.vault_root_id, s.shared_by
            FROM shares s
            JOIN files f ON s.file_id = f.id
            WHERE s.share_link = ? AND f.type != 'folder' AND f.trashed = 0
        `).get(shareLink);

        if (!share) {
            return res.status(404).json({ error: 'Share link not found' });
        }

        if (share.is_secure_vault === 1 || share.vault_root_id !== null) {
            return res.status(400).json({ error: 'Encrypted vault items cannot be downloaded publicly' });
        }

        const filePath = resolveSharedFilePath({
            user_id: share.user_id || share.shared_by,
            storage_source_id: share.storage_source_id,
            path: share.file_path
        });

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.set('Content-Type', share.mime_type || 'application/octet-stream');
        res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(share.file_name)}"`);
        // Decrypt and stream if encrypted, otherwise serve raw
        if (share.encrypted === 1) {
            try {
                await decryptToStream(filePath, res);
            } catch (decErr) {
                console.error('Public download decryption error:', decErr.message);
                if (!res.headersSent) return res.status(503).json({ error: 'Failed to decrypt file' });
            }
        } else {
            res.sendFile(filePath);
        }
    } catch (error) {
        console.error('Public download error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/shares/public/:link/preview
 * View a shared file inline in the browser (NO auth required)
 */
router.get('/public/:link/preview', async (req, res) => {
    try {
        const shareLink = req.params.link;

        const share = db.prepare(`
            SELECT s.*, f.name as file_name, f.type as file_type, 
                   f.path as file_path, f.mime_type, f.encrypted, f.storage_source_id, f.user_id,
                   f.is_secure_vault, f.vault_root_id, s.shared_by
            FROM shares s
            JOIN files f ON s.file_id = f.id
            WHERE s.share_link = ? AND f.type != 'folder' AND f.trashed = 0
        `).get(shareLink);

        if (!share) {
            return res.status(404).json({ error: 'Shared file not found' });
        }

        if (share.is_secure_vault === 1 || share.vault_root_id !== null) {
            return res.status(400).json({ error: 'Encrypted vault items cannot be previewed publicly' });
        }

        const filePath = resolveSharedFilePath({
            user_id: share.user_id || share.shared_by,
            storage_source_id: share.storage_source_id,
            path: share.file_path
        });

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.set('Content-Type', share.mime_type || 'application/octet-stream');
        res.set('Content-Disposition', `inline; filename="${encodeURIComponent(share.file_name)}"`);
        res.set('Cache-Control', 'public, max-age=86400');

        // Decrypt and stream if encrypted, otherwise serve raw
        if (share.encrypted === 1) {
            try {
                await decryptToStream(filePath, res);
            } catch (decErr) {
                console.error('Public preview decryption error:', decErr.message);
                if (!res.headersSent) return res.status(503).json({ error: 'Failed to decrypt file' });
            }
        } else {
            res.sendFile(filePath);
        }
    } catch (error) {
        console.error('Public preview error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
