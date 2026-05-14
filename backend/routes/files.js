/**
 * FILE ROUTES
 * ===========
 * Handles file and folder operations
 * 
 * ENDPOINTS:
 * GET    /api/files              - List files/folders in directory
 * GET    /api/files/trash        - List trashed items
 * DELETE /api/files/trash/empty  - Permanently empty trash
 * GET    /api/files/recent       - Get recently modified files
 * GET    /api/files/search       - Global file/folder search
 * POST   /api/files/folder       - Create new folder
 * POST   /api/files/upload       - Upload file(s)
 * POST   /api/files/bulk-download - Download selected files/folders as ZIP
 * GET    /api/files/:id/thumbnail - Get rich media thumbnail
 * GET    /api/files/:id/download - Download file or folder (ZIP)
 * PUT    /api/files/:id          - Rename file/folder
 * PUT    /api/files/:id/star     - Toggle star status
 * PUT    /api/files/:id/move     - Move to different folder
 * POST   /api/files/:id/copy     - Copy file/folder to different location
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
const { spawn } = require('child_process');
const eventBus = require('../utils/event-bus');
const { computeFileHash, verifyFileHash, encryptFile, decryptToStream, createDecryptStream, isEncryptionEnabled } = require('../utils/crypto-utils');
const { JWT_SECRET } = require('../utils/auth-config');
const { ensureProtectedInternalStorageAvailable } = require('../utils/protected-storage');
const { evaluateStorageQuotaNotification } = require('../utils/notifications');
const { createActivityEvent } = require('../utils/activity');
const {
    saveUploadedFileVersionAware,
    listFileVersions,
    restoreFileVersion,
    deleteFileVersion,
    deleteAllVersionsForFile,
    pruneFileVersions,
    getTotalUsedBytesForUser,
    getVersionBytesForUser,
    getVersionBytesForStorageSource,
} = require('../utils/file-versioning');

const router = express.Router();

// Default storage directory for internal storage (backward compatible)
const DEFAULT_STORAGE_DIR = path.join(__dirname, '..', 'storage');
const THUMBNAILS_DIR = path.join(DEFAULT_STORAGE_DIR, '.thumbnails');
const REGULAR_UPLOAD_TEMP_ROOT = '.upload-tmp';
const MAX_REGULAR_CHUNK_UPLOAD_BYTES = 6 * 1024 * 1024;
const DEFAULT_TRASH_RETENTION_DAYS = 30;
const MAX_TRASH_RETENTION_DAYS = 3650;
const regularUploadSessions = new Map();

let sharp = null;
try {
    sharp = require('sharp');
} catch (e) {
    console.warn('sharp is not installed - image thumbnails will use fallback previews');
}

let ffmpegPath = null;
try {
    ffmpegPath = require('ffmpeg-static');
} catch (e) {
    console.warn('ffmpeg-static is not installed - video thumbnails are unavailable');
}

if (ffmpegPath && !fs.existsSync(ffmpegPath)) {
    console.warn(`ffmpeg binary was not found at ${ffmpegPath} - video thumbnails are unavailable`);
    ffmpegPath = null;
}

// Ensure internal storage directory exists
if (!fs.existsSync(DEFAULT_STORAGE_DIR)) {
    fs.mkdirSync(DEFAULT_STORAGE_DIR, { recursive: true });
}

if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
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
        ensureProtectedInternalStorageAvailable();
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

function getFileStorageStatus(file) {
    const storageSourceId = file?.storage_source_id || 'internal';
    if (!storageSourceId || storageSourceId === 'internal') {
        return { accessible: true, label: 'Internal Storage' };
    }

    const source = db.prepare('SELECT id, label, path, is_accessible FROM storage_sources WHERE id = ?')
        .get(storageSourceId);
    if (!source) {
        return { accessible: false, label: 'Unknown storage drive' };
    }

    let accessible = false;
    try {
        const { isDriveActuallyPresent } = require('./events');
        accessible = isDriveActuallyPresent(source.path, storageSourceId);
    } catch {
        accessible = false;
    }

    if (!!source.is_accessible !== accessible) {
        db.prepare('UPDATE storage_sources SET is_accessible = ? WHERE id = ?')
            .run(accessible ? 1 : 0, storageSourceId);
        eventBus.emit('drive_status_change', {
            source_id: storageSourceId,
            label: source.label,
            status: accessible ? 'online' : 'offline',
            timestamp: Date.now(),
        });
    }

    return { accessible, label: source.label };
}

function assertFileStorageAvailable(file, res, action = 'modify') {
    const status = getFileStorageStatus(file);
    if (status.accessible) return true;

    res.status(503).json({
        error: `Storage drive "${status.label}" is disconnected. Reconnect it before you ${action} this item.`,
        drive_disconnected: true,
    });
    return false;
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function removePathRecursive(targetPath) {
    if (!targetPath || !fs.existsSync(targetPath)) return;
    fs.rmSync(targetPath, { recursive: true, force: true });
}

function getRegularUploadTempPath(storageSourceId, userId, uploadId) {
    return path.join(getStorageBasePath(storageSourceId, userId), REGULAR_UPLOAD_TEMP_ROOT, uploadId);
}

function getRegularUploadChunkPath(tempPath, index) {
    return path.join(tempPath, `chunk-${String(index).padStart(6, '0')}.part`);
}

function isVaultItem(file) {
    return !!file && (file.is_secure_vault === 1 || Number.isInteger(file.vault_root_id));
}

function sanitizeArchiveSegment(segment) {
    const value = String(segment || 'untitled').replace(/[\\/:*?"<>|]+/g, '_').trim();
    return value || 'untitled';
}

function uniqueArchivePathFactory() {
    const used = new Set();
    return (archivePath) => {
        const sanitized = String(archivePath || 'download')
            .split('/')
            .filter(Boolean)
            .map(sanitizeArchiveSegment)
            .join('/') || 'download';

        if (!used.has(sanitized)) {
            used.add(sanitized);
            return sanitized;
        }

        const ext = path.extname(sanitized);
        const base = ext ? sanitized.slice(0, -ext.length) : sanitized;
        let index = 2;
        let candidate = ext ? `${base} (${index})${ext}` : `${base} (${index})`;
        while (used.has(candidate)) {
            index += 1;
            candidate = ext ? `${base} (${index})${ext}` : `${base} (${index})`;
        }
        used.add(candidate);
        return candidate;
    };
}

function sendFileSafely(res, filePath, notFoundMessage = 'File not found on disk') {
    return res.sendFile(filePath, (err) => {
        if (!err) return;

        const status = err.statusCode || err.status || 500;
        if (err.code === 'ECONNABORTED' || err.message === 'Request aborted') {
            return;
        }

        if (status !== 404) {
            console.error('sendFile error:', err.message);
        }

        if (!res.headersSent) {
            res.status(status === 404 ? 404 : 500).json({
                error: status === 404 ? notFoundMessage : 'Failed to send file'
            });
        }
    });
}

function getPreviewContentType(file) {
    const mimeType = String(file?.mime_type || '').trim();
    if (mimeType) return mimeType;

    const name = String(file?.name || '').toLowerCase();
    if (name.endsWith('.pdf')) return 'application/pdf';

    return 'application/octet-stream';
}

function deleteStoredItem(file) {
    if (!file || !file.path) return;
    const filePath = resolveFilePath(file);
    if (!fs.existsSync(filePath)) return;

    if (isVaultItem(file)) {
        fs.rmSync(filePath, { recursive: true, force: true });
        return;
    }

    fs.unlinkSync(filePath);
}

function deleteStoredVersionBlob(version) {
    if (!version || !version.path) return;
    const filePath = resolveFilePath({
        user_id: version.user_id,
        storage_source_id: version.storage_source_id,
        path: version.path,
    });
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

function pruneVersionsForFile(fileId) {
    return pruneFileVersions(db, fileId, deleteStoredVersionBlob);
}

function pruneAllFileVersions() {
    const fileIds = db.prepare('SELECT DISTINCT file_id FROM file_versions').all();
    let pruned = 0;
    for (const row of fileIds) {
        pruned += pruneVersionsForFile(row.file_id);
    }
    if (pruned > 0) {
        console.log(`🧹 Pruned ${pruned} old file version(s)`);
    }
    return pruned;
}

function getCurrentFolderContext(userId, folderId) {
    if (!folderId) return null;

    const folder = db.prepare(`
        SELECT id, name, parent_id, encrypted_metadata, is_secure_vault, vault_root_id
        FROM files
        WHERE id = ? AND user_id = ? AND type = 'folder' AND trashed = 0
    `).get(folderId, userId);

    if (!folder) return null;

    const vaultId = folder.is_secure_vault === 1 ? folder.id : folder.vault_root_id;
    if (!vaultId) {
        return { folder, vault: null };
    }

    const vault = db.prepare(`
        SELECT id, name, parent_id, encrypted_metadata, is_secure_vault, vault_root_id
        FROM files
        WHERE id = ? AND user_id = ? AND type = 'folder' AND is_secure_vault = 1 AND trashed = 0
    `).get(vaultId, userId);

    return { folder, vault: vault || null };
}

function buildFileLocation(userId, parentId) {
    const pathParts = [];
    let currentParentId = parentId;
    const seen = new Set();

    while (currentParentId && !seen.has(currentParentId)) {
        seen.add(currentParentId);
        const parent = db.prepare(
            'SELECT id, name, parent_id FROM files WHERE id = ? AND user_id = ?'
        ).get(currentParentId, userId);
        if (!parent) break;
        pathParts.unshift(parent.name);
        currentParentId = parent.parent_id;
    }

    return pathParts.length > 0 ? pathParts.join(' / ') : 'My Files';
}

function buildFileLink(file) {
    const params = new URLSearchParams();
    if (file.parent_id) params.set('folder', String(file.parent_id));
    if (file.id) params.set('highlight', String(file.id));
    return `/files?${params.toString()}`;
}

function logFileActivity(userId, type, file, title, body = null, metadata = {}) {
    if (!file) return;
    createActivityEvent({
        userId,
        actorId: userId,
        type,
        title,
        body: body || buildFileLocation(userId, file.parent_id),
        link: type === 'file.deleted' ? null : buildFileLink(file),
        metadata: {
            fileId: file.id,
            fileName: file.name,
            fileType: file.type,
            parentId: file.parent_id,
            ...metadata,
        },
    });
}

const RECENT_TIMESTAMP_SQL = `
    strftime('%Y-%m-%dT%H:%M:%SZ', max(
        CAST(strftime('%s', COALESCE(f.created_at, '1970-01-01 00:00:00')) AS INTEGER),
        CAST(strftime('%s', COALESCE(f.modified_at, f.created_at, '1970-01-01 00:00:00')) AS INTEGER),
        CAST(strftime('%s', COALESCE(f.accessed_at, f.created_at, '1970-01-01 00:00:00')) AS INTEGER)
    ), 'unixepoch')
`;

const RECENT_ACTION_SQL = `
    CASE
        WHEN f.accessed_at IS NOT NULL
             AND datetime(f.accessed_at) >= datetime(COALESCE(f.modified_at, f.created_at))
             AND datetime(f.accessed_at) >= datetime(f.created_at)
            THEN 'viewed'
        WHEN f.modified_at IS NOT NULL
             AND datetime(f.modified_at) > datetime(f.created_at)
            THEN 'modified'
        ELSE 'uploaded'
    END
`;

/**
 * Get the user's default storage source ID.
 * Falls back to 'internal' if not set.
 *
 * AUTO-FALLBACK: If the user's assigned drive is disconnected (path not
 * accessible), automatically falls back to internal storage so operations
 * keep working instead of crashing with cryptic errors.
 */
