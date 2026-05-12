/**
 * SHARES ROUTES
 * =============
 * Handles user-to-user shares, public link shares, share management,
 * and public share access.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const archiver = require('archiver');
const db = require('../database/db');
const { JWT_SECRET } = require('../utils/auth-config');
const { ensureProtectedInternalStorageAvailable } = require('../utils/protected-storage');
const { decryptToStream, createDecryptStream } = require('../utils/crypto-utils');
const { createNotification } = require('../utils/notifications');
const { createActivityEvent } = require('../utils/activity');

const router = express.Router();

const STORAGE_DIR = path.join(__dirname, '..', 'storage');
const VALID_PERMISSIONS = new Set(['view', 'comment', 'edit', 'upload']);

function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        let token = req.query.token ? String(req.query.token) : null;
        if (!token && authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);

        const dbUser = db.prepare('SELECT token_version, is_disabled FROM users WHERE id = ?').get(decoded.userId);
        if (!dbUser) return res.status(401).json({ error: 'User not found' });
        if (dbUser.is_disabled) return res.status(403).json({ error: 'Account is disabled' });
        if (decoded.tokenVersion === undefined || decoded.tokenVersion !== (dbUser.token_version || 1)) {
            return res.status(401).json({ error: 'Token expired or invalidated' });
        }

        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error('Share auth error:', error);
        res.status(500).json({ error: 'Server error' });
    }
}

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

function isVaultItem(file) {
    return !!file && (file.is_secure_vault === 1 || file.vault_root_id !== null);
}

function normalizePermission(permission) {
    const normalized = String(permission || 'view').toLowerCase();
    return VALID_PERMISSIONS.has(normalized) ? normalized : 'view';
}

function normalizeAllowDownload(value) {
    if (value === undefined || value === null) return 1;
    if (value === false || value === 0 || value === '0' || value === 'false') return 0;
    return 1;
}

function toSqlDate(date) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeExpiresAt(value) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        const error = new Error('Invalid expiry date');
        error.status = 400;
        throw error;
    }
    return toSqlDate(date);
}

function isExpired(share) {
    if (!share || !share.expires_at) return false;
    const value = String(share.expires_at).includes('T')
        ? String(share.expires_at)
        : String(share.expires_at).replace(' ', 'T') + 'Z';
    return new Date(value).getTime() <= Date.now();
}

function assertActiveShare(share, res) {
    if (isExpired(share)) {
        res.status(410).json({ error: 'Share link has expired' });
        return false;
    }
    return true;
}

function generateShareLink() {
    return crypto.randomBytes(24).toString('base64url');
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || null;
}

function recordShareAccess(shareId, req, action = 'view', accessedBy = null) {
    try {
        db.prepare(`
            INSERT INTO share_access_logs (share_id, accessed_by, ip_address, user_agent, action)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            shareId,
            accessedBy,
            getClientIp(req),
            String(req.headers['user-agent'] || '').slice(0, 500),
            action
        );
        db.prepare(`
            UPDATE shares
            SET access_count = COALESCE(access_count, 0) + 1,
                last_accessed_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `).run(shareId);
    } catch (error) {
        console.error('Share access logging failed:', error.message);
    }
}

function shareTypeExpression() {
    return "COALESCE(s.share_type, CASE WHEN s.shared_with IS NULL THEN 'link' ELSE 'user' END)";
}

function selectShareList(whereClause) {
    return `
        SELECT s.id, s.file_id, s.shared_by, s.shared_with, s.shared_with_email,
               s.permission, s.share_link, ${shareTypeExpression()} as share_type,
               s.expires_at, s.allow_download, COALESCE(s.access_count, 0) as access_count,
               s.last_accessed_at, s.created_at,
               CASE WHEN s.password_hash IS NOT NULL THEN 1 ELSE 0 END as password_protected,
               CASE WHEN s.expires_at IS NOT NULL AND datetime(s.expires_at) <= datetime('now') THEN 1 ELSE 0 END as is_expired,
               f.name as file_name, f.type as file_type, f.size as file_size, f.mime_type,
               u_to.username as shared_with_name, u_to.email as shared_with_email_address,
               u_by.username as shared_by_name
        FROM shares s
        JOIN files f ON s.file_id = f.id
        JOIN users u_by ON s.shared_by = u_by.id
        LEFT JOIN users u_to ON s.shared_with = u_to.id
        WHERE ${whereClause} AND f.trashed = 0
        ORDER BY s.created_at DESC
    `;
}

function getOwnedFile(fileId, userId) {
    return db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ? AND trashed = 0').get(fileId, userId);
}

function getPublicShareByLink(link) {
    return db.prepare(`
        SELECT s.*, ${shareTypeExpression()} as resolved_share_type,
               f.name as file_name, f.type as file_type, f.size as file_size,
               f.path as file_path, f.mime_type, f.encrypted, f.storage_source_id,
               f.user_id as owner_id, f.is_secure_vault, f.vault_root_id,
               u.username as shared_by_name
        FROM shares s
        JOIN files f ON s.file_id = f.id
        JOIN users u ON s.shared_by = u.id
        WHERE s.share_link = ?
          AND f.trashed = 0
          AND (${shareTypeExpression()} = 'link' OR s.shared_with IS NULL)
    `).get(link);
}

function getRecipientShare(shareId, userId) {
    return db.prepare(`
        SELECT s.*, ${shareTypeExpression()} as resolved_share_type,
               f.name as file_name, f.type as file_type, f.size as file_size,
               f.path as file_path, f.mime_type, f.encrypted, f.storage_source_id,
               f.user_id as owner_id, f.is_secure_vault, f.vault_root_id,
               u.username as shared_by_name
        FROM shares s
        JOIN files f ON s.file_id = f.id
        JOIN users u ON s.shared_by = u.id
        WHERE s.id = ? AND s.shared_with = ? AND f.trashed = 0
    `).get(shareId, userId);
}

function fileFromShare(share) {
    return {
        id: share.file_id,
        name: share.file_name,
        type: share.file_type,
        size: share.file_size,
        path: share.file_path,
        mime_type: share.mime_type,
        encrypted: share.encrypted,
        storage_source_id: share.storage_source_id,
        user_id: share.owner_id,
        is_secure_vault: share.is_secure_vault,
        vault_root_id: share.vault_root_id,
    };
}

function isFileWithinFolder(file, rootFolderId, ownerId) {
    if (String(file.id) === String(rootFolderId)) return true;

    let currentId = file.parent_id;
    while (currentId) {
        if (String(currentId) === String(rootFolderId)) return true;
        const parent = db.prepare('SELECT parent_id FROM files WHERE id = ? AND user_id = ?').get(currentId, ownerId);
        if (!parent) break;
        currentId = parent.parent_id;
    }

    return false;
}

function collectFolderFiles(folderId, ownerId, relativePath = '') {
    const children = db.prepare(`
        SELECT id, user_id, name, path, type, size, mime_type, parent_id,
               storage_source_id, encrypted, is_secure_vault, vault_root_id
        FROM files
        WHERE parent_id = ? AND user_id = ? AND trashed = 0
        ORDER BY CASE WHEN type = 'folder' THEN 0 ELSE 1 END, name ASC
    `).all(folderId, ownerId);

    const collected = [];
    for (const child of children) {
        if (isVaultItem(child)) continue;
        const childPath = relativePath ? `${relativePath}/${child.name}` : child.name;
        if (child.type === 'folder') {
            collected.push(...collectFolderFiles(child.id, ownerId, childPath));
            continue;
        }

        const diskPath = resolveSharedFilePath(child);
        if (fs.existsSync(diskPath)) {
            collected.push({
                diskPath,
                archivePath: childPath,
                encrypted: child.encrypted === 1,
            });
        }
    }
    return collected;
}

async function sendFolderZip(folder, res) {
    const filesToZip = collectFolderFiles(folder.id, folder.user_id);
    if (filesToZip.length === 0) {
        res.status(400).json({ error: 'Folder is empty' });
        return false;
    }

    const zipName = `${folder.name}.zip`;
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

    const archive = archiver('zip', { zlib: { level: 5 } });
    archive.on('error', (error) => {
        console.error('Shared ZIP error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'ZIP creation failed' });
    });
    archive.pipe(res);

    for (const item of filesToZip) {
        if (item.encrypted) {
            try {
                const { stream: decStream } = createDecryptStream(item.diskPath);
                archive.append(decStream, { name: item.archivePath });
            } catch (error) {
                console.error(`Skipping encrypted shared ZIP entry ${item.archivePath}:`, error.message);
            }
        } else {
            archive.file(item.diskPath, { name: item.archivePath });
        }
    }

    archive.finalize();
    return true;
}

async function sendStoredFile(file, res, inline = false) {
    if (isVaultItem(file)) {
        res.status(400).json({ error: 'Encrypted vault items cannot be accessed through shares' });
        return false;
    }

    if (file.type === 'folder') {
        if (inline) {
            res.status(400).json({ error: 'Folders cannot be previewed inline' });
            return false;
        }
        return sendFolderZip(file, res);
    }

    const filePath = resolveSharedFilePath(file);
    if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'File not found on disk' });
        return false;
    }

    res.set('Content-Type', file.mime_type || 'application/octet-stream');
    res.set('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.name)}"`);
    if (inline) {
        res.set('Cache-Control', 'public, max-age=86400');
    }

    if (file.encrypted === 1) {
        try {
            await decryptToStream(filePath, res);
        } catch (error) {
            console.error('Shared file decryption error:', error.message);
            if (!res.headersSent) res.status(503).json({ error: 'Failed to decrypt file' });
        }
        return true;
    }

    res.sendFile(filePath);
    return true;
}

function hasValidShareAccessToken(req, share) {
    if (!share.password_hash) return true;

    const token = req.query.access_token || req.headers['x-share-access'];
    if (!token || typeof token !== 'string') return false;

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded.scope === 'share'
            && Number(decoded.shareId) === Number(share.id)
            && decoded.shareLink === share.share_link;
    } catch {
        return false;
    }
}

function buildShareResponse(shareId) {
    return db.prepare(`
        SELECT s.id, s.file_id, s.shared_by, s.shared_with, s.shared_with_email,
               s.permission, s.share_link, ${shareTypeExpression()} as share_type,
               s.expires_at, s.allow_download, COALESCE(s.access_count, 0) as access_count,
               s.last_accessed_at, s.created_at,
               CASE WHEN s.password_hash IS NOT NULL THEN 1 ELSE 0 END as password_protected,
               CASE WHEN s.expires_at IS NOT NULL AND datetime(s.expires_at) <= datetime('now') THEN 1 ELSE 0 END as is_expired,
               f.name as file_name, f.type as file_type, f.size as file_size, f.mime_type,
               u_to.username as shared_with_name,
               u_by.username as shared_by_name
        FROM shares s
        JOIN files f ON s.file_id = f.id
        JOIN users u_by ON s.shared_by = u_by.id
        LEFT JOIN users u_to ON s.shared_with = u_to.id
        WHERE s.id = ?
    `).get(shareId);
}

function permissionLabel(permission) {
    const labels = {
        view: 'View',
        comment: 'Comment',
        edit: 'Edit',
        upload: 'Upload only',
    };
    return labels[permission] || 'View';
}

function getShareNotificationDetails(shareId) {
    return db.prepare(`
        SELECT s.id, s.file_id, s.shared_by, s.shared_with, s.permission,
               ${shareTypeExpression()} as share_type,
               f.name as file_name, f.type as file_type,
               u_by.username as shared_by_name,
               u_to.username as shared_with_name
        FROM shares s
        JOIN files f ON s.file_id = f.id
        JOIN users u_by ON s.shared_by = u_by.id
        LEFT JOIN users u_to ON s.shared_with = u_to.id
        WHERE s.id = ?
    `).get(shareId);
}

function shouldNotifyPrivateShare(share) {
    return !!share
        && share.share_type === 'user'
        && share.shared_with
        && Number(share.shared_with) !== Number(share.shared_by);
}

function notifyShareReceived(shareId) {
    try {
        const share = getShareNotificationDetails(shareId);
        if (!shouldNotifyPrivateShare(share)) return;

        const itemKind = share.file_type === 'folder' ? 'folder' : 'file';
        createNotification({
            userId: share.shared_with,
            type: 'share.received',
            title: `${share.shared_by_name} shared a ${itemKind} with you`,
            body: `${share.shared_by_name} gave you ${permissionLabel(share.permission)} access to "${share.file_name}".`,
            link: '/shares/incoming',
            metadata: {
                shareId: share.id,
                fileId: share.file_id,
                fileName: share.file_name,
                fileType: share.file_type,
                sharedBy: share.shared_by,
                permission: share.permission,
            },
        });
    } catch (error) {
        console.error('Share received notification failed:', error.message);
    }
}

function notifyShareRevoked(shareId) {
    try {
        const share = getShareNotificationDetails(shareId);
        if (!shouldNotifyPrivateShare(share)) return;

        createNotification({
            userId: share.shared_with,
            type: 'share.revoked',
            title: `Access removed from "${share.file_name}"`,
            body: `${share.shared_by_name} removed your access to "${share.file_name}".`,
            link: '/shares/incoming',
            metadata: {
                shareId: share.id,
                fileId: share.file_id,
                fileName: share.file_name,
                fileType: share.file_type,
                sharedBy: share.shared_by,
            },
        });
    } catch (error) {
        console.error('Share revoked notification failed:', error.message);
    }
}

function logShareCreated(shareId) {
    try {
        const share = getShareNotificationDetails(shareId);
        if (!shouldNotifyPrivateShare(share)) return;

        createActivityEvent({
            userId: share.shared_by,
            actorId: share.shared_by,
            type: 'share.sent',
            title: `Shared "${share.file_name}"`,
            body: share.shared_with_name ? `Shared with ${share.shared_with_name}` : 'Shared with another user',
            link: '/shares/outgoing',
            metadata: {
                shareId: share.id,
                fileId: share.file_id,
                fileName: share.file_name,
                fileType: share.file_type,
                recipientId: share.shared_with,
                permission: share.permission,
            },
        });

        createActivityEvent({
            userId: share.shared_with,
            actorId: share.shared_by,
            type: 'share.received',
            title: `${share.shared_by_name} shared "${share.file_name}"`,
            body: `${permissionLabel(share.permission)} access in Shared with Me`,
            link: '/shares/incoming',
            metadata: {
                shareId: share.id,
                fileId: share.file_id,
                fileName: share.file_name,
                fileType: share.file_type,
                sharedBy: share.shared_by,
                permission: share.permission,
            },
        });
    } catch (error) {
        console.error('Share activity logging failed:', error.message);
    }
}

function logShareRevoked(shareId) {
    try {
        const share = getShareNotificationDetails(shareId);
        if (!shouldNotifyPrivateShare(share)) return;

        createActivityEvent({
            userId: share.shared_by,
            actorId: share.shared_by,
            type: 'share.revoked',
            title: `Revoked "${share.file_name}"`,
            body: share.shared_with_name ? `Removed access for ${share.shared_with_name}` : 'Removed user access',
            link: '/shares/outgoing',
            metadata: {
                shareId: share.id,
                fileId: share.file_id,
                fileName: share.file_name,
                fileType: share.file_type,
                recipientId: share.shared_with,
            },
        });

        createActivityEvent({
            userId: share.shared_with,
            actorId: share.shared_by,
            type: 'share.revoked',
            title: `Access removed from "${share.file_name}"`,
            body: `${share.shared_by_name} removed your access`,
            link: '/shares/incoming',
            metadata: {
                shareId: share.id,
                fileId: share.file_id,
                fileName: share.file_name,
                fileType: share.file_type,
                sharedBy: share.shared_by,
            },
        });
    } catch (error) {
        console.error('Share revoke activity logging failed:', error.message);
    }
}

function logShareUpdated(shareId) {
    try {
        const share = getShareNotificationDetails(shareId);
        if (!shouldNotifyPrivateShare(share)) return;

        createActivityEvent({
            userId: share.shared_by,
            actorId: share.shared_by,
            type: 'share.updated',
            title: `Updated share for "${share.file_name}"`,
            body: share.shared_with_name
                ? `${share.shared_with_name} now has ${permissionLabel(share.permission)} access`
                : `${permissionLabel(share.permission)} access`,
            link: '/shares/outgoing',
            metadata: {
                shareId: share.id,
                fileId: share.file_id,
                fileName: share.file_name,
                fileType: share.file_type,
                recipientId: share.shared_with,
                permission: share.permission,
            },
        });
    } catch (error) {
        console.error('Share update activity logging failed:', error.message);
    }
}

function logShareLeft(shareId, userId) {
    try {
        const share = getShareNotificationDetails(shareId);
        if (!share || Number(share.shared_with) !== Number(userId)) return;

        createActivityEvent({
            userId,
            actorId: userId,
            type: 'share.left',
            title: `Left share "${share.file_name}"`,
            body: `Removed it from Shared with Me`,
            link: '/shares/incoming',
            metadata: {
                shareId: share.id,
                fileId: share.file_id,
                fileName: share.file_name,
                fileType: share.file_type,
                sharedBy: share.shared_by,
            },
        });
    } catch (error) {
        console.error('Share leave activity logging failed:', error.message);
    }
}

function applyShareUpdates(shareId, body, currentShare) {
    const fields = [];
    const params = [];

    if (body.permission !== undefined) {
        fields.push('permission = ?');
        params.push(normalizePermission(body.permission));
    }

    if (body.expiresAt !== undefined || body.expires_at !== undefined) {
        fields.push('expires_at = ?');
        params.push(normalizeExpiresAt(body.expiresAt ?? body.expires_at));
    }

    if (body.allowDownload !== undefined || body.allow_download !== undefined) {
        fields.push('allow_download = ?');
        params.push(normalizeAllowDownload(body.allowDownload ?? body.allow_download));
    }

    if (body.password !== undefined && currentShare.share_type === 'link') {
        fields.push('password_hash = ?');
        const password = String(body.password || '').trim();
        params.push(password ? bcrypt.hashSync(password, 10) : null);
    }

    if (fields.length === 0) return;

    params.push(shareId);
    db.prepare(`UPDATE shares SET ${fields.join(', ')} WHERE id = ?`).run(...params);
}

// ============================================
// Authenticated management routes
// ============================================

router.get('/users', requireAuth, (req, res) => {
    try {
        const users = db.prepare(
            'SELECT id, username, email FROM users WHERE id != ? AND COALESCE(is_disabled, 0) = 0 ORDER BY username ASC'
        ).all(req.user.userId);
        res.json({ users });
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/my-shares', requireAuth, (req, res) => {
    try {
        const shares = db.prepare(selectShareList('s.shared_by = ?')).all(req.user.userId);
        res.json({ shares });
    } catch (error) {
        console.error('List my shares error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/shared-with-me', requireAuth, (req, res) => {
    try {
        const shares = db.prepare(selectShareList('s.shared_with = ?')).all(req.user.userId);
        const shortcutForShare = db.prepare(
            'SELECT id FROM share_shortcuts WHERE user_id = ? AND share_id = ?'
        );
        for (const share of shares) {
            const shortcut = shortcutForShare.get(req.user.userId, share.id);
            share.shortcut_id = shortcut?.id || null;
        }
        res.json({ shares });
    } catch (error) {
        console.error('Shared with me error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/file/:fileId/access', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = Number(req.params.fileId);
        const file = getOwnedFile(fileId, userId);

        if (!file) return res.status(404).json({ error: 'File not found' });
        if (isVaultItem(file)) return res.status(400).json({ error: 'Encrypted vault items cannot be shared yet' });

        const access = db.prepare(`
            SELECT s.id, s.file_id, s.shared_with, s.permission, s.created_at, s.share_link,
                   ${shareTypeExpression()} as share_type, s.expires_at, s.allow_download,
                   CASE WHEN s.password_hash IS NOT NULL THEN 1 ELSE 0 END as password_protected,
                   CASE WHEN s.expires_at IS NOT NULL AND datetime(s.expires_at) <= datetime('now') THEN 1 ELSE 0 END as is_expired,
                   u.username as shared_with_name
            FROM shares s
            LEFT JOIN users u ON s.shared_with = u.id
            WHERE s.shared_by = ? AND s.file_id = ?
            ORDER BY s.created_at DESC
        `).all(userId, fileId);

        res.json({
            file: { id: file.id, name: file.name, type: file.type },
            access
        });
    } catch (error) {
        console.error('Get share access error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/file/:fileId/access/:userId', requireAuth, (req, res) => {
    try {
        const ownerId = req.user.userId;
        const fileId = Number(req.params.fileId);
        const targetUserId = Number(req.params.userId);

        const share = db.prepare(`
            SELECT * FROM shares
            WHERE file_id = ? AND shared_by = ? AND shared_with = ?
        `).get(fileId, ownerId, targetUserId);

        if (!share) return res.status(404).json({ error: 'Share not found for this user' });

        notifyShareRevoked(share.id);
        logShareRevoked(share.id);
        db.prepare('DELETE FROM shares WHERE id = ?').run(share.id);
        res.json({ message: 'Access revoked' });
    } catch (error) {
        console.error('Revoke share access error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const {
            fileId,
            sharedWithId,
            permission = 'view',
            shareType,
            createPublicLink,
        } = req.body;

        if (!fileId) return res.status(400).json({ error: 'fileId is required' });
        if (shareType === 'link' || createPublicLink === true) {
            return res.status(400).json({
                error: 'Public link sharing is disabled. Share with a CloudPi user instead.'
            });
        }
        if (!sharedWithId) {
            return res.status(400).json({ error: 'sharedWithId is required' });
        }

        const file = getOwnedFile(Number(fileId), userId);
        if (!file) return res.status(404).json({ error: 'File not found' });
        if (isVaultItem(file)) return res.status(400).json({ error: 'Encrypted vault items cannot be shared yet' });

        const normalizedPermission = normalizePermission(permission);
        const expiresAt = normalizeExpiresAt(req.body.expiresAt ?? req.body.expires_at);
        const allowDownload = normalizeAllowDownload(req.body.allowDownload ?? req.body.allow_download);

        if (Number(sharedWithId) === Number(userId)) return res.status(400).json({ error: 'Cannot share with yourself' });

        const targetUser = db.prepare('SELECT id, username FROM users WHERE id = ? AND COALESCE(is_disabled, 0) = 0').get(sharedWithId);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });

        const existing = db.prepare(`
            SELECT id, ${shareTypeExpression()} as share_type
            FROM shares s
            WHERE s.file_id = ? AND s.shared_by = ? AND s.shared_with = ?
              AND ${shareTypeExpression()} = 'user'
        `).get(file.id, userId, targetUser.id);

        if (existing) {
            applyShareUpdates(existing.id, {
                permission: normalizedPermission,
                expiresAt,
                allowDownload,
            }, { ...existing, share_type: 'user' });
            logShareUpdated(existing.id);
            return res.json({
                message: `Share with ${targetUser.username} updated`,
                share: buildShareResponse(existing.id),
            });
        }

        const result = db.prepare(`
            INSERT INTO shares (
                file_id, shared_by, shared_with, permission, share_link,
                share_type, expires_at, allow_download
            )
            VALUES (?, ?, ?, ?, ?, 'user', ?, ?)
        `).run(file.id, userId, targetUser.id, normalizedPermission, generateShareLink(), expiresAt ?? null, allowDownload);
        notifyShareReceived(result.lastInsertRowid);
        logShareCreated(result.lastInsertRowid);

        res.status(201).json({
            message: `Shared with ${targetUser.username}`,
            share: buildShareResponse(result.lastInsertRowid),
        });
    } catch (error) {
        console.error('Create share error:', error);
        res.status(error.status || 500).json({ error: error.message || 'Server error' });
    }
});

router.post('/bulk', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const shareIds = Array.isArray(req.body.shareIds) ? req.body.shareIds.map(Number).filter(Boolean) : [];
        const action = String(req.body.action || 'update');

        if (shareIds.length === 0) return res.status(400).json({ error: 'No shares selected' });

        const placeholders = shareIds.map(() => '?').join(',');
        const owned = db.prepare(`
            SELECT id, ${shareTypeExpression()} as share_type
            FROM shares s
            WHERE s.shared_by = ? AND s.id IN (${placeholders})
        `).all(userId, ...shareIds);

        if (owned.length === 0) return res.status(404).json({ error: 'No matching shares found' });

        if (action === 'revoke') {
            const ids = owned.map((share) => share.id);
            for (const id of ids) {
                notifyShareRevoked(id);
                logShareRevoked(id);
            }
            db.prepare(`DELETE FROM shares WHERE shared_by = ? AND id IN (${ids.map(() => '?').join(',')})`).run(userId, ...ids);
            return res.json({ message: 'Shares revoked', count: ids.length });
        }

        for (const share of owned) {
            applyShareUpdates(share.id, req.body, share);
            logShareUpdated(share.id);
        }

        res.json({ message: 'Shares updated', count: owned.length });
    } catch (error) {
        console.error('Bulk share action error:', error);
        res.status(error.status || 500).json({ error: error.message || 'Server error' });
    }
});

router.patch('/:id', requireAuth, (req, res) => {
    try {
        const share = db.prepare(`
            SELECT s.*, ${shareTypeExpression()} as share_type
            FROM shares s
            WHERE s.id = ? AND s.shared_by = ?
        `).get(req.params.id, req.user.userId);

        if (!share) return res.status(404).json({ error: 'Share not found' });

        applyShareUpdates(share.id, req.body, share);
        logShareUpdated(share.id);
        res.json({ message: 'Share updated', share: buildShareResponse(share.id) });
    } catch (error) {
        console.error('Update share error:', error);
        res.status(error.status || 500).json({ error: error.message || 'Server error' });
    }
});

router.delete('/shared-with-me/:id', requireAuth, (req, res) => {
    try {
        logShareLeft(req.params.id, req.user.userId);
        const result = db.prepare('DELETE FROM shares WHERE id = ? AND shared_with = ?').run(req.params.id, req.user.userId);
        if (result.changes === 0) return res.status(404).json({ error: 'Share not found' });
        res.json({ message: 'Left share' });
    } catch (error) {
        console.error('Leave share error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/:id/shortcut', requireAuth, (req, res) => {
    try {
        const share = getRecipientShare(req.params.id, req.user.userId);
        if (!share) return res.status(404).json({ error: 'Share not found' });
        if (!assertActiveShare(share, res)) return;
        if (share.permission === 'upload') {
            return res.status(400).json({ error: 'Upload-only shares cannot be added to My Files' });
        }

        db.prepare(`
            INSERT OR IGNORE INTO share_shortcuts (user_id, share_id)
            VALUES (?, ?)
        `).run(req.user.userId, share.id);

        const shortcut = db.prepare(
            'SELECT id, user_id, share_id, created_at FROM share_shortcuts WHERE user_id = ? AND share_id = ?'
        ).get(req.user.userId, share.id);

        res.status(201).json({ message: 'Added to My Files', shortcut });
    } catch (error) {
        console.error('Add share shortcut error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/:id/shortcut', requireAuth, (req, res) => {
    try {
        const result = db.prepare(`
            DELETE FROM share_shortcuts
            WHERE user_id = ? AND share_id = ?
        `).run(req.user.userId, req.params.id);

        if (result.changes === 0) return res.status(404).json({ error: 'Shortcut not found' });
        res.json({ message: 'Shortcut removed' });
    } catch (error) {
        console.error('Remove share shortcut error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/:id/activity', requireAuth, (req, res) => {
    try {
        const share = db.prepare('SELECT id FROM shares WHERE id = ? AND shared_by = ?').get(req.params.id, req.user.userId);
        if (!share) return res.status(404).json({ error: 'Share not found' });

        const logs = db.prepare(`
            SELECT l.id, l.ip_address, l.user_agent, l.action, l.created_at,
                   l.accessed_by, u.username as accessed_by_name
            FROM share_access_logs l
            LEFT JOIN users u ON l.accessed_by = u.id
            WHERE l.share_id = ?
            ORDER BY l.created_at DESC
            LIMIT 100
        `).all(share.id);

        res.json({ logs });
    } catch (error) {
        console.error('Share activity error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/:id', requireAuth, (req, res) => {
    try {
        const share = db.prepare('SELECT id FROM shares WHERE id = ? AND shared_by = ?').get(req.params.id, req.user.userId);
        if (!share) return res.status(404).json({ error: 'Share not found' });
        notifyShareRevoked(share.id);
        logShareRevoked(share.id);
        const result = db.prepare('DELETE FROM shares WHERE id = ? AND shared_by = ?').run(req.params.id, req.user.userId);
        if (result.changes === 0) return res.status(404).json({ error: 'Share not found' });
        res.json({ message: 'Share revoked' });
    } catch (error) {
        console.error('Delete share error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// Authenticated recipient routes
// ============================================

router.get('/:shareId/preview', requireAuth, async (req, res) => {
    try {
        const share = getRecipientShare(req.params.shareId, req.user.userId);
        if (!share) return res.status(404).json({ error: 'Share not found' });
        if (!assertActiveShare(share, res)) return;
        if (share.permission === 'upload') return res.status(403).json({ error: 'This share does not allow browsing' });

        recordShareAccess(share.id, req, 'preview', req.user.userId);
        await sendStoredFile(fileFromShare(share), res, true);
    } catch (error) {
        console.error('Preview recipient share error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
});

router.get('/:shareId/download', requireAuth, async (req, res) => {
    try {
        const share = getRecipientShare(req.params.shareId, req.user.userId);
        if (!share) return res.status(404).json({ error: 'Share not found' });
        if (!assertActiveShare(share, res)) return;
        if (share.allow_download === 0) return res.status(403).json({ error: 'Downloads are disabled for this share' });

        recordShareAccess(share.id, req, 'download', req.user.userId);
        await sendStoredFile(fileFromShare(share), res, false);
    } catch (error) {
        console.error('Download recipient share error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
});

router.get('/shared-folder/:shareId/files', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const share = getRecipientShare(req.params.shareId, userId);

        if (!share || share.file_type !== 'folder') {
            return res.status(404).json({ error: 'Shared folder not found' });
        }
        if (!assertActiveShare(share, res)) return;
        if (share.permission === 'upload') return res.status(403).json({ error: 'This share does not allow browsing' });

        const parentId = req.query.parent_id || share.file_id;
        if (String(parentId) !== String(share.file_id)) {
            const parent = db.prepare('SELECT id, parent_id FROM files WHERE id = ? AND user_id = ?').get(parentId, share.owner_id);
            if (!parent || !isFileWithinFolder(parent, share.file_id, share.owner_id)) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        const files = db.prepare(`
            SELECT id, name, type, size, mime_type, parent_id, created_at, modified_at
            FROM files
            WHERE parent_id = ? AND user_id = ? AND trashed = 0
            ORDER BY CASE WHEN type = 'folder' THEN 0 ELSE 1 END, name ASC
        `).all(parentId, share.owner_id);

        const breadcrumbs = [];
        let crumbId = parentId;
        while (crumbId && String(crumbId) !== String(share.file_id)) {
            const folder = db.prepare('SELECT id, name, parent_id FROM files WHERE id = ? AND user_id = ?').get(crumbId, share.owner_id);
            if (!folder) break;
            breadcrumbs.unshift({ id: folder.id, name: folder.name });
            crumbId = folder.parent_id;
        }

        const rootFolder = db.prepare('SELECT id, name FROM files WHERE id = ? AND user_id = ?').get(share.file_id, share.owner_id);
        if (rootFolder) breadcrumbs.unshift({ id: rootFolder.id, name: rootFolder.name });

        recordShareAccess(share.id, req, 'browse', userId);
        res.json({ files, breadcrumbs, shareId: Number(req.params.shareId), rootFolderId: share.file_id });
    } catch (error) {
        console.error('Browse shared folder error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/shared-folder/:shareId/download/:fileId', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const share = getRecipientShare(req.params.shareId, userId);
        if (!share) return res.status(404).json({ error: 'Share not found' });
        if (!assertActiveShare(share, res)) return;
        if (share.allow_download === 0) return res.status(403).json({ error: 'Downloads are disabled for this share' });

        const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ? AND trashed = 0').get(req.params.fileId, share.owner_id);
        if (!file) return res.status(404).json({ error: 'File not found' });
        if (!isFileWithinFolder(file, share.file_id, share.owner_id)) {
            return res.status(403).json({ error: 'File is outside the shared scope' });
        }

        recordShareAccess(share.id, req, 'download', userId);
        await sendStoredFile(file, res, false);
    } catch (error) {
        console.error('Download shared folder file error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
});

router.get('/shared-folder/:shareId/preview/:fileId', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const share = getRecipientShare(req.params.shareId, userId);
        if (!share) return res.status(404).json({ error: 'Share not found' });
        if (!assertActiveShare(share, res)) return;
        if (share.permission === 'upload') return res.status(403).json({ error: 'This share does not allow browsing' });

        const file = db.prepare("SELECT * FROM files WHERE id = ? AND user_id = ? AND type != 'folder' AND trashed = 0")
            .get(req.params.fileId, share.owner_id);
        if (!file) return res.status(404).json({ error: 'File not found' });
        if (!isFileWithinFolder(file, share.file_id, share.owner_id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        recordShareAccess(share.id, req, 'preview', userId);
        await sendStoredFile(file, res, true);
    } catch (error) {
        console.error('Preview shared folder file error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// Public share routes
// ============================================

router.get('/public/:link', (req, res) => {
    try {
        const share = getPublicShareByLink(req.params.link);
        if (!share) return res.status(404).json({ error: 'Share link not found' });
        if (!assertActiveShare(share, res)) return;
        if (isVaultItem(share)) return res.status(400).json({ error: 'Encrypted vault items cannot be shared publicly' });

        if (!hasValidShareAccessToken(req, share)) {
            return res.json({
                passwordRequired: true,
                share: {
                    id: share.id,
                    expires_at: share.expires_at,
                    allow_download: share.allow_download,
                }
            });
        }

        recordShareAccess(share.id, req, 'view');
        res.json({
            passwordRequired: false,
            file: {
                name: share.file_name,
                type: share.file_type,
                size: share.file_size,
                mime_type: share.mime_type,
                shared_by: share.shared_by_name,
                permission: share.permission,
                created_at: share.created_at,
                expires_at: share.expires_at,
                allow_download: share.allow_download,
            }
        });
    } catch (error) {
        console.error('Public share metadata error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/public/:link/verify', express.json(), (req, res) => {
    try {
        const share = getPublicShareByLink(req.params.link);
        if (!share) return res.status(404).json({ error: 'Share link not found' });
        if (!assertActiveShare(share, res)) return;

        if (!share.password_hash) {
            return res.json({ accessToken: null });
        }

        const ok = bcrypt.compareSync(String(req.body.password || ''), share.password_hash);
        if (!ok) return res.status(401).json({ error: 'Incorrect password' });

        const accessToken = jwt.sign({
            scope: 'share',
            shareId: share.id,
            shareLink: share.share_link,
        }, JWT_SECRET, { expiresIn: '2h' });

        recordShareAccess(share.id, req, 'password');
        res.json({ accessToken });
    } catch (error) {
        console.error('Public share password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/public/:link/download', async (req, res) => {
    try {
        const share = getPublicShareByLink(req.params.link);
        if (!share) return res.status(404).json({ error: 'Share link not found' });
        if (!assertActiveShare(share, res)) return;
        if (!hasValidShareAccessToken(req, share)) return res.status(401).json({ error: 'Password required' });
        if (share.allow_download === 0) return res.status(403).json({ error: 'Downloads are disabled for this share' });

        recordShareAccess(share.id, req, 'download');
        await sendStoredFile(fileFromShare(share), res, false);
    } catch (error) {
        console.error('Public download error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
});

router.get('/public/:link/preview', async (req, res) => {
    try {
        const share = getPublicShareByLink(req.params.link);
        if (!share) return res.status(404).json({ error: 'Shared file not found' });
        if (!assertActiveShare(share, res)) return;
        if (!hasValidShareAccessToken(req, share)) return res.status(401).json({ error: 'Password required' });
        if (share.permission === 'upload') return res.status(403).json({ error: 'This share does not allow browsing' });

        recordShareAccess(share.id, req, 'preview');
        await sendStoredFile(fileFromShare(share), res, true);
    } catch (error) {
        console.error('Public preview error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
