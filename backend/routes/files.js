/**
 * FILE ROUTES
 * ===========
 * Handles file and folder operations
 * 
 * ENDPOINTS:
 * GET    /api/files              - List files/folders in directory
 * GET    /api/files/trash        - List trashed items
 * GET    /api/files/recent       - Get recently modified files
 * GET    /api/files/search       - Global file/folder search
 * POST   /api/files/folder       - Create new folder
 * POST   /api/files/upload       - Upload file(s)
 * GET    /api/files/:id/download - Download file or folder (ZIP)
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
const rateLimit = require('express-rate-limit'); // kept for reference but upload uses custom limiter
const fastq = require('fastq');
const archiver = require('archiver');
const { computeFileHash, verifyFileHash, encryptFile, decryptFileToBuffer, encryptFileWithKey, decryptFileToBufferWithKey, isEncryptionEnabled } = require('../utils/crypto-utils');
const { JWT_SECRET } = require('../utils/auth-config');
const { getActiveDEK } = require('../utils/key-wrap');

const router = express.Router();

// Default storage directory for internal storage (backward compatible)
const DEFAULT_STORAGE_DIR = path.join(__dirname, '..', 'storage');

// Ensure internal storage directory exists
if (!fs.existsSync(DEFAULT_STORAGE_DIR)) {
    fs.mkdirSync(DEFAULT_STORAGE_DIR, { recursive: true });
}

/**
 * STORAGE PATH RESOLUTION
 * -----------------------
 * Resolves the base directory for a storage source:
 *   - Internal: backend/storage/{userId}/
 *   - External: {drivePath}/cloudpi-data/{userId}/
 */
function getStorageBasePath(storageSourceId, userId) {
    if (!storageSourceId || storageSourceId === 'internal') {
        return path.join(DEFAULT_STORAGE_DIR, String(userId));
    }
    const source = db.prepare('SELECT path, is_active FROM storage_sources WHERE id = ?').get(storageSourceId);
    if (!source) return path.join(DEFAULT_STORAGE_DIR, String(userId)); // fallback
    return path.join(source.path, 'cloudpi-data', String(userId));
}

/**
 * Resolve the full disk path for a file record from the DB.
 * Looks up the storage source and builds: {sourceBasePath}/{userId}/{file.path}
 */
function resolveFilePath(file) {
    const basePath = getStorageBasePath(file.storage_source_id, file.user_id);
    return path.join(basePath, file.path);
}

/**
 * Get the user's default storage source ID.
 * Falls back to 'internal' if not set.
 */
function getUserStorageId(userId) {
    const user = db.prepare('SELECT default_storage_id FROM users WHERE id = ?').get(userId);
    return (user && user.default_storage_id) || 'internal';
}

// Configure multer for file uploads — saves to the user's assigned storage
const multerStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userId = req.user.userId;
        const storageId = getUserStorageId(userId);

        // Check storage source is active
        if (storageId !== 'internal') {
            const source = db.prepare('SELECT is_active, path FROM storage_sources WHERE id = ?').get(storageId);
            if (!source || !source.is_active || !fs.existsSync(source.path)) {
                // Fallback to internal if external drive unavailable
                req._storageSourceId = 'internal';
                const userDir = path.join(DEFAULT_STORAGE_DIR, String(userId));
                if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
                return cb(null, userDir);
            }
        }

        req._storageSourceId = storageId;
        const userDir = getStorageBasePath(storageId, userId);
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
    storage: multerStorage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    }
});

/**
 * UPLOAD RATE LIMITER (fully dynamic — admin-configurable)
 * -------------------
 * Custom rate limiter for uploads that reads BOTH max and window from DB.
 * Same approach as the global limiters in server.js.
 */
function getUploadSetting(key, fallback) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? parseInt(row.value, 10) : fallback;
}

const uploadHits = new Map(); // IP -> [timestamp, ...]
const uploadLimiter = (req, res, next) => {
    // Skip CORS preflight
    if (req.method === 'OPTIONS') return next();

    const max = getUploadSetting('rate_limit_upload_max', 10);
    const windowMinutes = getUploadSetting('rate_limit_upload_window', 15);
    const windowMs = windowMinutes * 60 * 1000;
    const ip = req.ip;
    const now = Date.now();

    const timestamps = (uploadHits.get(ip) || []).filter(t => now - t < windowMs);

    if (timestamps.length >= max) {
        uploadHits.set(ip, timestamps);
    
        // Drain the request body before responding — if we respond 429 before the
        // browser finishes sending file data, the browser sees a connection error
        // ("Failed to fetch") instead of our JSON error message.
        const sendError = () => {
            res.status(429).json({
                error: `Too many uploads. You've hit the limit of ${max} uploads. Please wait ${windowMinutes} minute(s) before uploading again.`
            });
        };

        req.on('data', () => {}); // consume and discard incoming data
        req.on('end', sendError);
        // Safety timeout in case 'end' never fires (e.g., client disconnected)
        setTimeout(() => {
            if (!res.headersSent) sendError();
        }, 5000);
        return;
    }

    timestamps.push(now);
    uploadHits.set(ip, timestamps);
    next();
};