function getUserStorageId(userId) {
    const user = db.prepare('SELECT default_storage_id FROM users WHERE id = ?').get(userId);
    const storageId = (user && user.default_storage_id) || 'internal';

    if (storageId === 'internal') {
        ensureProtectedInternalStorageAvailable();
    }

    if (storageId !== 'internal') {
        const source = db.prepare('SELECT path, is_active, is_accessible, label FROM storage_sources WHERE id = ?').get(storageId);
        if (!source || !source.is_active || !source.is_accessible) {
            console.warn(`⚠️ [STORAGE] User ${userId} assigned to storage "${storageId}" which is inactive or inaccessible. Falling back to internal.`);
            return 'internal';
        }
        try {
            // Use mount-point-aware check: the ghost /media/pi/sda1 directory
            // persists after USB unplug, but it's on the root filesystem.
            // isDriveActuallyPresent detects this by comparing device IDs.
            const { isDriveActuallyPresent } = require('./events');
            if (!isDriveActuallyPresent(source.path, storageId)) {
                console.warn(`⚠️ [STORAGE] User ${userId} assigned to drive "${source.label}" at ${source.path} but the drive is NOT actually mounted. Falling back to internal storage.`);
                // Also update DB so we don't re-check on every request
                db.prepare('UPDATE storage_sources SET is_accessible = 0 WHERE id = ?').run(storageId);
                return 'internal';
            }
        } catch (e) {
            console.warn(`⚠️ [STORAGE] User ${userId} — error checking drive "${source.label}" at ${source.path}: ${e.message}. Falling back to internal.`);
            return 'internal';
        }
    }

    return storageId;
}

