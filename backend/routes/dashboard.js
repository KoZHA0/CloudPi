/**
 * DASHBOARD ROUTES
 * ================
 * Provides dashboard stats and system health monitoring
 *
 * ENDPOINTS:
 * GET /api/dashboard/stats   - File stats (counts, storage, recent files)
 * GET /api/dashboard/health  - System health (CPU, RAM, disk)
 */

const express = require('express');
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { JWT_SECRET } = require('../utils/auth-config');
const { getVersionBytesForUser } = require('../utils/file-versioning');
const { evaluateStorageQuotaNotification } = require('../utils/notifications');
const { listActivityEvents } = require('../utils/activity');

const router = express.Router();

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

function dashboardLimit(value, fallback = 8, max = 25) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, max);
}

function filesLink(parentId, fileId) {
    const params = new URLSearchParams();
    if (parentId) params.set('folder', String(parentId));
    params.set('highlight', String(fileId));
    return `/files?${params.toString()}`;
}

function activityItem({ id, type, title, body, link, createdAt, metadata = null }) {
    return {
        id: `${type}:${id}`,
        type,
        title,
        body,
        link,
        created_at: createdAt,
        metadata,
    };
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
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/dashboard/stats
 * Returns file statistics for the logged-in user
 */
router.get('/stats', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;

        // User storage quota
        const user = db.prepare('SELECT storage_quota FROM users WHERE id = ?').get(userId);

        // Total files and storage
        const totalStats = db.prepare(`
            SELECT COUNT(*) as totalFiles, COALESCE(SUM(size), 0) as liveStorage
            FROM files WHERE user_id = ? AND type != 'folder' AND trashed = 0
        `).get(userId);
        const versionStorage = getVersionBytesForUser(db, userId);
        const totalStorage = (totalStats.liveStorage || 0) + versionStorage;

        // Trash stats (files taking up space in the bin)
        const trashStats = db.prepare(`
            SELECT COUNT(*) as trashFiles, COALESCE(SUM(size), 0) as trashStorage
            FROM files WHERE user_id = ? AND type != 'folder' AND trashed = 1
        `).get(userId);
        const trashedVersionStorage = db.prepare(`
            SELECT COALESCE(SUM(v.size), 0) as bytes
            FROM file_versions v
            JOIN files f ON f.id = v.file_id
            WHERE f.user_id = ? AND f.type != 'folder' AND f.trashed = 1
        `).get(userId).bytes || 0;

        // Total folders
        const folderStats = db.prepare(`
            SELECT COUNT(*) as totalFolders
            FROM files WHERE user_id = ? AND type = 'folder' AND trashed = 0
        `).get(userId);

        // File counts by type
        const typeCounts = db.prepare(`
            SELECT type, COUNT(*) as count, COALESCE(SUM(size), 0) as totalSize
            FROM files WHERE user_id = ? AND type != 'folder' AND trashed = 0
            GROUP BY type
        `).all(userId);

        const byType = {};
        typeCounts.forEach(t => {
            byType[t.type] = { count: t.count, size: t.totalSize };
        });
        const versionTypeSizes = db.prepare(`
            SELECT f.type, COALESCE(SUM(v.size), 0) as totalSize
            FROM file_versions v
            JOIN files f ON f.id = v.file_id
            WHERE f.user_id = ? AND f.type != 'folder' AND f.trashed = 0
            GROUP BY f.type
        `).all(userId);
        versionTypeSizes.forEach(t => {
            if (!byType[t.type]) byType[t.type] = { count: 0, size: 0 };
            byType[t.type].size += t.totalSize || 0;
        });

        // Recent files (last 5): uploaded, modified, or previewed.
        const recentFiles = db.prepare(`
            SELECT
                f.id, f.name, f.type, f.size, f.mime_type, f.parent_id,
                f.created_at, f.modified_at, f.accessed_at,
                f.storage_source_id, f.vault_root_id, f.is_secure_vault,
                COALESCE(ss.is_accessible, 1) as is_accessible,
                ${RECENT_TIMESTAMP_SQL} as recent_at,
                ${RECENT_ACTION_SQL} as recent_action
            FROM files f
            LEFT JOIN storage_sources ss ON f.storage_source_id = ss.id
            WHERE f.user_id = ? AND f.type != 'folder' AND f.trashed = 0
            ORDER BY datetime(recent_at) DESC, f.id DESC
            LIMIT 5
        `).all(userId).map(file => ({
            ...file,
            location: buildFileLocation(userId, file.parent_id),
        }));

        // Shared stats
        const sharedByMe = db.prepare(`
            SELECT COUNT(*) as count
            FROM shares
            WHERE shared_by = ?
              AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
        `).get(userId);
        const sharedWithMe = db.prepare(`
            SELECT COUNT(*) as count
            FROM shares
            WHERE shared_with = ?
              AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
        `).get(userId);

        evaluateStorageQuotaNotification(userId, {
            usedBytes: totalStorage,
            quotaBytes: user.storage_quota,
        });

        res.json({
            totalFiles: totalStats.totalFiles,
            totalStorage,
            versionStorage,
            totalFolders: folderStats.totalFolders,
            storageQuota: user.storage_quota,
            trashFiles: trashStats.trashFiles,
            trashStorage: (trashStats.trashStorage || 0) + trashedVersionStorage,
            byType,
            recentFiles,
            sharedByMe: sharedByMe.count,
            sharedWithMe: sharedWithMe.count,
        });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * GET /api/dashboard/activity
 * Lightweight dashboard activity feed from files, shares, and revoke notices.
 */
router.get('/activity', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;
        const limit = dashboardLimit(req.query.limit);
        const loggedActivity = listActivityEvents(userId, { limit });
        if (loggedActivity.length > 0) {
            return res.json({ activity: loggedActivity });
        }

        const sampleLimit = Math.max(limit * 2, 12);

        const uploaded = db.prepare(`
            SELECT id, name, type, parent_id, created_at
            FROM files
            WHERE user_id = ? AND created_at IS NOT NULL
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ?
        `).all(userId, sampleLimit).map(file => activityItem({
            id: file.id,
            type: file.type === 'folder' ? 'folder.created' : 'file.uploaded',
            title: file.type === 'folder' ? `Created folder "${file.name}"` : `Uploaded "${file.name}"`,
            body: buildFileLocation(userId, file.parent_id),
            link: filesLink(file.parent_id, file.id),
            createdAt: file.created_at,
            metadata: { fileId: file.id, fileType: file.type },
        }));

        const updated = db.prepare(`
            SELECT id, name, type, parent_id, modified_at
            FROM files
            WHERE user_id = ?
              AND trashed = 0
              AND modified_at IS NOT NULL
              AND created_at IS NOT NULL
              AND datetime(modified_at) > datetime(created_at, '+1 second')
            ORDER BY datetime(modified_at) DESC, id DESC
            LIMIT ?
        `).all(userId, sampleLimit).map(file => activityItem({
            id: file.id,
            type: file.type === 'folder' ? 'folder.updated' : 'file.updated',
            title: file.type === 'folder' ? `Updated folder "${file.name}"` : `Updated "${file.name}"`,
            body: buildFileLocation(userId, file.parent_id),
            link: filesLink(file.parent_id, file.id),
            createdAt: file.modified_at,
            metadata: { fileId: file.id, fileType: file.type },
        }));

        const trashed = db.prepare(`
            SELECT id, name, type, parent_id, trashed_at
            FROM files
            WHERE user_id = ? AND trashed = 1 AND trashed_at IS NOT NULL
            ORDER BY datetime(trashed_at) DESC, id DESC
            LIMIT ?
        `).all(userId, sampleLimit).map(file => activityItem({
            id: file.id,
            type: 'file.trashed',
            title: `Moved "${file.name}" to Trash`,
            body: file.type === 'folder' ? 'Folder is in Trash' : 'File is in Trash',
            link: '/trash',
            createdAt: file.trashed_at,
            metadata: { fileId: file.id, fileType: file.type },
        }));

        const sharesSent = db.prepare(`
            SELECT s.id, s.created_at, f.name as file_name, f.type as file_type, u.username as recipient_name
            FROM shares s
            JOIN files f ON s.file_id = f.id
            LEFT JOIN users u ON s.shared_with = u.id
            WHERE s.shared_by = ?
              AND COALESCE(s.share_type, CASE WHEN s.shared_with IS NULL THEN 'link' ELSE 'user' END) = 'user'
            ORDER BY datetime(s.created_at) DESC, s.id DESC
            LIMIT ?
        `).all(userId, sampleLimit).map(share => activityItem({
            id: share.id,
            type: 'share.sent',
            title: `Shared "${share.file_name}"`,
            body: share.recipient_name ? `Shared with ${share.recipient_name}` : 'Shared with another user',
            link: '/shares/outgoing',
            createdAt: share.created_at,
            metadata: { shareId: share.id, fileType: share.file_type },
        }));

        const sharesReceived = db.prepare(`
            SELECT s.id, s.created_at, f.name as file_name, f.type as file_type, u.username as owner_name
            FROM shares s
            JOIN files f ON s.file_id = f.id
            LEFT JOIN users u ON s.shared_by = u.id
            WHERE s.shared_with = ?
              AND COALESCE(s.share_type, 'user') = 'user'
            ORDER BY datetime(s.created_at) DESC, s.id DESC
            LIMIT ?
        `).all(userId, sampleLimit).map(share => activityItem({
            id: share.id,
            type: 'share.received',
            title: `${share.owner_name || 'Someone'} shared "${share.file_name}"`,
            body: 'Available in Shared with Me',
            link: '/shares/incoming',
            createdAt: share.created_at,
            metadata: { shareId: share.id, fileType: share.file_type },
        }));

        const revokedShares = db.prepare(`
            SELECT id, type, title, body, link, created_at, metadata_json
            FROM notifications
            WHERE user_id = ? AND type = 'share.revoked'
            ORDER BY datetime(created_at) DESC, id DESC
            LIMIT ?
        `).all(userId, sampleLimit).map(notification => {
            let metadata = null;
            try {
                metadata = notification.metadata_json ? JSON.parse(notification.metadata_json) : null;
            } catch {
                metadata = null;
            }

            return activityItem({
                id: notification.id,
                type: notification.type,
                title: notification.title,
                body: notification.body,
                link: notification.link || '/shares/incoming',
                createdAt: notification.created_at,
                metadata,
            });
        });

        const activity = [
            ...uploaded,
            ...updated,
            ...trashed,
            ...sharesSent,
            ...sharesReceived,
            ...revokedShares,
        ]
            .filter(item => item.created_at)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, limit);

        res.json({ activity });
    } catch (error) {
        console.error('Dashboard activity error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Store previous CPU info for calculating usage
let prevCpuInfo = null;

function getCpuUsage() {
    const cpus = os.cpus();
    let totalIdle = 0, totalTick = 0;

    cpus.forEach(cpu => {
        for (const type in cpu.times) {
            totalTick += cpu.times[type];
        }
        totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;

    if (prevCpuInfo) {
        const idleDiff = idle - prevCpuInfo.idle;
        const totalDiff = total - prevCpuInfo.total;
        const usage = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
        prevCpuInfo = { idle, total };
        return Math.max(0, Math.min(100, usage));
    }

    prevCpuInfo = { idle, total };
    return 0; // First call, no baseline
}

function getDiskUsage() {
    try {
        if (process.platform === 'win32') {
            // Windows: use wmic
            const output = execSync('wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv', {
                encoding: 'utf8',
                timeout: 5000
            });
            const lines = output.trim().split('\n').filter(l => l.trim());
            const lastLine = lines[lines.length - 1];
            const parts = lastLine.split(',');
            const freeSpace = parseInt(parts[1]);
            const totalSize = parseInt(parts[2]);
            return {
                total: totalSize,
                free: freeSpace,
                used: totalSize - freeSpace,
                percentage: Math.round(((totalSize - freeSpace) / totalSize) * 100)
            };
        } else {
            // Linux/Mac: use df
            const output = execSync("df -B1 / | tail -1", {
                encoding: 'utf8',
                timeout: 5000
            });
            const parts = output.trim().split(/\s+/);
            const total = parseInt(parts[1]);
            const used = parseInt(parts[2]);
            const free = parseInt(parts[3]);
            return {
                total, used, free,
                percentage: Math.round((used / total) * 100)
            };
        }
    } catch (error) {
        console.error('Disk usage error:', error.message);
        return { total: 0, used: 0, free: 0, percentage: 0 };
    }
}

function getCpuTemperature() {
    try {
        if (process.platform === 'linux') {
            // Raspberry Pi / Linux: read thermal zone
            const temp = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
            return Math.round(parseInt(temp.trim()) / 1000);
        }
        // Windows/Mac: no reliable built-in way to get temp
        return null;
    } catch {
        return null;
    }
}

function getNetworkInfo() {
    const nets = os.networkInterfaces();
    const results = [];

    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (net.family === 'IPv4' && !net.internal) {
                results.push(net.address);
            }
        }
    }

    // Prioritize 192.168.x.x, then 10.x.x.x, then 172.x.x.x
    const preferred = results.find(ip => ip.startsWith('192.168.'));
    if (preferred) return preferred;
    
    const ten = results.find(ip => ip.startsWith('10.'));
    if (ten) return ten;

    const oneSevenTwo = results.find(ip => {
        const parts = ip.split('.');
        const second = parseInt(parts[1]);
        return ip.startsWith('172.') && second >= 16 && second <= 31;
    });
    if (oneSevenTwo) return oneSevenTwo;

    return results.length > 0 ? results[0] : '127.0.0.1';
}

/**
 * GET /api/dashboard/health
 * Returns system health metrics
 */
router.get('/health', requireAuth, (req, res) => {
    try {
        // CPU
        const cpuUsage = getCpuUsage();
        const cpuModel = os.cpus()[0]?.model || 'Unknown';
        const cpuCores = os.cpus().length;

        // RAM
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memPercentage = Math.round((usedMem / totalMem) * 100);

        // Disk
        const disk = getDiskUsage();

        // Uptime
        const uptimeSeconds = os.uptime();

        res.json({
            cpu: {
                usage: cpuUsage,
                model: cpuModel,
                cores: cpuCores,
                temperature: getCpuTemperature(),
            },
            ram: {
                total: totalMem,
                used: usedMem,
                free: freeMem,
                percentage: memPercentage,
            },
            disk: {
                total: disk.total,
                used: disk.used,
                free: disk.free,
                percentage: disk.percentage,
            },
            uptime: uptimeSeconds,
            platform: os.platform(),
            hostname: os.hostname(),
            ip: getNetworkInfo(),
        });
    } catch (error) {
        console.error('System health error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