/**
 * PRIORITY UPLOAD QUEUE
 * ---------------------
 * Processes file uploads one at a time (concurrency: 1) to:
 *   1. Prevent SQLite write contention (only one write at a time)
 *   2. Prevent the Pi's disk/CPU from being overwhelmed
 *   3. Allow admin uploads to be processed before regular user uploads
 *
 * HOW PRIORITY WORKS (using fastq's unshift/push):
 *   - Admin uploads use queue.unshift() → added to the FRONT of the queue (VIP)
 *   - Regular user uploads use queue.push() → added to the BACK of the queue
 *   - This means: if 3 regular uploads are waiting and an admin upload arrives,
 *     the admin upload jumps to the front and gets processed next
 *
 * The upload request waits in the queue until it's processed,
 * then returns the result — so the frontend needs NO changes.
 */
async function uploadWorker(task, callback) {
    // This function is called by fastq when it's this task's turn
    // We process the upload and call the callback with the result
    try {
        const { userId, parentId, files, storageSourceId } = task;
        const uploadedFiles = [];
        const encryptionOn = isEncryptionEnabled(db);

        for (const file of files) {
            const fileType = getFileType(file.mimetype);
            const diskPath = file.path;

            // 1. Compute SHA-256 hash of the PLAINTEXT file (before encryption)
            let sha256Hash = null;
            try {
                sha256Hash = await computeFileHash(diskPath);
            } catch (hashErr) {
                console.error('Hash computation failed:', hashErr.message);
            }

            // 2. Encrypt the file in-place if encryption is enabled
            let isEncrypted = 0;
            let isKeyWrapped = 0;
            if (encryptionOn) {
                try {
                    // Look up a per-drive DEK only when we have an explicit storage source ID.
                    // Internal storage (or unassigned files) always uses the master key.
                    const activeDEK = storageSourceId ? getActiveDEK(storageSourceId) : null;
                    if (activeDEK) {
                        await encryptFileWithKey(diskPath, diskPath, activeDEK);
                        isKeyWrapped = 1;
                    } else {
                        await encryptFile(diskPath, diskPath);
                    }
                    isEncrypted = 1;
                } catch (encErr) {
                    console.error('Encryption failed (storing plaintext):', encErr.message);
                }
            }

            // 3. Insert DB record with hash and encryption flag
            const result = db.prepare(`
                INSERT INTO files (user_id, name, path, type, size, mime_type, parent_id, storage_source_id, sha256_hash, encrypted, key_wrapped)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId,
                file.originalname,
                file.filename,
                fileType,
                file.size,
                file.mimetype,
                parentId,
                storageSourceId || 'internal',
                sha256Hash,
                isEncrypted,
                isKeyWrapped
            );

            const uploaded = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid);
            uploadedFiles.push(uploaded);
        }

        callback(null, uploadedFiles);
    } catch (error) {
        callback(error);
    }
}

// Create the queue: concurrency = 1 (one upload processed at a time)
const uploadQueue = fastq(uploadWorker, 1);

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

        // Validate token_version against database and fetch admin status
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

        // Attach user info including admin status (used by priority queue)
        req.user = { ...decoded, is_admin: user.is_admin };
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
 * GET /api/files/search
 * Global search across all user's files and folders
 * Query: ?q=search_term
 */
router.get('/search', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const query = req.query.q;

        if (!query || String(query).trim().length === 0) {
            return res.json({ files: [], query: '' });
        }

        const searchTerm = `%${String(query).trim()}%`;

        const files = db.prepare(`
            SELECT id, name, type, size, mime_type, parent_id, starred, created_at, modified_at
            FROM files
            WHERE user_id = ? AND trashed = 0 AND name LIKE ?
            ORDER BY 
                CASE WHEN type = 'folder' THEN 0 ELSE 1 END,
                modified_at DESC
            LIMIT 50
        `).all(userId, searchTerm);

        // Build path breadcrumbs for each result so the user knows WHERE the file is
        const results = files.map(file => {
            const pathParts = [];
            let parentId = file.parent_id;
            while (parentId) {
                const parent = db.prepare(
                    'SELECT id, name, parent_id FROM files WHERE id = ? AND user_id = ?'
                ).get(parentId, userId);
                if (parent) {
                    pathParts.unshift(parent.name);
                    parentId = parent.parent_id;
                } else {
                    break;
                }
            }
            return {
                ...file,
                location: pathParts.length > 0 ? pathParts.join(' / ') : 'Root'
            };
        });

        res.json({ files: results, query: String(query).trim() });
    } catch (error) {
        console.error('Search error:', error);
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
 * Upload one or more files — processed through priority queue
 *
 * HOW IT WORKS:
 * 1. Multer saves the file to disk (temp storage)
 * 2. We add a task to the priority queue
 * 3. The queue processes it when it's this task's turn
 * 4. We return the result to the frontend
 *
 * PRIORITY:
 * - Admin uploads → priority 1 (processed first)
 * - Regular user  → priority 10 (processed after admins)
 */
router.post('/upload', uploadLimiter, requireAuth, upload.array('files', 10), async (req, res) => {
    try {
        const userId = req.user.userId;
        const parentId = req.body.parent_id || null;
        const isAdmin = req.user.is_admin === 1;

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        // --- Storage Quota Check ---
        const userRow = db.prepare('SELECT storage_quota FROM users WHERE id = ?').get(userId);
        const quota = userRow?.storage_quota; // NULL = unlimited
        if (quota && quota > 0) {
            const usedRow = db.prepare(
                "SELECT COALESCE(SUM(size), 0) as used FROM files WHERE user_id = ? AND trashed = 0 AND type != 'folder'"
            ).get(userId);
            const currentUsed = usedRow.used || 0;
            const uploadSize = req.files.reduce((sum, f) => sum + f.size, 0);

            if (currentUsed + uploadSize > quota) {
                // Cleanup uploaded temp files
                req.files.forEach(f => {
                    if (f.path && fs.existsSync(f.path)) {
                        try { fs.unlinkSync(f.path); } catch (e) { /* ignore */ }
                    }
                });

                const usedMB = (currentUsed / (1024 * 1024)).toFixed(1);
                const quotaMB = (quota / (1024 * 1024)).toFixed(1);
                return res.status(413).json({
                    error: `Storage quota exceeded. You've used ${usedMB} MB of your ${quotaMB} MB limit.`
                });
            }
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

        // Determine upload priority and add to queue
        // Admin uploads go to the FRONT (unshift), regular users go to the BACK (push)
        const queueMethod = isAdmin ? 'unshift' : 'push';

        console.log(`📋 Upload queued: ${req.files.length} file(s) from ${req.user.username} (position: ${isAdmin ? 'FRONT (admin)' : 'BACK (regular)'})`);

        // Add to priority queue and WAIT for the result
        // The request stays open until the queue processes this task
        const uploadedFiles = await new Promise((resolve, reject) => {
            uploadQueue[queueMethod](
                { userId, parentId, files: req.files, storageSourceId: req._storageSourceId },
                (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                }
            );
        });

        console.log(`✅ Upload complete: ${uploadedFiles.length} file(s) from ${req.user.username}`);

        res.status(201).json({
            message: `${uploadedFiles.length} file(s) uploaded successfully`,
            files: uploadedFiles
        });
    } catch (error) {
        console.error('Upload error:', error);

        // CLEANUP - delete uploaded files if processing failed
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
 * Serve a file for inline preview (images, PDFs, videos, audio, text)
 * Accepts token via query string (needed for <img>, <video>, <audio>, <iframe> tags)
 */
router.get('/:id/preview', async (req, res) => {
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

        // Validate token_version
        const dbUser = db.prepare('SELECT token_version, is_disabled FROM users WHERE id = ?').get(userId);
        if (!dbUser) return res.status(401).json({ error: 'User not found' });
        if (dbUser.is_disabled) return res.status(403).json({ error: 'Account is disabled' });
        
        if (decoded.tokenVersion !== undefined) {
            if (decoded.tokenVersion !== (dbUser.token_version || 1)) {
                return res.status(401).json({ error: 'Token invalidated' });
            }
        }

        const file = db.prepare(
            "SELECT * FROM files WHERE id = ? AND user_id = ? AND type != 'folder'"
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        const filePath = resolveFilePath(file);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        // When raw=1 is set, serve as application/octet-stream to bypass
        // download managers (IDM) that intercept PDF content types
        const contentType = req.query.raw === '1'
            ? 'application/octet-stream'
            : (file.mime_type || 'application/octet-stream');

        res.set('Content-Type', contentType);
        res.set('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
        res.set('Cache-Control', 'public, max-age=86400');

        // If file is encrypted, decrypt to buffer and send
        if (file.encrypted === 1) {
            try {
                let decryptedBuffer;
                if (file.key_wrapped === 1) {
                    const activeDEK = file.storage_source_id
                        ? getActiveDEK(file.storage_source_id)
                        : null;
                    if (!activeDEK) {
                        return res.status(403).json({
                            error: 'Drive is locked. Please unlock the drive with its passphrase before accessing this file.'
                        });
                    }
                    decryptedBuffer = await decryptFileToBufferWithKey(filePath, activeDEK);
                } else {
                    decryptedBuffer = await decryptFileToBuffer(filePath);
                }
                res.set('Content-Length', decryptedBuffer.length);
                return res.send(decryptedBuffer);
            } catch (decErr) {
                console.error('Decryption error during preview:', decErr.message);
                return res.status(500).json({ error: 'Failed to decrypt file for preview' });
            }
        }

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
 * Download a file OR a folder (as ZIP)
 * For files: streams the file directly
 * For folders: recursively collects all files, streams a ZIP archive
 */
router.get('/:id/download', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const fileId = req.params.id;

        const file = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ?'
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // --- Regular file download ---
        if (file.type !== 'folder') {
            const filePath = resolveFilePath(file);
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'File not found on disk' });
            }

            // If file is encrypted, decrypt to buffer, verify hash, and send
            if (file.encrypted === 1) {
                try {
                    let decryptedBuffer;
                    if (file.key_wrapped === 1) {
                        const activeDEK = file.storage_source_id
                            ? getActiveDEK(file.storage_source_id)
                            : null;
                        if (!activeDEK) {
                            return res.status(403).json({
                                error: 'Drive is locked. Please unlock the drive with its passphrase before downloading this file.'
                            });
                        }
                        decryptedBuffer = await decryptFileToBufferWithKey(filePath, activeDEK);
                    } else {
                        decryptedBuffer = await decryptFileToBuffer(filePath);
                    }

                    // Verify SHA-256 integrity if hash exists
                    if (file.sha256_hash) {
                        const crypto = require('crypto');
                        const computedHash = crypto.createHash('sha256').update(decryptedBuffer).digest('hex');
                        if (computedHash !== file.sha256_hash) {
                            console.warn(`⚠️  Integrity mismatch for file ${file.id} (${file.name})`);
                            res.set('X-Integrity-Warning', 'hash-mismatch');
                        }
                    }

                    res.set('Content-Type', file.mime_type || 'application/octet-stream');
                    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
                    res.set('Content-Length', decryptedBuffer.length);
                    return res.send(decryptedBuffer);
                } catch (decErr) {
                    console.error('Decryption error during download:', decErr.message);
                    return res.status(500).json({ error: 'Failed to decrypt file' });
                }
            }

            // Unencrypted file — verify hash if available, then send
            if (file.sha256_hash) {
                try {
                    const { valid } = await verifyFileHash(filePath, file.sha256_hash);
                    if (!valid) {
                        console.warn(`⚠️  Integrity mismatch for file ${file.id} (${file.name})`);
                        res.set('X-Integrity-Warning', 'hash-mismatch');
                    }
                } catch (hashErr) {
                    console.error('Hash verification error:', hashErr.message);
                }
            }

            return res.download(filePath, file.name);
        }

        // --- Folder download as ZIP ---
        // Recursively collect all files in the folder
        function collectFiles(folderId, relativePath) {
            const children = db.prepare(
                'SELECT * FROM files WHERE parent_id = ? AND user_id = ? AND trashed = 0'
            ).all(folderId, userId);

            const collected = [];
            for (const child of children) {
                const childPath = relativePath ? `${relativePath}/${child.name}` : child.name;
                if (child.type === 'folder') {
                    collected.push(...collectFiles(child.id, childPath));
                } else {
                    const diskPath = resolveFilePath(child);
                    if (fs.existsSync(diskPath)) {
                        collected.push({
                            diskPath,
                            archivePath: childPath,
                            encrypted: child.encrypted === 1,
                            keyWrapped: child.key_wrapped === 1,
                            storageSourceId: child.storage_source_id || 'internal'
                        });
                    }
                }
            }
            return collected;
        }

        const filesToZip = collectFiles(file.id, '');

        if (filesToZip.length === 0) {
            return res.status(400).json({ error: 'Folder is empty — nothing to download' });
        }

        // Stream the ZIP directly to the response (no temp file on disk)
        const zipName = `${file.name}.zip`;
        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);

        const archive = archiver('zip', { zlib: { level: 5 } }); // level 5 = balanced speed/size
        archive.on('error', (err) => {
            console.error('ZIP error:', err);
            if (!res.headersSent) res.status(500).json({ error: 'ZIP creation failed' });
        });
        archive.pipe(res);

        const skippedFiles = [];
        for (const { diskPath, archivePath, encrypted, keyWrapped, storageSourceId } of filesToZip) {
            if (encrypted) {
                let decryptedBuffer;
                if (keyWrapped) {
                    const activeDEK = storageSourceId ? getActiveDEK(storageSourceId) : null;
                    if (!activeDEK) {
                        // Skip locked files rather than aborting the entire ZIP;
                        // report them via a response header so the client knows.
                        skippedFiles.push(archivePath);
                        console.warn(`⚠️  Skipping locked file in ZIP: ${archivePath} (drive ${storageSourceId} is locked)`);
                        continue;
                    }
                    decryptedBuffer = await decryptFileToBufferWithKey(diskPath, activeDEK);
                } else {
                    decryptedBuffer = await decryptFileToBuffer(diskPath);
                }
                archive.append(decryptedBuffer, { name: archivePath });
            } else {
                archive.file(diskPath, { name: archivePath });
            }
        }

        if (skippedFiles.length > 0) {
            res.set('X-Skipped-Locked-Files', skippedFiles.join(';'));
            console.warn(`⚠️  ZIP download skipped ${skippedFiles.length} locked file(s) — drive(s) must be unlocked first`);
        }

        archive.finalize();

    } catch (error) {
        console.error('Download error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Server error during download' });
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
            const filePath = resolveFilePath(file);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        // If folder, delete all children first
        if (file.type === 'folder') {
            const deleteChildren = (parentId) => {
                const children = db.prepare('SELECT id, type, path, storage_source_id FROM files WHERE parent_id = ?').all(parentId);
                for (const child of children) {
                    if (child.type === 'folder') {
                        deleteChildren(child.id);
                    } else if (child.path) {
                        const childPath = resolveFilePath({ ...child, user_id: userId, storage_source_id: child.storage_source_id });
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

/**
 * GET /api/files/storage-stats
 * Returns aggregate storage statistics (total bytes, used bytes) across all active storage sources.
 */
router.get('/storage-stats', requireAuth, (req, res) => {
    try {
        const sources = db.prepare('SELECT id, path, type, total_bytes FROM storage_sources WHERE is_active = 1').all();
        
        let totalSystemBytes = 0;
        let freeSystemBytes = 0;

        for (const source of sources) {
            let is_accessible = false;
            try {
                is_accessible = fs.existsSync(source.path);
            } catch (e) {
                is_accessible = false;
            }

            if (is_accessible) {
                try {
                    const stats = fs.statfsSync(source.path);
                    const total = stats.bsize * stats.blocks;
                    const free = stats.bsize * stats.bavail;
                    totalSystemBytes += total;
                    freeSystemBytes += free;
                } catch (e) {
                    // Fallback to database totals if statfs fails
                    // Get DB used bytes
                    const dbUsed = db.prepare('SELECT COALESCE(SUM(size), 0) as used FROM files WHERE storage_source_id = ? AND type != \'folder\'').get(source.id).used;
                    totalSystemBytes += source.total_bytes || 0;
                    freeSystemBytes += Math.max(0, (source.total_bytes || 0) - dbUsed);
                }
            }
        }

        // If for some reason we missed internal storage (e.g. not in DB yet), handle it:
        if (sources.length === 0) {
            try {
                const stats = fs.statfsSync(DEFAULT_STORAGE_DIR);
                totalSystemBytes = stats.bsize * stats.blocks;
                freeSystemBytes = stats.bsize * stats.bavail;
            } catch (e) {
                // Ignore
            }
        }

        const usedSystemBytes = totalSystemBytes - freeSystemBytes;
        
        res.json({
            totalBytes: totalSystemBytes,
            usedBytes: usedSystemBytes > 0 ? usedSystemBytes : 0
        });

    } catch (error) {
        console.error('Storage stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