// Configure multer for file uploads — saves to the user's assigned storage
const multerStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const userId = req.user.userId;
        const storageId = getUserStorageId(userId);

        // Check storage source is active and actually mounted
        if (storageId !== 'internal') {
            const source = db.prepare('SELECT is_active, path, id FROM storage_sources WHERE id = ?').get(storageId);
            const { isDriveActuallyPresent } = require('./events');
            if (!source || !source.is_active || !isDriveActuallyPresent(source.path, source.id)) {
                // Fallback to internal if external drive unavailable
                req._storageSourceId = 'internal';
                ensureProtectedInternalStorageAvailable();
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

function getTrashRetentionDays() {
    const configuredDays = getUploadSetting('trash_retention_days', DEFAULT_TRASH_RETENTION_DAYS);
    if (!Number.isFinite(configuredDays) || configuredDays < 1) {
        return DEFAULT_TRASH_RETENTION_DAYS;
    }
    return Math.min(Math.floor(configuredDays), MAX_TRASH_RETENTION_DAYS);
}

function purgeExpiredTrashForUser(userId, retentionDays = getTrashRetentionDays()) {
    const days = Math.max(1, Math.min(Number(retentionDays) || DEFAULT_TRASH_RETENTION_DAYS, MAX_TRASH_RETENTION_DAYS));
    const cutoffModifier = `-${days} days`;
    const trashedItems = db.prepare(`
        SELECT id, user_id, path, type, size, storage_source_id, vault_root_id, is_secure_vault
        FROM files
        WHERE user_id = ?
          AND trashed = 1
          AND trashed_at IS NOT NULL
          AND datetime(trashed_at) <= datetime('now', ?)
        ORDER BY CASE WHEN type = 'folder' THEN 0 ELSE 1 END, id ASC
    `).all(userId, cutoffModifier);

    if (trashedItems.length === 0) {
        return {
            deletedItems: 0,
            deletedFiles: 0,
            freedBytes: 0,
        };
    }

    let deletedFiles = 0;
    let freedBytes = 0;

    for (const item of trashedItems) {
        const versionBytes = item.type !== 'folder'
            ? db.prepare('SELECT COALESCE(SUM(size), 0) as bytes FROM file_versions WHERE file_id = ?').get(item.id).bytes || 0
            : 0;

        if (item.type !== 'folder') {
            deleteAllVersionsForFile(db, item.id, deleteStoredVersionBlob);
            if (item.path) deleteStoredItem(item);
            deletedFiles += 1;
            freedBytes += (Number(item.size) || 0) + versionBytes;
        }
    }

    db.prepare(`
        DELETE FROM files
        WHERE user_id = ?
          AND trashed = 1
          AND trashed_at IS NOT NULL
          AND datetime(trashed_at) <= datetime('now', ?)
    `).run(userId, cutoffModifier);

    return {
        deletedItems: trashedItems.length,
        deletedFiles,
        freedBytes,
    };
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
        const folderCache = new Map();

        // Check once per batch whether encryption is enabled
        const shouldEncrypt = isEncryptionEnabled(db);

        for (const file of files) {
            const uploadDestination = resolveUploadDestination(
                userId,
                parentId,
                file.relativePath || file.originalname,
                storageSourceId || 'internal',
                folderCache
            );
            const fileType = getFileType(file.mimetype);
            const diskPath = file.path;

            // Compute SHA-256 hash on the PLAINTEXT before any encryption.
            // This ensures identical files produce the same hash regardless of
            // their unique IVs, and download integrity checks work correctly.
            let sha256Hash = null;
            try {
                sha256Hash = await computeFileHash(diskPath);
            } catch (hashErr) {
                console.error('Hash computation failed:', hashErr.message);
            }

            // Encryption path: AES-256-GCM streaming encryption
            let encrypted = 0;
            let encryptionIv = null;
            let encryptionAuthTag = null;
            let finalSize = file.size;

            if (shouldEncrypt) {
                const encPath = diskPath + '.enc';
                try {
                    const result = await encryptFile(diskPath, encPath);
                    // Replace original plaintext with encrypted version atomically
                    fs.unlinkSync(diskPath);
                    fs.renameSync(encPath, diskPath);

                    encrypted = 1;
                    encryptionIv = result.iv.toString('hex');
                    encryptionAuthTag = result.authTag.toString('hex');
                    finalSize = result.encryptedSize;
                } catch (encErr) {
                    // Drive may have been disconnected mid-encrypt (ENOENT / EIO)
                    console.error(`⚠️ Encryption failed for ${file.originalname}:`, encErr.message);
                    // Clean up partial .enc file if it exists
                    try { fs.unlinkSync(encPath); } catch (_) { /* ignore */ }
                    // If the original file is also gone (drive pulled), throw to fail the upload
                    if (!fs.existsSync(diskPath)) {
                        throw new Error(`Storage unavailable during encryption of ${file.originalname} — drive may be disconnected`);
                    }
                    // If the original is still there, proceed unencrypted (graceful degradation)
                    console.warn(`   → File saved unencrypted as fallback`);
                }
            }

            const uploaded = saveUploadedFileVersionAware(db, {
                userId,
                parentId: uploadDestination.parentId,
                name: uploadDestination.fileName,
                path: file.filename,
                type: fileType,
                size: finalSize,
                mimeType: file.mimetype,
                storageSourceId: storageSourceId || 'internal',
                sha256Hash,
                encrypted,
                e2eeIv: encryptionIv,
                encryptionAuthTag,
            });
            file._cloudpiCommitted = true;
            pruneVersionsForFile(uploaded.id);
            uploadedFiles.push(uploaded);
            const isNewVersion = Number(uploaded.version_number || 1) > 1;
            logFileActivity(
                userId,
                isNewVersion ? 'file.versioned' : 'file.uploaded',
                uploaded,
                isNewVersion
                    ? `Uploaded new version of "${uploaded.name}"`
                    : `Uploaded "${uploaded.name}"`,
                null,
                { versionNumber: uploaded.version_number || 1 }
            );
        }

        evaluateStorageQuotaNotification(userId);
        callback(null, uploadedFiles);
    } catch (error) {
        callback(error);
    }
}

// Create the queue: concurrency = 1 (one upload processed at a time)
const uploadQueue = fastq(uploadWorker, 1);

const versionPruneInterval = setInterval(() => {
    try {
        pruneAllFileVersions();
        cleanupStaleRegularUploadSessions();
    } catch (error) {
        console.error('Nightly version pruning failed:', error);
    }
}, 24 * 60 * 60 * 1000);
if (typeof versionPruneInterval.unref === 'function') {
    versionPruneInterval.unref();
}

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
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
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

function normalizeParentId(parentId) {
    if (parentId === null || parentId === undefined || parentId === '') return null;
    const parsed = Number(parentId);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeUploadRelativePath(relativePath, fallbackName) {
    const raw = String(relativePath || fallbackName || '').replace(/\\/g, '/');
    const segments = raw
        .split('/')
        .map((segment) => sanitizeArchiveSegment(segment))
        .filter((segment) => segment && segment !== '.' && segment !== '..');

    if (segments.length === 0) {
        return sanitizeArchiveSegment(fallbackName || 'upload');
    }

    return segments.join('/');
}

function normalizeRelativePathList(value, files) {
    const list = Array.isArray(value)
        ? value
        : value === undefined || value === null
            ? []
            : [value];

    return files.map((file, index) => normalizeUploadRelativePath(list[index], file.originalname));
}

function splitFileName(name) {
    const ext = path.extname(name);
    if (!ext) return { base: name, ext: '' };
    return {
        base: name.slice(0, -ext.length),
        ext,
    };
}

function hasNameConflict(userId, parentId, name, excludeId = null) {
    const baseParams = [userId, name];
    let query = 'SELECT id FROM files WHERE user_id = ? AND name = ? AND trashed = 0 AND (vault_root_id IS NULL OR is_secure_vault = 1)';

    if (excludeId) {
        query += ' AND id != ?';
        baseParams.push(excludeId);
    }

    if (parentId) {
        query += ' AND parent_id = ?';
        baseParams.push(parentId);
    } else {
        query += ' AND parent_id IS NULL';
    }

    return !!db.prepare(query).get(...baseParams);
}

function getUniqueSiblingName(userId, parentId, originalName, excludeId = null) {
    if (!hasNameConflict(userId, parentId, originalName, excludeId)) {
        return originalName;
    }

    const { base, ext } = splitFileName(originalName);
    let counter = 1;
    while (counter < 1000) {
        const candidate = `${base} (${counter})${ext}`;
        if (!hasNameConflict(userId, parentId, candidate, excludeId)) {
            return candidate;
        }
        counter += 1;
    }

    return `${base} (${Date.now()})${ext}`;
}

function getUploadFolderCacheKey(parentId, folderName) {
    return `${parentId ?? 'root'}\u0000${folderName}`;
}

function getOrCreateUploadFolder(userId, parentId, folderName, storageSourceId, folderCache) {
    const cacheKey = getUploadFolderCacheKey(parentId, folderName);
    if (folderCache.has(cacheKey)) {
        return folderCache.get(cacheKey);
    }

    const existing = parentId
        ? db.prepare(`
            SELECT id
            FROM files
            WHERE user_id = ?
              AND parent_id = ?
              AND name = ?
              AND type = 'folder'
              AND trashed = 0
              AND (vault_root_id IS NULL OR is_secure_vault = 1)
        `).get(userId, parentId, folderName)
        : db.prepare(`
            SELECT id
            FROM files
            WHERE user_id = ?
              AND parent_id IS NULL
              AND name = ?
              AND type = 'folder'
              AND trashed = 0
              AND (vault_root_id IS NULL OR is_secure_vault = 1)
        `).get(userId, folderName);

    if (existing) {
        folderCache.set(cacheKey, existing.id);
        return existing.id;
    }

    const safeName = getUniqueSiblingName(userId, parentId, folderName);
    const inserted = db.prepare(`
        INSERT INTO files (user_id, name, path, type, size, mime_type, parent_id, storage_source_id)
        VALUES (?, ?, '', 'folder', 0, NULL, ?, ?)
    `).run(userId, safeName, parentId, storageSourceId || 'internal');

    folderCache.set(cacheKey, inserted.lastInsertRowid);
    logFileActivity(userId, 'folder.created', {
        id: inserted.lastInsertRowid,
        name: safeName,
        type: 'folder',
        parent_id: parentId,
    }, `Created folder "${safeName}"`);
    return inserted.lastInsertRowid;
}

function resolveUploadDestination(userId, rootParentId, relativePath, storageSourceId, folderCache) {
    const parts = normalizeUploadRelativePath(relativePath, 'upload').split('/');
    const fileName = parts.pop() || 'upload';
    let parentId = rootParentId;

    for (const part of parts) {
        parentId = getOrCreateUploadFolder(userId, parentId, part, storageSourceId, folderCache);
    }

    return {
        parentId,
        fileName: sanitizeArchiveSegment(fileName),
    };
}

function validateUploadParent(userId, parentId) {
    if (!parentId) return null;
    const parentFolder = db.prepare(
        "SELECT id, is_secure_vault, vault_root_id FROM files WHERE id = ? AND user_id = ? AND type = 'folder' AND trashed = 0"
    ).get(parentId, userId);
    if (!parentFolder) {
        const error = new Error('Parent folder not found');
        error.statusCode = 400;
        throw error;
    }
    if (parentFolder.is_secure_vault === 1 || parentFolder.vault_root_id !== null) {
        const error = new Error('Encrypted vault uploads must use the secure vault uploader');
        error.statusCode = 400;
        throw error;
    }
    return parentFolder;
}

function ensureUploadQuotaAvailable(userId, uploadSize) {
    const userRow = db.prepare('SELECT storage_quota FROM users WHERE id = ?').get(userId);
    const quota = userRow?.storage_quota;
    if (!quota || quota <= 0) return;

    const currentUsed = getTotalUsedBytesForUser(db, userId);
    if (currentUsed + uploadSize <= quota) return;

    evaluateStorageQuotaNotification(userId, {
        usedBytes: currentUsed + uploadSize,
        quotaBytes: quota,
        forceBucket: 'quota_reached',
    });
    const usedMB = (currentUsed / (1024 * 1024)).toFixed(1);
    const quotaMB = (quota / (1024 * 1024)).toFixed(1);
    const error = new Error(`Storage quota exceeded. You've used ${usedMB} MB of your ${quotaMB} MB limit.`);
    error.statusCode = 413;
    throw error;
}

function queueUploadedFiles({ userId, parentId, files, storageSourceId, isAdmin }) {
    const queueMethod = isAdmin ? 'unshift' : 'push';
    return new Promise((resolve, reject) => {
        uploadQueue[queueMethod](
            { userId, parentId, files, storageSourceId },
            (err, result) => {
                if (err) reject(err);
                else resolve(result);
            }
        );
    });
}

function cleanupStaleRegularUploadSessions(maxAgeHours = 24) {
    const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
    for (const [uploadId, session] of regularUploadSessions.entries()) {
        if (session.createdAt >= cutoff) continue;
        removePathRecursive(session.tempPath);
        regularUploadSessions.delete(uploadId);
    }
}

function isFolderDescendant(userId, ancestorId, targetFolderId) {
    let currentId = targetFolderId;
    while (currentId) {
        if (Number(currentId) === Number(ancestorId)) {
            return true;
        }
        const parent = db.prepare(
            'SELECT parent_id FROM files WHERE id = ? AND user_id = ? AND type = \'folder\''
        ).get(currentId, userId);
        currentId = parent?.parent_id || null;
    }
    return false;
}

function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) {
            reject(new Error('ffmpeg binary is unavailable'));
            return;
        }

        const child = spawn(ffmpegPath, args, { windowsHide: true });
        let stderr = '';

        child.stderr.on('data', (chunk) => {
            stderr += String(chunk || '');
        });
        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) return resolve();
            reject(new Error(stderr || `ffmpeg exited with code ${code}`));
        });
    });
}

