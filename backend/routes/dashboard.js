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

const router = express.Router();
const JWT_SECRET = 'cloudpi-secret-key-change-this-in-production';

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

/**
 * GET /api/dashboard/stats
 * Returns file statistics for the logged-in user
 */
router.get('/stats', requireAuth, (req, res) => {
    try {
        const userId = req.user.userId;

        // Total files and storage
        const totalStats = db.prepare(`
            SELECT COUNT(*) as totalFiles, COALESCE(SUM(size), 0) as totalStorage
            FROM files WHERE user_id = ? AND type != 'folder' AND trashed = 0
        `).get(userId);

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

        // Recent files (last 5)
        const recentFiles = db.prepare(`
            SELECT id, name, type, size, mime_type, created_at, modified_at as updated_at
            FROM files WHERE user_id = ? AND type != 'folder' AND trashed = 0
            ORDER BY created_at DESC LIMIT 5
        `).all(userId);

        // Shared stats
        const sharedByMe = db.prepare(`
            SELECT COUNT(*) as count FROM shares WHERE shared_by = ?
        `).get(userId);
        const sharedWithMe = db.prepare(`
            SELECT COUNT(*) as count FROM shares WHERE shared_with = ?
        `).get(userId);

        res.json({
            totalFiles: totalStats.totalFiles,
            totalStorage: totalStats.totalStorage,
            totalFolders: folderStats.totalFolders,
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
