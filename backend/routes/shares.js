/**
 * SHARES ROUTES
 * =============
 * Handles file sharing between users
 * 
 * Routes:
 *   POST   /api/shares              - Share a file with a user
 *   GET    /api/shares/my-shares     - Files I've shared with others
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

const router = express.Router();

const JWT_SECRET = 'cloudpi-secret-key-change-this-in-production';
const STORAGE_DIR = path.join(__dirname, '..', 'storage');

// Auth middleware
function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const dbUser = db.prepare('SELECT token_version FROM users WHERE id = ?').get(decoded.userId);
        if (!dbUser) return res.status(401).json({ error: 'User not found' });
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
            'SELECT id, username, email FROM users WHERE id != ?'
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
                   u.username as shared_with_name, u.email as shared_with_user_email
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
 * GET /api/shares/public/:link/download
 * Download a shared file (NO auth required)
 */
router.get('/public/:link/download', (req, res) => {
    try {
        const shareLink = req.params.link;

        const share = db.prepare(`
            SELECT s.*, f.name as file_name, f.type as file_type, 
                   f.path as file_path, f.mime_type, s.shared_by
            FROM shares s
            JOIN files f ON s.file_id = f.id
            WHERE s.share_link = ? AND f.type != 'folder'
        `).get(shareLink);

        if (!share) {
            return res.status(404).json({ error: 'Share link not found' });
        }

        const filePath = path.join(STORAGE_DIR, String(share.shared_by), share.file_path);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.set('Content-Type', share.mime_type || 'application/octet-stream');
        res.set('Content-Disposition', `attachment; filename="${share.file_name}"`);
        res.sendFile(filePath);
    } catch (error) {
        console.error('Public download error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/shares/public/:link/preview
 * View a shared file inline in the browser (NO auth required)
 */
router.get('/public/:link/preview', (req, res) => {
    try {
        const shareLink = req.params.link;

        const share = db.prepare(`
            SELECT s.*, f.name as file_name, f.type as file_type, 
                   f.path as file_path, f.mime_type, s.shared_by
            FROM shares s
            JOIN files f ON s.file_id = f.id
            WHERE s.share_link = ? AND f.type != 'folder'
        `).get(shareLink);

        if (!share) {
            return res.status(404).json({ error: 'Shared file not found' });
        }

        const filePath = path.join(STORAGE_DIR, String(share.shared_by), share.file_path);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.set('Content-Type', share.mime_type || 'application/octet-stream');
        res.set('Content-Disposition', `inline; filename="${share.file_name}"`);
        res.set('Cache-Control', 'public, max-age=86400');
        res.sendFile(filePath);
    } catch (error) {
        console.error('Public preview error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