function ensureThumbnailDirForUser(userId) {
    const dir = path.join(THUMBNAILS_DIR, String(userId));
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
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
            SELECT f.id, f.name, f.type, f.size, f.mime_type, f.parent_id, f.starred,
                   f.version_number,
                   f.created_at, f.modified_at, f.storage_source_id,
                   ss.label as storage_source_label,
                   ss.type as storage_source_type,
                   f.encrypted_metadata, f.storage_id, f.e2ee_iv, f.is_chunked,
                   f.chunk_count, f.vault_root_id, f.is_secure_vault,
                   COALESCE(ss.is_accessible, 1) as is_accessible,
                   (
                       SELECT COUNT(*)
                       FROM shares s
                       WHERE s.file_id = f.id
                         AND s.shared_by = ?
                         AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now'))
                   ) as shared_count,
                   (
                       SELECT COUNT(*)
                       FROM shares s
                       WHERE s.file_id = f.id
                         AND s.shared_by = ?
                         AND (COALESCE(s.share_type, CASE WHEN s.shared_with IS NULL THEN 'link' ELSE 'user' END) = 'link')
                         AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now'))
                   ) as public_share_count
            FROM files f
            LEFT JOIN storage_sources ss ON f.storage_source_id = ss.id
            WHERE f.user_id = ? AND f.trashed = 0
        `;
        const params = [userId, userId, userId];

        if (starredOnly) {
            query += ' AND f.starred = 1';
        } else if (parentId) {
            query += ' AND f.parent_id = ?';
            params.push(parentId);
        } else {
            query += ' AND f.parent_id IS NULL';
        }

        query += " ORDER BY CASE WHEN f.type = 'folder' THEN 0 ELSE 1 END, f.name ASC";

        let files = db.prepare(query).all(...params);

        if (starredOnly) {
            files = files.map(file => ({
                ...file,
                location: buildFileLocation(userId, file.parent_id),
            }));
        }

        if (!starredOnly && !parentId) {
            const shortcuts = db.prepare(`
                SELECT
                    -sc.id as id,
                    f.name,
                    f.type,
                    f.size,
                    f.mime_type,
                    NULL as parent_id,
                    0 as starred,
                    f.version_number,
                    sc.created_at,
                    f.modified_at,
                    f.storage_source_id,
                    ss.label as storage_source_label,
                    ss.type as storage_source_type,
                    NULL as encrypted_metadata,
                    f.storage_id,
                    f.e2ee_iv,
                    f.is_chunked,
                    f.chunk_count,
                    f.vault_root_id,
                    f.is_secure_vault,
                    COALESCE(ss.is_accessible, 1) as is_accessible,
                    0 as shared_count,
                    0 as public_share_count,
                    1 as is_share_shortcut,
                    sc.id as shortcut_id,
                    s.id as share_id,
                    s.file_id as target_file_id,
                    s.permission as share_permission,
                    s.allow_download as share_allow_download,
                    s.expires_at as share_expires_at,
                    u.username as shared_by_name
                FROM share_shortcuts sc
                JOIN shares s ON sc.share_id = s.id
                JOIN files f ON s.file_id = f.id
                JOIN users u ON s.shared_by = u.id
                LEFT JOIN storage_sources ss ON f.storage_source_id = ss.id
                WHERE sc.user_id = ?
                  AND s.shared_with = ?
                  AND f.trashed = 0
                  AND COALESCE(s.share_type, 'user') = 'user'
                  AND s.permission != 'upload'
                  AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now'))
                ORDER BY CASE WHEN f.type = 'folder' THEN 0 ELSE 1 END, f.name ASC
            `).all(userId, userId);

            files = [...files, ...shortcuts].sort((a, b) => {
                if (a.type === 'folder' && b.type !== 'folder') return -1;
                if (a.type !== 'folder' && b.type === 'folder') return 1;
                return String(a.name || '').localeCompare(String(b.name || ''));
            });
        }

        // Get breadcrumb path
        let breadcrumbs = [];
        if (parentId) {
            let currentId = parentId;
            while (currentId) {
                const folder = db.prepare(
                    'SELECT id, name, parent_id, encrypted_metadata, is_secure_vault, vault_root_id FROM files WHERE id = ? AND user_id = ?'
                ).get(currentId, userId);
                if (folder) {
                    breadcrumbs.unshift({
                        id: folder.id,
                        name: folder.name,
                        encrypted_metadata: folder.encrypted_metadata,
                        is_secure_vault: folder.is_secure_vault,
                        vault_root_id: folder.vault_root_id,
                    });
                    currentId = folder.parent_id;
                } else {
                    break;
                }
            }
        }

        // Check if user's assigned storage is disconnected and add a warning
        // Uses the is_accessible column (updated by udev events) instead of polling fs.existsSync
        const userRow = db.prepare('SELECT default_storage_id FROM users WHERE id = ?').get(userId);
        let storageWarning = null;
        if (userRow && userRow.default_storage_id) {
            const source = db.prepare('SELECT label, type, is_active, is_accessible FROM storage_sources WHERE id = ?').get(userRow.default_storage_id);
            if (source && (!source.is_active || !source.is_accessible)) {
                storageWarning = source.type === 'internal'
                    ? `CloudPi internal encrypted storage is locked or unavailable. Unlock the LUKS drive before opening, previewing, or uploading internal files.`
                    : `Your assigned storage drive "${source.label}" is not currently attached. New files will be saved to internal storage until the drive is reconnected.`;
            }
        }

        const currentContext = getCurrentFolderContext(userId, parentId ? Number(parentId) : null);

        res.json({
            files,
            breadcrumbs,
            currentFolder: currentContext?.folder || null,
            currentVault: currentContext?.vault || null,
            ...(storageWarning && { storageWarning }),
        });
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
        const retentionDays = getTrashRetentionDays();
        let purged = {
            deletedItems: 0,
            deletedFiles: 0,
            freedBytes: 0,
        };

        try {
            purged = purgeExpiredTrashForUser(userId, retentionDays);
        } catch (cleanupError) {
            console.error('Trash retention cleanup error:', cleanupError);
        }

        const files = db.prepare(`
            SELECT f.id, f.name, f.type, f.size, f.mime_type, f.parent_id, f.starred,
                   f.version_number,
                   f.created_at, f.modified_at, f.trashed_at, f.storage_source_id,
                   ss.label as storage_source_label,
                   ss.type as storage_source_type,
                   f.encrypted_metadata, f.storage_id, f.e2ee_iv, f.is_chunked,
                   f.chunk_count, f.vault_root_id, f.is_secure_vault,
                   COALESCE(ss.is_accessible, 1) as is_accessible,
                   0 as shared_count,
                   0 as public_share_count
            FROM files f
            LEFT JOIN storage_sources ss ON f.storage_source_id = ss.id
            WHERE f.user_id = ? AND f.trashed = 1
            AND (f.parent_id IS NULL OR f.parent_id NOT IN (
                SELECT id FROM files WHERE trashed = 1 AND user_id = ?
            ))
            ORDER BY trashed_at DESC
        `).all(userId, userId).map(file => ({
            ...file,
            location: buildFileLocation(userId, file.parent_id),
        }));

        res.json({ files, retentionDays, purged });
    } catch (error) {
        console.error('List trash error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/files/recent
 * Get recently active files (MUST come before /:id routes)
 */
router.get('/recent', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;

        const files = db.prepare(`
            SELECT f.id, f.name, f.type, f.size, f.mime_type, f.parent_id, f.starred,
                   f.version_number,
                   f.created_at, f.modified_at, f.accessed_at, f.storage_source_id,
                   ss.label as storage_source_label,
                   ss.type as storage_source_type,
                   f.encrypted_metadata, f.storage_id, f.e2ee_iv, f.is_chunked,
                   f.chunk_count, f.vault_root_id, f.is_secure_vault,
                   COALESCE(ss.is_accessible, 1) as is_accessible,
                   ${RECENT_TIMESTAMP_SQL} as recent_at,
                   ${RECENT_ACTION_SQL} as recent_action,
                   (
                       SELECT COUNT(*)
                       FROM shares s
                       WHERE s.file_id = f.id
                         AND s.shared_by = ?
                         AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now'))
                   ) as shared_count,
                   (
                       SELECT COUNT(*)
                       FROM shares s
                       WHERE s.file_id = f.id
                         AND s.shared_by = ?
                         AND (COALESCE(s.share_type, CASE WHEN s.shared_with IS NULL THEN 'link' ELSE 'user' END) = 'link')
                         AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now'))
                   ) as public_share_count
            FROM files f
            LEFT JOIN storage_sources ss ON f.storage_source_id = ss.id
            WHERE f.user_id = ? AND f.trashed = 0 AND f.type != 'folder'
            ORDER BY datetime(recent_at) DESC, f.id DESC
            LIMIT 50
        `).all(userId, userId, userId).map(file => ({
            ...file,
            location: buildFileLocation(userId, file.parent_id),
        }));

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
        const type = String(req.query.type || 'all');
        const starredOnly = req.query.starred === 'true';
        const sharedOnly = req.query.shared === 'true';
        const minSize = req.query.min_size !== undefined ? Number(req.query.min_size) : null;
        const maxSize = req.query.max_size !== undefined ? Number(req.query.max_size) : null;
        const modifiedAfter = req.query.modified_after ? String(req.query.modified_after) : null;
        const modifiedBefore = req.query.modified_before ? String(req.query.modified_before) : null;
        const sort = ['name', 'modified', 'size', 'type'].includes(String(req.query.sort)) ? String(req.query.sort) : 'relevance';
        const direction = req.query.direction === 'asc' ? 'ASC' : 'DESC';

        if (!query || String(query).trim().length === 0) {
            return res.json({ files: [], query: '' });
        }

        const searchTerm = `%${String(query).trim()}%`;
        const conditions = ['f.user_id = ?', 'f.trashed = 0', 'f.name LIKE ?'];
        const params = [userId, searchTerm];

        if (type !== 'all') {
            conditions.push('f.type = ?');
            params.push(type);
        }

        if (starredOnly) {
            conditions.push('f.starred = 1');
        }

        if (sharedOnly) {
            conditions.push(`EXISTS (
                SELECT 1
                FROM shares s
                WHERE s.file_id = f.id
                  AND s.shared_by = ?
                  AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now'))
            )`);
            params.push(userId);
        }

        if (Number.isFinite(minSize) && minSize !== null) {
            conditions.push('f.size >= ?');
            params.push(minSize);
        }

        if (Number.isFinite(maxSize) && maxSize !== null) {
            conditions.push('f.size <= ?');
            params.push(maxSize);
        }

        if (modifiedAfter) {
            conditions.push('datetime(f.modified_at) >= datetime(?)');
            params.push(modifiedAfter);
        }

        if (modifiedBefore) {
            conditions.push('datetime(f.modified_at) <= datetime(?)');
            params.push(modifiedBefore);
        }

        const sortClauses = {
            relevance: "CASE WHEN f.type = 'folder' THEN 0 ELSE 1 END ASC, f.modified_at DESC",
            name: `f.name COLLATE NOCASE ${direction}`,
            modified: `datetime(f.modified_at) ${direction}`,
            size: `f.size ${direction}`,
            type: `f.type COLLATE NOCASE ${direction}, f.name COLLATE NOCASE ASC`,
        };

        const files = db.prepare(`
            SELECT f.id, f.name, f.type, f.size, f.mime_type, f.parent_id, f.starred,
                   f.version_number,
                   f.created_at, f.modified_at, f.storage_source_id,
                   ss.label as storage_source_label,
                   ss.type as storage_source_type,
                   f.encrypted_metadata, f.storage_id, f.e2ee_iv, f.is_chunked,
                   f.chunk_count, f.vault_root_id, f.is_secure_vault,
                   COALESCE(ss.is_accessible, 1) as is_accessible,
                   (
                       SELECT COUNT(*)
                       FROM shares s
                       WHERE s.file_id = f.id
                         AND s.shared_by = ?
                         AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now'))
                   ) as shared_count,
                   (
                       SELECT COUNT(*)
                       FROM shares s
                       WHERE s.file_id = f.id
                         AND s.shared_by = ?
                         AND (COALESCE(s.share_type, CASE WHEN s.shared_with IS NULL THEN 'link' ELSE 'user' END) = 'link')
                         AND (s.expires_at IS NULL OR datetime(s.expires_at) > datetime('now'))
                   ) as public_share_count
            FROM files f
            LEFT JOIN storage_sources ss ON f.storage_source_id = ss.id
            WHERE ${conditions.join(' AND ')}
            ORDER BY ${sortClauses[sort]}
            LIMIT 50
        `).all(userId, userId, ...params);

        const results = files.map(file => ({
            ...file,
            location: buildFileLocation(userId, file.parent_id),
        }));

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
                "SELECT id, is_secure_vault, vault_root_id FROM files WHERE id = ? AND user_id = ? AND type = 'folder'"
            ).get(parent_id, userId);
            if (!parentFolder) {
                return res.status(400).json({ error: 'Parent folder not found' });
            }
            if (parentFolder.is_secure_vault === 1 || parentFolder.vault_root_id !== null) {
                return res.status(400).json({ error: 'Use the secure vault folder flow for encrypted folders' });
            }
        }

        const result = db.prepare(`
            INSERT INTO files (user_id, name, path, type, parent_id)
            VALUES (?, ?, '', 'folder', ?)
        `).run(userId, name.trim(), parent_id || null);

        const folder = db.prepare('SELECT * FROM files WHERE id = ?').get(result.lastInsertRowid);
        logFileActivity(userId, 'folder.created', folder, `Created folder "${folder.name}"`);

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
 * POST /api/files/uploads/init
 * Start a regular chunked upload session.
 */
router.post('/uploads/init', uploadLimiter, requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const parentId = normalizeParentId(req.body.parent_id);
        const name = sanitizeArchiveSegment(req.body.name || 'upload');
        const size = Number(req.body.size);
        const mimeType = String(req.body.mime_type || 'application/octet-stream');
        const relativePath = normalizeUploadRelativePath(req.body.relative_path || name, name);
        const chunkCount = Number(req.body.chunk_count);

        if (!name.trim()) {
            return res.status(400).json({ error: 'File name is required' });
        }
        if (!Number.isFinite(size) || size < 0) {
            return res.status(400).json({ error: 'Invalid file size' });
        }
        if (!Number.isInteger(chunkCount) || chunkCount < 0 || (size > 0 && chunkCount < 1)) {
            return res.status(400).json({ error: 'Invalid chunk count' });
        }

        validateUploadParent(userId, parentId);
        ensureUploadQuotaAvailable(userId, size);

        const storageSourceId = getUserStorageId(userId);
        const uploadId = uuidv4();
        const tempPath = getRegularUploadTempPath(storageSourceId, userId, uploadId);
        ensureDir(tempPath);

        regularUploadSessions.set(uploadId, {
            id: uploadId,
            userId,
            parentId,
            storageSourceId,
            name,
            size,
            mimeType,
            relativePath,
            chunkCount,
            finalFilename: `${uuidv4()}${path.extname(name)}`,
            tempPath,
            createdAt: Date.now(),
        });

        return res.status(201).json({
            upload: {
                id: uploadId,
                chunk_count: chunkCount,
                chunk_size: MAX_REGULAR_CHUNK_UPLOAD_BYTES,
            },
        });
    } catch (error) {
        console.error('Init chunked upload error:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
    }
});

/**
 * PUT /api/files/uploads/:uploadId/chunks/:index
 * Store one regular file upload chunk.
 */
router.put(
    '/uploads/:uploadId/chunks/:index',
    requireAuth,
    express.raw({ type: 'application/octet-stream', limit: `${MAX_REGULAR_CHUNK_UPLOAD_BYTES}b` }),
    (req, res) => {
        try {
            const userId = req.user.userId;
            const uploadId = String(req.params.uploadId);
            const index = Number(req.params.index);
            const session = regularUploadSessions.get(uploadId);

            if (!session || session.userId !== userId) {
                return res.status(404).json({ error: 'Upload session not found' });
            }
            if (!Number.isInteger(index) || index < 0 || index >= session.chunkCount) {
                return res.status(400).json({ error: 'Chunk index is out of range' });
            }
            if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
                return res.status(400).json({ error: 'Chunk body is required' });
            }

            ensureDir(session.tempPath);
            fs.writeFileSync(getRegularUploadChunkPath(session.tempPath, index), req.body);
            return res.json({ message: 'Chunk stored' });
        } catch (error) {
            console.error('Store chunked upload chunk error:', error);
            res.status(500).json({ error: 'Server error' });
        }
    },
);

/**
 * POST /api/files/uploads/:uploadId/complete
 * Assemble chunks, process through versioning/encryption, and create DB record.
 */
router.post('/uploads/:uploadId/complete', requireAuth, async (req, res) => {
    const userId = req.user.userId;
    const uploadId = String(req.params.uploadId);
    const session = regularUploadSessions.get(uploadId);
    let finalPath = null;
    let assembledFile = null;

    try {
        if (!session || session.userId !== userId) {
            return res.status(404).json({ error: 'Upload session not found' });
        }

        for (let index = 0; index < session.chunkCount; index += 1) {
            if (!fs.existsSync(getRegularUploadChunkPath(session.tempPath, index))) {
                return res.status(400).json({ error: `Missing uploaded chunk ${index + 1}` });
            }
        }

        finalPath = path.join(getStorageBasePath(session.storageSourceId, userId), session.finalFilename);
        ensureDir(path.dirname(finalPath));

        const writeFd = fs.openSync(finalPath, 'w');
        try {
            for (let index = 0; index < session.chunkCount; index += 1) {
                const chunk = fs.readFileSync(getRegularUploadChunkPath(session.tempPath, index));
                fs.writeSync(writeFd, chunk);
            }
        } finally {
            fs.closeSync(writeFd);
        }

        const actualSize = fs.statSync(finalPath).size;
        if (actualSize !== session.size) {
            throw new Error(`Upload size mismatch for ${session.name}`);
        }

        assembledFile = {
            originalname: session.name,
            filename: session.finalFilename,
            path: finalPath,
            mimetype: session.mimeType,
            size: actualSize,
            relativePath: session.relativePath,
        };

        const uploadedFiles = await queueUploadedFiles({
            userId,
            parentId: session.parentId,
            files: [assembledFile],
            storageSourceId: session.storageSourceId,
            isAdmin: req.user.is_admin === 1,
        });

        removePathRecursive(session.tempPath);
        regularUploadSessions.delete(uploadId);

        return res.status(201).json({
            message: 'File uploaded successfully',
            file: uploadedFiles[0],
        });
    } catch (error) {
        console.error('Complete chunked upload error:', error);
        if (assembledFile && !assembledFile._cloudpiCommitted && finalPath && fs.existsSync(finalPath)) {
            try { fs.unlinkSync(finalPath); } catch (_) { /* ignore */ }
        }
        res.status(error.statusCode || 500).json({ error: error.message || 'Server error' });
    }
});

/**
 * DELETE /api/files/uploads/:uploadId
 * Abort a regular chunked upload session.
 */
router.delete('/uploads/:uploadId', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const uploadId = String(req.params.uploadId);
        const session = regularUploadSessions.get(uploadId);

        if (!session || session.userId !== userId) {
            return res.status(404).json({ error: 'Upload session not found' });
        }

        removePathRecursive(session.tempPath);
        regularUploadSessions.delete(uploadId);
        return res.json({ message: 'Upload session aborted' });
    } catch (error) {
        console.error('Abort chunked upload error:', error);
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

        const relativePaths = normalizeRelativePathList(req.body.relative_paths, req.files);
        req.files.forEach((file, index) => {
            file.relativePath = relativePaths[index];
        });

        // --- Storage Quota Check ---
        const userRow = db.prepare('SELECT storage_quota FROM users WHERE id = ?').get(userId);
        const quota = userRow?.storage_quota; // NULL = unlimited
        if (quota && quota > 0) {
            const currentUsed = getTotalUsedBytesForUser(db, userId);
            const uploadSize = req.files.reduce((sum, f) => sum + f.size, 0);

            if (currentUsed + uploadSize > quota) {
                evaluateStorageQuotaNotification(userId, {
                    usedBytes: currentUsed + uploadSize,
                    quotaBytes: quota,
                    forceBucket: 'quota_reached',
                });
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
                "SELECT id, is_secure_vault, vault_root_id FROM files WHERE id = ? AND user_id = ? AND type = 'folder'"
            ).get(parentId, userId);
            if (!parentFolder) {
                return res.status(400).json({ error: 'Parent folder not found' });
            }
            if (parentFolder.is_secure_vault === 1 || parentFolder.vault_root_id !== null) {
                return res.status(400).json({ error: 'Encrypted vault uploads must use the secure vault uploader' });
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
                if (!file._cloudpiCommitted && file.path && fs.existsSync(file.path)) {
                    try {
                        fs.unlinkSync(file.path);
                        console.log('Cleaned up:', file.filename);
                    } catch (cleanupErr) {
                        console.error('Failed to delete:', file.filename);
                    }
                }
            });
        }

        res.status(error.statusCode || 500).json({ error: error.message || 'Server error during upload' });
    }
});

/**
 * POST /api/files/bulk-download
 * Streams selected files and folders as one ZIP archive.
 */
router.post('/bulk-download', requireAuth, async (req, res) => {
    try {
        const userId = req.user.userId;
        const fileIds = Array.isArray(req.body.fileIds)
            ? [...new Set(req.body.fileIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
            : [];

        if (fileIds.length === 0) {
            return res.status(400).json({ error: 'No files selected' });
        }

        if (fileIds.length > 100) {
            return res.status(400).json({ error: 'Select 100 items or fewer for one ZIP download' });
        }

        const placeholders = fileIds.map(() => '?').join(',');
        const selectedItems = db.prepare(`
            SELECT *
            FROM files
            WHERE user_id = ?
              AND trashed = 0
              AND id IN (${placeholders})
            ORDER BY CASE WHEN type = 'folder' THEN 0 ELSE 1 END, name ASC
        `).all(userId, ...fileIds);

        if (selectedItems.length === 0) {
            return res.status(404).json({ error: 'Selected files were not found' });
        }

        if (selectedItems.some(isVaultItem)) {
            return res.status(400).json({ error: 'Encrypted vault items cannot be included in server-side ZIP downloads yet' });
        }

        const selectedFolderIds = new Set(selectedItems.filter((item) => item.type === 'folder').map((item) => item.id));
        const topLevelItems = selectedItems.filter((item) => {
            let parentId = item.parent_id;
            while (parentId) {
                if (selectedFolderIds.has(parentId)) return false;
                const parent = db.prepare('SELECT id, parent_id FROM files WHERE id = ? AND user_id = ?').get(parentId, userId);
                if (!parent) break;
                parentId = parent.parent_id;
            }
            return true;
        });

        const uniqueArchivePath = uniqueArchivePathFactory();
        const archiveEntries = [];
        const missing = [];

        function collectItem(item, archivePath) {
            if (item.type === 'folder') {
                const folderPath = uniqueArchivePath(archivePath);
                archiveEntries.push({ type: 'directory', archivePath: `${folderPath}/` });

                const children = db.prepare(`
                    SELECT *
                    FROM files
                    WHERE parent_id = ?
                      AND user_id = ?
                      AND trashed = 0
                    ORDER BY CASE WHEN type = 'folder' THEN 0 ELSE 1 END, name ASC
                `).all(item.id, userId);

                for (const child of children) {
                    collectItem(child, `${folderPath}/${child.name}`);
                }
                return;
            }

            const diskPath = resolveFilePath(item);
            if (!fs.existsSync(diskPath)) {
                missing.push(item.name);
                return;
            }

            archiveEntries.push({
                type: 'file',
                diskPath,
                archivePath: uniqueArchivePath(archivePath),
                encrypted: item.encrypted === 1,
            });
        }

        for (const item of topLevelItems) {
            collectItem(item, item.name);
        }

        if (archiveEntries.length === 0) {
            return res.status(400).json({ error: 'No downloadable files were found in the selection' });
        }

        const zipName = topLevelItems.length === 1
            ? `${sanitizeArchiveSegment(topLevelItems[0].name)}.zip`
            : `cloudpi-selection-${new Date().toISOString().slice(0, 10)}.zip`;

        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(zipName)}"`);
        if (missing.length > 0) {
            res.set('X-Skipped-Files', encodeURIComponent(missing.slice(0, 10).join(', ')));
        }

        const archive = archiver('zip', { zlib: { level: 5 } });
        archive.on('error', (err) => {
            console.error('Bulk ZIP error:', err);
            if (!res.headersSent) res.status(500).json({ error: 'ZIP creation failed' });
        });
        archive.pipe(res);

        for (const entry of archiveEntries) {
            if (entry.type === 'directory') {
                archive.append('', { name: entry.archivePath });
                continue;
            }

            if (entry.encrypted) {
                try {
                    const { stream: decStream } = createDecryptStream(entry.diskPath);
                    archive.append(decStream, { name: entry.archivePath });
                } catch (decErr) {
                    console.error(`Skipping encrypted file in bulk ZIP (decrypt failed): ${entry.archivePath}`, decErr.message);
                }
            } else {
                archive.file(entry.diskPath, { name: entry.archivePath });
            }
        }

        archive.finalize();
    } catch (error) {
        console.error('Bulk download error:', error);
        if (!res.headersSent) res.status(500).json({ error: error.message || 'Server error during bulk download' });
    }
});

