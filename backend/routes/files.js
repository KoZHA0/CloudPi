/**
 * FILE ROUTES
 * ===========
 * Handles file and folder operations
 * 
 * ENDPOINTS:
 * GET    /api/files              - List files/folders in directory
 * GET    /api/files/trash        - List trashed items
 * GET    /api/files/recent       - Get recently modified files
 * POST   /api/files/folder       - Create new folder
 * POST   /api/files/upload       - Upload file(s)
 * GET    /api/files/:id/download - Download file
 * PUT    /api/files/:id          - Rename file/folder
 * PUT    /api/files/:id/star     - Toggle star status
 * PUT    /api/files/:id/move     - Move to different folder
 * PUT    /api/files/:id/restore  - Restore from trash
 * DELETE /api/files/:id          - Move to trash
 * DELETE /api/files/:id/permanent - Permanently delete
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

const JWT_SECRET = 'cloudpi-secret-key-change-this-in-production';

// Storage directory for uploaded files
const STORAGE_DIR = path.join(__dirname, '..', 'storage');

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Create user-specific directory
        const userDir = path.join(STORAGE_DIR, String(req.user.userId));
        if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
        }
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        // Use UUID to avoid filename conflicts
        const ext = path.extname(file.originalname);
        cb(null, `${uuidv4()}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

/**
 * AUTH MIDDLEWARE
 * Verifies JWT token and validates token_version against database
 */
function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        // Validate token_version against database
        const user = db.prepare('SELECT token_version FROM users WHERE id = ?').get(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        const tokenVersion = decoded.tokenVersion || 0;
        const dbTokenVersion = user.token_version || 1;
        
        if (tokenVersion !== dbTokenVersion) {
            return res.status(401).json({ error: 'Token expired or invalidated' });
        }

        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * Get file type category based on mime type
 */
function getFileType(mimeType) {
    if (!mimeType) return 'document';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType.includes('pdf')) return 'document';
    if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('tar')) return 'archive';
    return 'document';
}

// ============================================
// STATIC ROUTES FIRST (before :id routes)
// ============================================

/**
 * GET /api/files
 * List files and folders in a directory
 */
router.get('/', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const parentId = req.query.parent_id || null;
        const starredOnly = req.query.starred === 'true';

        let query = `
            SELECT id, name, type, size, mime_type, parent_id, starred, created_at, modified_at
            FROM files 
            WHERE user_id = ? AND trashed = 0
        `;
        const params = [userId];

        if (starredOnly) {
            query += ' AND starred = 1';
        } else if (parentId) {
            query += ' AND parent_id = ?';
            params.push(parentId);
        } else {
            query += ' AND parent_id IS NULL';
        }

        query += " ORDER BY CASE WHEN type = 'folder' THEN 0 ELSE 1 END, name ASC";

        const files = db.prepare(query).all(...params);

        // Get breadcrumb path
        let breadcrumbs = [];
        if (parentId) {
            let currentId = parentId;
            while (currentId) {
                const folder = db.prepare(
                    'SELECT id, name, parent_id FROM files WHERE id = ? AND user_id = ?'
                ).get(currentId, userId);
                if (folder) {
                    breadcrumbs.unshift({ id: folder.id, name: folder.name });
                    currentId = folder.parent_id;
                } else {
                    break;
                }
            }
        }

        res.json({ files, breadcrumbs });
    } catch (error) {
        console.error('List files error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/files/trash
 * List trashed items (MUST come before /:id routes)
 */
router.get('/trash', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;

        const files = db.prepare(`
            SELECT id, name, type, size, mime_type, trashed_at
            FROM files 
            WHERE user_id = ? AND trashed = 1
            AND (parent_id IS NULL OR parent_id NOT IN (
                SELECT id FROM files WHERE trashed = 1
            ))
            ORDER BY trashed_at DESC
        `).all(userId);

        res.json({ files });
    } catch (error) {
        console.error('List trash error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/files/recent
 * Get recently modified files (MUST come before /:id routes)
 */
router.get('/recent', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;

        const files = db.prepare(`
            SELECT id, name, type, size, mime_type, parent_id, starred, modified_at
            FROM files 
            WHERE user_id = ? AND trashed = 0 AND type != 'folder'
            ORDER BY modified_at DESC
            LIMIT 20
        `).all(userId);

        res.json({ files });
    } catch (error) {
        console.error('Recent files error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/files/folder
 * Create a new folder
 */
router.post('/folder', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const { name, parent_id } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Folder name is required' });
        }

        // Check if folder with same name exists in same location
        let existingQuery = `
            SELECT id FROM files 
            WHERE user_id = ? AND name = ? AND type = 'folder' AND trashed = 0
        `;
        let existingParams = [userId, name.trim()];
        
        if (parent_id) {
            existingQuery += ' AND parent_id = ?';
            existingParams.push(parent_id);
        } else {
            existingQuery += ' AND parent_id IS NULL';
        }

        const existing = db.prepare(existingQuery).get(...existingParams);

        if (existing) {
            return res.status(400).json({ error: 'Folder with this name already exists' });
        }

        // Validate parent folder exists and belongs to user
        if (parent_id) {
            const parentFolder = db.prepare(
                "SELECT id FROM files WHERE id = ? AND user_id = ? AND type = 'folder'"
            ).get(parent_id, userId);
            if (!parentFolder) {
                return res.status(400).json({ error: 'Parent folder not found' });
            }
        }

        const result = db.prepare(`
            INSERT INTO files (user_id, name, path, type, parent_id)
            VALUES (?, ?, '', 'folder', ?)
        `).run(userId, name.trim(), parent_id || null);

        const folder = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid);

        res.status(201).json({ 
            message: 'Folder created successfully',
            folder 
        });
    } catch (error) {
        console.error('Create folder error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/files/upload
 * Upload one or more files
 */
router.post('/upload', requireAuth, upload.array('files', 10), (req, res) => {
    try {
        const userId = req.user.userId;
        const parentId = req.body.parent_id || null;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        // Validate parent folder if specified
        if (parentId) {
            const parentFolder = db.prepare(
                "SELECT id FROM files WHERE id = ? AND user_id = ? AND type = 'folder'"
            ).get(parentId, userId);
            if (!parentFolder) {
                return res.status(400).json({ error: 'Parent folder not found' });
            }
        }

        const uploadedFiles = [];

        for (const file of req.files) {
            const fileType = getFileType(file.mimetype);
            
            const result = db.prepare(`
                INSERT INTO files (user_id, name, path, type, size, mime_type, parent_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId,
                file.originalname,
                file.filename, // UUID filename
                fileType,
                file.size,
                file.mimetype,
                parentId
            );

            const uploaded = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid);
            uploadedFiles.push(uploaded);
        }

        res.status(201).json({
            message: `${uploadedFiles.length} file(s) uploaded successfully`,
            files: uploadedFiles
        });
    } catch (error) {
        console.error('Upload error:', error);

        // CLEANUP - delete uploaded files if DB insert failed
        if (req.files) {
            req.files.forEach(file => {
                if (file.path && fs.existsSync(file.path)) {
                    try {
                        fs.unlinkSync(file.path);
                        console.log('Cleaned up:', file.filename);
                    } catch (cleanupErr) {
                        console.error('Failed to delete:', file.filename);
                    }
                }
            });
        }

        res.status(500).json({ error: 'Server error during upload' });
    }
});

// ============================================
// DYNAMIC ROUTES (with :id parameter)
// ============================================

/**
 * GET /api/files/:id/preview
 * Serve an image file for preview/thumbnail display
 * Accepts token via query string (needed for <img> tags)
 */
router.get('/:id/preview', (req, res) => {
    try {
        // Accept token from query string OR Authorization header
        let token = req.query.token ? String(req.query.token) : null;
        if (!token) {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                token = authHeader.split(' ')[1];
            }
        }

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const userId = decoded.userId;
        const fileId = req.params.id;

        // Validate token_version (skip if token was created before this feature)
        const dbUser = db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId);
        if (!dbUser) return res.status(401).json({ error: 'User not found' });
        
        if (decoded.tokenVersion !== undefined) {
            if (decoded.tokenVersion !== (dbUser.token_version || 1)) {
                return res.status(401).json({ error: 'Token invalidated' });
            }
        }

        const file = db.prepare(
            "SELECT * FROM files WHERE id = ? AND user_id = ? AND type = 'image'"
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'Image not found' });
        }

        const filePath = path.join(STORAGE_DIR, String(userId), file.path);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        // Set content type and cache headers
        res.set('Content-Type', file.mime_type);
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.sendFile(filePath);
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Preview error:', error);
        res.status(500).json({ error: 'Server error during preview' });
    }
});

/**
 * GET /api/files/:id/download
 * Download a file
 */
router.get('/:id/download', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        const file = db.prepare(
            "SELECT * FROM files WHERE id = ? AND user_id = ? AND type != 'folder'"
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = path.join(STORAGE_DIR, String(userId), file.path);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.download(filePath, file.name);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Server error during download' });
    }
});

/**
 * PUT /api/files/:id
 * Rename a file or folder
 */
router.put('/:id', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;
        const { name } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Name is required' });
        }

        const file = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ?'
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Check for duplicate name in same folder
        let dupQuery = `
            SELECT id FROM files 
            WHERE user_id = ? AND name = ? AND id != ? AND trashed = 0
        `;
        let dupParams = [userId, name.trim(), fileId];

        if (file.parent_id) {
            dupQuery += ' AND parent_id = ?';
            dupParams.push(file.parent_id);
        } else {
            dupQuery += ' AND parent_id IS NULL';
        }

        const duplicate = db.prepare(dupQuery).get(...dupParams);

        if (duplicate) {
            return res.status(400).json({ error: 'Item with this name already exists' });
        }

        db.prepare(`
            UPDATE files SET name = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(name.trim(), fileId);

        const updated = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);

        res.json({ message: 'Renamed successfully', file: updated });
    } catch (error) {
        console.error('Rename error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/files/:id/star
 * Toggle starred status
 */
router.put('/:id/star', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        const file = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ?'
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        const newStarred = file.starred ? 0 : 1;
        db.prepare('UPDATE files SET starred = ? WHERE id = ?').run(newStarred, fileId);

        res.json({ 
            message: newStarred ? 'Added to starred' : 'Removed from starred',
            starred: newStarred === 1
        });
    } catch (error) {
        console.error('Star toggle error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/files/:id/move
 * Move file/folder to different location
 */
router.put('/:id/move', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;
        const { parent_id } = req.body; // null for root

        const file = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ?'
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Validate destination folder
        if (parent_id) {
            const destFolder = db.prepare(
                "SELECT id FROM files WHERE id = ? AND user_id = ? AND type = 'folder'"
            ).get(parent_id, userId);
            if (!destFolder) {
                return res.status(400).json({ error: 'Destination folder not found' });
            }

            // Prevent moving folder into itself or its children
            if (file.type === 'folder') {
                let checkId = parent_id;
                while (checkId) {
                    if (checkId === parseInt(fileId)) {
                        return res.status(400).json({ error: 'Cannot move folder into itself' });
                    }
                    const parent = db.prepare('SELECT parent_id FROM files WHERE id = ?').get(checkId);
                    checkId = parent?.parent_id;
                }
            }
        }

        db.prepare('UPDATE files SET parent_id = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(parent_id || null, fileId);

        res.json({ message: 'Moved successfully' });
    } catch (error) {
        console.error('Move error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/files/:id/restore
 * Restore file/folder from trash
 */
router.put('/:id/restore', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        const file = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ? AND trashed = 1'
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found in trash' });
        }

        // Restore file
        db.prepare(`
            UPDATE files SET trashed = 0, trashed_at = NULL WHERE id = ?
        `).run(fileId);

        // Also restore children if it's a folder
        if (file.type === 'folder') {
            const restoreChildren = (parentId) => {
                const children = db.prepare('SELECT id, type FROM files WHERE parent_id = ?').all(parentId);
                for (const child of children) {
                    db.prepare('UPDATE files SET trashed = 0, trashed_at = NULL WHERE id = ?').run(child.id);
                    if (child.type === 'folder') {
                        restoreChildren(child.id);
                    }
                }
            };
            restoreChildren(fileId);
        }

        res.json({ message: 'Restored successfully' });
    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /api/files/:id
 * Move file/folder to trash
 */
router.delete('/:id', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        const file = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ?'
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Move to trash (soft delete)
        db.prepare(`
            UPDATE files SET trashed = 1, trashed_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(fileId);

        // Also trash all children if it's a folder
        if (file.type === 'folder') {
            const trashChildren = (parentId) => {
                const children = db.prepare('SELECT id, type FROM files WHERE parent_id = ?').all(parentId);
                for (const child of children) {
                    db.prepare('UPDATE files SET trashed = 1, trashed_at = CURRENT_TIMESTAMP WHERE id = ?').run(child.id);
                    if (child.type === 'folder') {
                        trashChildren(child.id);
                    }
                }
            };
            trashChildren(fileId);
        }

        res.json({ message: 'Moved to trash' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /api/files/:id/permanent
 * Permanently delete file/folder
 */
router.delete('/:id/permanent', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        const file = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ?'
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Delete physical file if it's not a folder
        if (file.type !== 'folder' && file.path) {
            const filePath = path.join(STORAGE_DIR, String(userId), file.path);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // If folder, delete all children first
        if (file.type === 'folder') {
            const deleteChildren = (parentId) => {
                const children = db.prepare('SELECT id, type, path FROM files WHERE parent_id = ?').all(parentId);
                for (const child of children) {
                    if (child.type === 'folder') {
                        deleteChildren(child.id);
                    } else if (child.path) {
                        const childPath = path.join(STORAGE_DIR, String(userId), child.path);
                        if (fs.existsSync(childPath)) {
                            fs.unlinkSync(childPath);
                        }
                    }
                    db.prepare('DELETE FROM files WHERE id = ?').run(child.id);
                }
            };
            deleteChildren(fileId);
        }

        // Delete the file/folder record
        db.prepare('DELETE FROM files WHERE id = ?').run(fileId);

        res.json({ message: 'Permanently deleted' });
    } catch (error) {
        console.error('Permanent delete error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