// ============================================
// DYNAMIC ROUTES (with :id parameter)
// ============================================

/**
 * GET /api/files/:id/versions
 * List version history for a regular file.
 */
router.get('/:id/versions', requireAuth, (req, res) => {
    try {
        const fileId = Number(req.params.id);
        const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ? AND trashed = 0')
            .get(fileId, req.user.userId);
        if (!file) {
            return res.status(404).json({ error: 'Versioned file not found' });
        }
        if (!assertFileStorageAvailable(file, res, 'view version history for')) return;

        const history = listFileVersions(db, req.user.userId, fileId);
        if (!history) {
            return res.status(404).json({ error: 'Versioned file not found' });
        }
        res.json(history);
    } catch (error) {
        console.error('List versions error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/files/:id/versions/:versionId/restore
 * Promote an old version back to the live file.
 */
router.post('/:id/versions/:versionId/restore', requireAuth, (req, res) => {
    try {
        const fileId = Number(req.params.id);
        const versionId = Number(req.params.versionId);
        const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ? AND trashed = 0')
            .get(fileId, req.user.userId);
        if (!file) {
            return res.status(404).json({ error: 'Version not found' });
        }
        if (!assertFileStorageAvailable(file, res, 'restore a version of')) return;

        const updated = restoreFileVersion(db, req.user.userId, fileId, versionId);
        if (!updated) {
            return res.status(404).json({ error: 'Version not found' });
        }
        pruneVersionsForFile(updated.id);
        res.json({ message: 'Version restored successfully', file: updated });
    } catch (error) {
        console.error('Restore version error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /api/files/:id/versions/:versionId
 * Delete one old version and its physical blob.
 */
router.delete('/:id/versions/:versionId', requireAuth, (req, res) => {
    try {
        const fileId = Number(req.params.id);
        const versionId = Number(req.params.versionId);
        const file = db.prepare('SELECT * FROM files WHERE id = ? AND user_id = ? AND trashed = 0')
            .get(fileId, req.user.userId);
        if (!file) {
            return res.status(404).json({ error: 'Version not found' });
        }
        if (!assertFileStorageAvailable(file, res, 'delete a version of')) return;

        const deleted = deleteFileVersion(db, req.user.userId, fileId, versionId, deleteStoredVersionBlob);
        if (!deleted) {
            return res.status(404).json({ error: 'Version not found' });
        }
        res.json({ message: 'Version deleted successfully' });
    } catch (error) {
        console.error('Delete version error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/files/:id/thumbnail
 * Returns thumbnail for image/video files.
 * - Images: generated via sharp when available, otherwise falls back to original preview.
 * - Videos: generated via ffmpeg (first frame around 1s) and cached on disk.
 */
router.get('/:id/thumbnail', async (req, res) => {
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
        const size = Math.min(512, Math.max(64, Number(req.query.size) || 256));

        // Validate token_version
        const dbUser = db.prepare('SELECT token_version, is_disabled FROM users WHERE id = ?').get(userId);
        if (!dbUser) return res.status(401).json({ error: 'User not found' });
        if (dbUser.is_disabled) return res.status(403).json({ error: 'Account is disabled' });
        if (decoded.tokenVersion === undefined || decoded.tokenVersion !== (dbUser.token_version || 1)) {
            return res.status(401).json({ error: 'Token expired or invalidated' });
        }

        const file = db.prepare(
            "SELECT * FROM files WHERE id = ? AND user_id = ? AND type != 'folder'"
        ).get(fileId, userId);

        if (!file) return res.status(404).json({ error: 'File not found' });

        // Encrypted files cannot have thumbnails generated without decrypting first
        // (too expensive on Pi and creates temporary plaintext on disk)
        if (file.encrypted === 1) {
            return res.status(400).json({ error: 'Thumbnails are unavailable for encrypted files' });
        }

        // Check if the file's storage source is ACTUALLY mounted
        if (file.storage_source_id && file.storage_source_id !== 'internal') {
            const source = db.prepare('SELECT is_accessible, label, path FROM storage_sources WHERE id = ?')
                .get(file.storage_source_id);
            const { isDriveActuallyPresent } = require('./events');
            if (source && (!source.is_accessible || !isDriveActuallyPresent(source.path, file.storage_source_id))) {
                if (source.is_accessible) {
                    db.prepare('UPDATE storage_sources SET is_accessible = 0 WHERE id = ?').run(file.storage_source_id);
                }
                return res.status(503).json({
                    error: `Storage drive "${source.label}" is disconnected.`,
                    drive_disconnected: true
                });
            }
        }

        const filePath = resolveFilePath(file);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        const thumbDir = ensureThumbnailDirForUser(userId);
        const sourceStat = fs.statSync(filePath);

        if (file.type === 'image') {
            // Fallback to original preview if sharp is unavailable
            if (!sharp) {
                res.set('Cache-Control', 'public, max-age=86400');
                res.set('X-Thumbnail-Fallback', 'original');
                res.set('Content-Type', file.mime_type || 'application/octet-stream');
                return sendFileSafely(res, filePath);
            }

            const thumbPath = path.join(thumbDir, `${file.id}-${size}.webp`);
            const shouldGenerate = !fs.existsSync(thumbPath) || fs.statSync(thumbPath).mtimeMs < sourceStat.mtimeMs;
            if (shouldGenerate) {
                await sharp(filePath)
                    .rotate()
                    .resize(size, size, { fit: 'cover', withoutEnlargement: true })
                    .webp({ quality: 82 })
                    .toFile(thumbPath);
            }

            res.set('Cache-Control', 'public, max-age=86400');
            res.set('Content-Type', 'image/webp');
            return sendFileSafely(res, thumbPath, 'Thumbnail not found');
        }

        if (file.type === 'video') {
            if (!ffmpegPath) {
                return res.status(503).json({
                    error: 'Video thumbnails are unavailable (ffmpeg not installed)'
                });
            }

            const thumbPath = path.join(thumbDir, `${file.id}-${size}.jpg`);
            const shouldGenerate = !fs.existsSync(thumbPath) || fs.statSync(thumbPath).mtimeMs < sourceStat.mtimeMs;
            if (shouldGenerate) {
                try {
                    await runFfmpeg([
                        '-y',
                        '-ss',
                        '00:00:01',
                        '-i',
                        filePath,
                        '-frames:v',
                        '1',
                        '-vf',
                        `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
                        '-q:v',
                        '4',
                        thumbPath
                    ]);
                } catch {
                    // Very short clips may not have a frame at 1 second; retry from the start.
                    await runFfmpeg([
                        '-y',
                        '-ss',
                        '00:00:00',
                        '-i',
                        filePath,
                        '-frames:v',
                        '1',
                        '-vf',
                        `scale=${size}:${size}:force_original_aspect_ratio=decrease`,
                        '-q:v',
                        '4',
                        thumbPath
                    ]);
                }
            }

            res.set('Cache-Control', 'public, max-age=86400');
            res.set('Content-Type', 'image/jpeg');
            return sendFileSafely(res, thumbPath, 'Thumbnail not found');
        }

        return res.status(400).json({ error: 'Thumbnails are only available for images and videos' });
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token' });
        }
        console.error('Thumbnail error:', error);
        return res.status(500).json({ error: 'Server error during thumbnail generation' });
    }
});

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
        
        if (decoded.tokenVersion === undefined || decoded.tokenVersion !== (dbUser.token_version || 1)) {
            return res.status(401).json({ error: 'Token expired or invalidated' });
        }

        const file = db.prepare(
            "SELECT * FROM files WHERE id = ? AND user_id = ? AND type != 'folder'"
        ).get(fileId, userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (isVaultItem(file)) {
            return res.status(400).json({ error: 'Thumbnails are unavailable for encrypted vault files' });
        }

        // Check if the file's storage source is ACTUALLY mounted (not just DB flag)
        if (file.storage_source_id && file.storage_source_id !== 'internal') {
            const source = db.prepare('SELECT is_accessible, label, path FROM storage_sources WHERE id = ?')
                .get(file.storage_source_id);
            const { isDriveActuallyPresent } = require('./events');
            if (source && (!source.is_accessible || !isDriveActuallyPresent(source.path, file.storage_source_id))) {
                // Update DB if stale
                if (source.is_accessible) {
                    db.prepare('UPDATE storage_sources SET is_accessible = 0 WHERE id = ?').run(file.storage_source_id);
                }
                return res.status(503).json({
                    error: `Storage drive "${source.label}" is disconnected. This file is temporarily unavailable.`,
                    drive_disconnected: true
                });
            }
        }

        const filePath = resolveFilePath(file);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        db.prepare('UPDATE files SET accessed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
            .run(file.id, userId);

        res.set('Content-Type', getPreviewContentType(file));
        res.set('Content-Disposition', `inline; filename="${encodeURIComponent(file.name)}"`);
        res.set('Cache-Control', 'public, max-age=86400');

        // Decrypt and stream if file is encrypted, otherwise serve directly
        if (file.encrypted === 1) {
            try {
                await decryptToStream(filePath, res);
            } catch (decErr) {
                if (decErr.message.includes('FILE_INTEGRITY_FAILED')) {
                    db.prepare('UPDATE files SET integrity_failed = 1 WHERE id = ?').run(file.id);
                    if (!res.headersSent) return res.status(500).json({ error: 'File integrity check failed — the file may be corrupted' });
                } else {
                    console.error('Decryption error during preview:', decErr.message);
                    if (!res.headersSent) return res.status(503).json({ error: 'Failed to decrypt file — storage may be unavailable' });
                }
            }
        } else {
            sendFileSafely(res, filePath);
        }
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: error.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token' });
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

        if (isVaultItem(file)) {
            return res.status(400).json({ error: 'Preview is unavailable for encrypted vault files' });
        }

        // Check if the file's storage source is ACTUALLY mounted (not just DB flag)
        if (file.storage_source_id && file.storage_source_id !== 'internal') {
            const source = db.prepare('SELECT is_accessible, label, path FROM storage_sources WHERE id = ?')
                .get(file.storage_source_id);
            const { isDriveActuallyPresent } = require('./events');
            if (source && (!source.is_accessible || !isDriveActuallyPresent(source.path, file.storage_source_id))) {
                if (source.is_accessible) {
                    db.prepare('UPDATE storage_sources SET is_accessible = 0 WHERE id = ?').run(file.storage_source_id);
                }
                return res.status(503).json({
                    error: `Storage drive "${source.label}" is disconnected. This file is temporarily unavailable.`,
                    drive_disconnected: true
                });
            }
        }

        // --- Regular file download ---
        if (file.type !== 'folder') {
            const filePath = resolveFilePath(file);
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ error: 'File not found on disk' });
            }

            // Verify SHA-256 integrity if hash is recorded
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

            // Decrypt and stream if encrypted, otherwise serve raw file
            if (file.encrypted === 1) {
                res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
                res.set('Content-Type', file.mime_type || 'application/octet-stream');
                try {
                    await decryptToStream(filePath, res);
                } catch (decErr) {
                    if (decErr.message.includes('FILE_INTEGRITY_FAILED')) {
                        db.prepare('UPDATE files SET integrity_failed = 1 WHERE id = ?').run(file.id);
                        if (!res.headersSent) return res.status(500).json({ error: 'File integrity check failed — the file may be corrupted or tampered with' });
                    } else {
                        console.error('Decryption error during download:', decErr.message);
                        if (!res.headersSent) return res.status(503).json({ error: 'Failed to decrypt file — storage may be unavailable' });
                    }
                }
                return;
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

        const archive = archiver('zip', { zlib: { level: 5 } });
        archive.on('error', (err) => {
            console.error('ZIP error:', err);
            if (!res.headersSent) res.status(500).json({ error: 'ZIP creation failed' });
        });
        archive.pipe(res);

        // Add files to archive — decrypt encrypted files before adding
        for (const { diskPath, archivePath, encrypted } of filesToZip) {
            if (encrypted) {
                // Decrypt and pipe into archive as a stream
                try {
                    const { stream: decStream } = createDecryptStream(diskPath);
                    archive.append(decStream, { name: archivePath });
                } catch (decErr) {
                    console.error(`Skipping encrypted file in ZIP (decrypt failed): ${archivePath}`, decErr.message);
                }
            } else {
                archive.file(diskPath, { name: archivePath });
            }
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

        if (isVaultItem(file)) {
            if (file.type === 'folder') {
                return res.status(400).json({ error: 'Vault folders cannot be exported as ZIP archives from the server' });
            }
            return res.status(400).json({ error: 'Encrypted vault files must be downloaded through the vault client' });
        }

        if (!assertFileStorageAvailable(file, res, 'rename')) return;

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
        logFileActivity(
            userId,
            file.type === 'folder' ? 'folder.renamed' : 'file.renamed',
            updated,
            `Renamed "${file.name}" to "${updated.name}"`,
            buildFileLocation(userId, updated.parent_id),
            { previousName: file.name }
        );

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

        if (!assertFileStorageAvailable(file, res, 'star')) return;

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
        const destinationParentId = normalizeParentId(req.body.parent_id); // null for root

        const file = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ? AND trashed = 0'
        ).get(Number(fileId), userId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        if (!assertFileStorageAvailable(file, res, 'move')) return;

        if (destinationParentId && Number(destinationParentId) === Number(file.id)) {
            return res.status(400).json({ error: 'Cannot move an item into itself' });
        }

        if (destinationParentId !== null && destinationParentId === file.parent_id) {
            return res.json({ message: 'Item is already in this folder' });
        }

        // Validate destination folder
        if (destinationParentId) {
            const destFolder = db.prepare(
                "SELECT id, storage_source_id, is_secure_vault, vault_root_id FROM files WHERE id = ? AND user_id = ? AND type = 'folder' AND trashed = 0"
            ).get(destinationParentId, userId);
            if (!destFolder) {
                return res.status(400).json({ error: 'Destination folder not found' });
            }
            if (destFolder.is_secure_vault === 1 || destFolder.vault_root_id !== null) {
                return res.status(400).json({ error: 'Use the secure vault flow to manage encrypted vault contents' });
            }
            if (!assertFileStorageAvailable(destFolder, res, 'move items into')) return;

            // Prevent moving folder into itself or its children
            if (file.type === 'folder' && isFolderDescendant(userId, file.id, destinationParentId)) {
                return res.status(400).json({ error: 'Cannot move a folder into itself or one of its subfolders' });
            }
        }

        const finalName = getUniqueSiblingName(userId, destinationParentId, file.name, file.id);

        db.prepare('UPDATE files SET parent_id = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(destinationParentId, file.id);

        if (finalName !== file.name) {
            db.prepare('UPDATE files SET name = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(finalName, file.id);
        }

        const moved = db.prepare('SELECT * FROM files WHERE id = ?').get(file.id);
        logFileActivity(
            userId,
            file.type === 'folder' ? 'folder.moved' : 'file.moved',
            moved,
            `Moved "${moved.name}"`,
            buildFileLocation(userId, moved.parent_id),
            { previousParentId: file.parent_id }
        );

        res.json({
            message: finalName === file.name
                ? 'Moved successfully'
                : `Moved and renamed to "${finalName}" to avoid a name conflict`
        });
    } catch (error) {
        console.error('Move error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/files/:id/copy
 * Copy file/folder to a destination folder (or root when parent_id is null)
 */
router.post('/:id/copy', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const sourceId = Number(req.params.id);
        const destinationParentId = normalizeParentId(req.body.parent_id);

        const source = db.prepare(
            'SELECT * FROM files WHERE id = ? AND user_id = ? AND trashed = 0'
        ).get(sourceId, userId);

        if (!source) {
            return res.status(404).json({ error: 'Source file not found' });
        }

        if (isVaultItem(source)) {
            return res.status(400).json({ error: 'Copying encrypted vault items is not supported yet' });
        }

        if (!assertFileStorageAvailable(source, res, 'copy')) return;

        if (destinationParentId && Number(destinationParentId) === Number(source.id)) {
            return res.status(400).json({ error: 'Cannot copy an item into itself' });
        }

        if (destinationParentId) {
            const destFolder = db.prepare(
                "SELECT id, storage_source_id, is_secure_vault, vault_root_id FROM files WHERE id = ? AND user_id = ? AND type = 'folder' AND trashed = 0"
            ).get(destinationParentId, userId);
            if (!destFolder) {
                return res.status(400).json({ error: 'Destination folder not found' });
            }
            if (destFolder.is_secure_vault === 1 || destFolder.vault_root_id !== null) {
                return res.status(400).json({ error: 'Use the secure vault flow to manage encrypted vault contents' });
            }
            if (!assertFileStorageAvailable(destFolder, res, 'copy items into')) return;

            if (source.type === 'folder' && isFolderDescendant(userId, source.id, destinationParentId)) {
                return res.status(400).json({ error: 'Cannot copy a folder into itself or one of its subfolders' });
            }
        }

        const copyRecursive = (item, targetParentId) => {
            const safeName = getUniqueSiblingName(userId, targetParentId, item.name);

            if (item.type === 'folder') {
                const insertedFolder = db.prepare(`
                    INSERT INTO files (user_id, name, path, type, size, mime_type, parent_id, storage_source_id)
                    VALUES (?, ?, '', 'folder', 0, NULL, ?, ?)
                `).run(userId, safeName, targetParentId, item.storage_source_id || 'internal');
                const newFolderId = insertedFolder.lastInsertRowid;

                const children = db.prepare(
                    'SELECT * FROM files WHERE user_id = ? AND parent_id = ? AND trashed = 0 ORDER BY id ASC'
                ).all(userId, item.id);
                for (const child of children) {
                    copyRecursive(child, newFolderId);
                }

                return db.prepare('SELECT * FROM files WHERE id = ?').get(newFolderId);
            }

            const sourcePath = resolveFilePath(item);
            if (!fs.existsSync(sourcePath)) {
                throw new Error(`Source file is missing on disk: ${item.name}`);
            }

            const ext = path.extname(item.path || item.name || '');
            const newDiskName = `${uuidv4()}${ext}`;
            const storageId = item.storage_source_id || 'internal';
            const destinationBase = getStorageBasePath(storageId, userId);
            if (!fs.existsSync(destinationBase)) {
                fs.mkdirSync(destinationBase, { recursive: true });
            }
            const destinationPath = path.join(destinationBase, newDiskName);
            fs.copyFileSync(sourcePath, destinationPath);

            const insertedFile = db.prepare(`
                INSERT INTO files (user_id, name, path, type, size, mime_type, parent_id, storage_source_id, sha256_hash, encrypted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                userId,
                safeName,
                newDiskName,
                item.type,
                item.size || 0,
                item.mime_type,
                targetParentId,
                storageId,
                item.sha256_hash || null,
                item.encrypted || 0
            );

            return db.prepare('SELECT * FROM files WHERE id = ?').get(insertedFile.lastInsertRowid);
        };

        const copiedItem = copyRecursive(source, destinationParentId);
        evaluateStorageQuotaNotification(userId);
        logFileActivity(
            userId,
            source.type === 'folder' ? 'folder.copied' : 'file.copied',
            copiedItem,
            `Copied "${source.name}"`,
            buildFileLocation(userId, copiedItem.parent_id),
            { sourceId: source.id }
        );

        res.status(201).json({
            message: source.type === 'folder' ? 'Folder copied successfully' : 'File copied successfully',
            file: copiedItem
        });
    } catch (error) {
        console.error('Copy error:', error);
        res.status(500).json({ error: error.message || 'Server error' });
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

        if (!assertFileStorageAvailable(file, res, 'restore')) return;

        const restoredName = getUniqueSiblingName(userId, file.parent_id, file.name, file.id);

        // Restore file
        db.prepare(`
            UPDATE files SET trashed = 0, trashed_at = NULL, name = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(restoredName, fileId);

        // Also restore children if it's a folder
        if (file.type === 'folder') {
            const restoreChildren = (parentId) => {
                const children = db.prepare('SELECT id, type, name, parent_id FROM files WHERE parent_id = ?').all(parentId);
                for (const child of children) {
                    const childName = getUniqueSiblingName(userId, child.parent_id, child.name, child.id);
                    db.prepare('UPDATE files SET trashed = 0, trashed_at = NULL, name = ?, modified_at = CURRENT_TIMESTAMP WHERE id = ?')
                        .run(childName, child.id);
                    if (child.type === 'folder') {
                        restoreChildren(child.id);
                    }
                }
            };
            restoreChildren(fileId);
        }

        evaluateStorageQuotaNotification(userId);
        const restored = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId);
        logFileActivity(
            userId,
            file.type === 'folder' ? 'folder.restored' : 'file.restored',
            restored,
            `Restored "${restoredName}" from Trash`,
            buildFileLocation(userId, restored?.parent_id)
        );
        res.json({
            message: restoredName === file.name
                ? 'Restored successfully'
                : `Restored and renamed to "${restoredName}" to avoid a name conflict`
        });
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

        if (!assertFileStorageAvailable(file, res, 'delete')) return;

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

        evaluateStorageQuotaNotification(userId);
        logFileActivity(
            userId,
            file.type === 'folder' ? 'folder.trashed' : 'file.trashed',
            file,
            `Moved "${file.name}" to Trash`,
            file.type === 'folder' ? 'Folder is in Trash' : 'File is in Trash',
            { previousParentId: file.parent_id }
        );
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

        if (!assertFileStorageAvailable(file, res, 'permanently delete')) return;

        // Delete physical file if it's not a folder
        if (file.type !== 'folder') {
            deleteAllVersionsForFile(db, file.id, deleteStoredVersionBlob);
            if (file.path) deleteStoredItem(file);
        }

        // If folder, delete all children first
        if (file.type === 'folder') {
            const deleteChildren = (parentId) => {
                const children = db.prepare('SELECT id, user_id, type, path, storage_source_id, vault_root_id, is_secure_vault FROM files WHERE parent_id = ?').all(parentId);
                for (const child of children) {
                    if (child.type === 'folder') {
                        deleteChildren(child.id);
                    } else {
                        deleteAllVersionsForFile(db, child.id, deleteStoredVersionBlob);
                        if (child.path) {
                            deleteStoredItem({ ...child, user_id: userId, storage_source_id: child.storage_source_id });
                        }
                    }
                    db.prepare('DELETE FROM files WHERE id = ?').run(child.id);
                }
            };
            deleteChildren(fileId);
        }

        // Delete the file/folder record
        db.prepare('DELETE FROM files WHERE id = ?').run(fileId);

        evaluateStorageQuotaNotification(userId);
        logFileActivity(
            userId,
            file.type === 'folder' ? 'folder.deleted' : 'file.deleted',
            file,
            `Permanently deleted "${file.name}"`,
            'Deleted permanently from Trash'
        );
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
        ensureProtectedInternalStorageAvailable();
        const sources = db.prepare('SELECT id, path, type, total_bytes FROM storage_sources WHERE is_active = 1').all();
        
        let totalSystemBytes = 0;
        let freeSystemBytes = 0;
        let versionBytes = 0;

        for (const source of sources) {
            versionBytes += getVersionBytesForStorageSource(db, source.id);
            let is_accessible = false;
            try {
                if (source.type === 'external') {
                    const { isDriveActuallyPresent } = require('./events');
                    is_accessible = isDriveActuallyPresent(source.path, source.id);
                } else {
                    is_accessible = fs.existsSync(source.path);
                }
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
                    const liveUsed = db.prepare('SELECT COALESCE(SUM(size), 0) as used FROM files WHERE storage_source_id = ? AND type != \'folder\'').get(source.id).used;
                    const dbUsed = (liveUsed || 0) + getVersionBytesForStorageSource(db, source.id);
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
        evaluateStorageQuotaNotification(req.user.userId);
        
        res.json({
            totalBytes: totalSystemBytes,
            usedBytes: usedSystemBytes > 0 ? usedSystemBytes : 0,
            versionBytes,
        });

    } catch (error) {
        console.error('Storage stats error:', error);
        if (error.code === 'LUKS_STORAGE_UNAVAILABLE') {
            return res.status(503).json({ error: error.message });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /api/files/trash/empty
 * Permanently deletes all trashed records for the current user.
 */
router.delete('/trash/empty', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;

        const trashedItems = db.prepare(`
            SELECT id, user_id, path, type, size, storage_source_id, vault_root_id, is_secure_vault
            FROM files
            WHERE user_id = ? AND trashed = 1
            ORDER BY CASE WHEN type = 'folder' THEN 0 ELSE 1 END, id ASC
        `).all(userId);

        if (trashedItems.length === 0) {
            return res.json({
                message: 'Trash is already empty',
                deletedItems: 0,
                deletedFiles: 0,
                freedBytes: 0,
            });
        }

        let deletedFiles = 0;
        let freedBytes = 0;

        for (const item of trashedItems) {
            const versionBytes = item.type !== 'folder'
                ? db.prepare('SELECT COALESCE(SUM(size), 0) as bytes FROM file_versions WHERE file_id = ?').get(item.id).bytes || 0
                : 0;
            if (item.type !== 'folder') {
                deleteAllVersionsForFile(db, item.id, deleteStoredVersionBlob);
                if (item.path) deleteStoredItem(item);
            }
            if (item.type !== 'folder') {
                deletedFiles += 1;
                freedBytes += (Number(item.size) || 0) + versionBytes;
            }
        }

        db.prepare('DELETE FROM files WHERE user_id = ? AND trashed = 1').run(userId);
        evaluateStorageQuotaNotification(userId);
        createActivityEvent({
            userId,
            actorId: userId,
            type: 'trash.emptied',
            title: 'Emptied Trash',
            body: `${trashedItems.length} item${trashedItems.length === 1 ? '' : 's'} permanently deleted`,
            link: '/trash',
            metadata: {
                deletedItems: trashedItems.length,
                deletedFiles,
                freedBytes,
            },
        });

        res.json({
            message: 'Trash emptied successfully',
            deletedItems: trashedItems.length,
            deletedFiles,
            freedBytes,
        });
    } catch (error) {
        console.error('Empty trash error:', error);
        res.status(500).json({ error: 'Failed to empty trash' });
    }
});

module.exports = router;
