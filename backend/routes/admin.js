/**
 * ADMIN ROUTES
 * ============
 * Handles admin-only operations like user management and storage
 * 
 * ENDPOINTS:
 * GET    /api/admin/users              - List all users
 * POST   /api/admin/users              - Create new user
 * DELETE /api/admin/users/:id          - Delete user
 * PUT    /api/admin/users/:id/password - Reset user password (admin only)
 * GET    /api/admin/settings           - Get all settings
 * PUT    /api/admin/settings           - Update settings
 * GET    /api/admin/storage            - List storage sources
 * POST   /api/admin/storage            - Register external drive
 * PUT    /api/admin/storage/:id        - Update storage source
 * DELETE /api/admin/storage/:id        - Remove storage source
 * GET    /api/admin/drives             - Scan for removable USB drives
 * POST   /api/admin/drives/mount       - Mount a drive (udisksctl)
 * POST   /api/admin/drives/unmount     - Safely unmount/eject a drive
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');

const router = express.Router();

const JWT_SECRET = 'cloudpi-secret-key-change-this-in-production';
const SALT_ROUNDS = 10;

/**
 * ADMIN MIDDLEWARE
 * Verifies the user is logged in and is an admin
 */
function requireAdmin(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        // Get user from database to check admin status
        const user = db.prepare(
            'SELECT id, is_admin FROM users WHERE id = ?'
        ).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        if (!user.is_admin) {
            return res.status(403).json({ error: 'Admin access required' });
        }

        req.user = { ...decoded, isAdmin: user.is_admin };
        next();

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Admin auth error:', error);
        res.status(500).json({ error: 'Server error' });
    }
}

/**
 * GET /api/admin/users
 * Returns list of all users (admin only)
 */
router.get('/users', requireAdmin, (req, res) => {
    try {
        const users = db.prepare(
            'SELECT id, username, is_admin, default_storage_id, created_at FROM users ORDER BY created_at DESC'
        ).all();

        res.json({ users });
    } catch (error) {
        console.error('List users error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/admin/users
 * Creates a new user (admin only)
 */
router.post('/users', requireAdmin, async (req, res) => {
    try {
        const { username, password, isAdmin = false } = req.body;

        // Validate required fields
        if (!username || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['username', 'password']
            });
        }

        // Check if user already exists
        const existingUser = db.prepare(
            'SELECT id FROM users WHERE username = ?'
        ).get(username);

        if (existingUser) {
            return res.status(400).json({
                error: 'User with this username already exists'
            });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // Insert new user
        const result = db.prepare(
            'INSERT INTO users (username, password, is_admin) VALUES (?, ?, ?)'
        ).run(username, hashedPassword, isAdmin ? 1 : 0);

        res.status(201).json({
            message: 'User created successfully',
            user: {
                id: result.lastInsertRowid,
                username,
                is_admin: isAdmin ? 1 : 0
            }
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Server error during user creation' });
    }
});

/**
 * PUT /api/admin/users/:id/password
 * Resets a user's password (Super Admin only)
 * 
 * PERMISSION RULES:
 * - Only Super Admin (id=1) can reset passwords
 * - Cannot reset your own password (use /api/auth/password instead)
 */
router.put('/users/:id/password', requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const currentUserId = req.user.userId;
        const { newPassword } = req.body;

        // Only Super Admin can reset passwords
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can reset passwords' });
        }

        if (!newPassword) {
            return res.status(400).json({ error: 'New password is required' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Prevent resetting your own password via admin route
        if (userId === currentUserId) {
            return res.status(400).json({ error: 'Use the profile page to change your own password' });
        }

        // Check if target user exists
        const targetUser = db.prepare(
            'SELECT id, username, is_admin FROM users WHERE id = ?'
        ).get(userId);

        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // Update password and invalidate old tokens
        const newTokenVersion = (targetUser.token_version || 1) + 1;
        db.prepare(
            'UPDATE users SET password = ?, token_version = ? WHERE id = ?'
        ).run(hashedPassword, newTokenVersion, userId);

        res.json({ message: `Password reset successfully for ${targetUser.username}` });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Server error during password reset' });
    }
});

/**
 * PUT /api/admin/users/:id/storage
 * Assigns a default storage source to a user (Admin only)
 */
router.put('/users/:id/storage', requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { default_storage_id } = req.body;

        // Check if user exists
        const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if storage exists (if provided and not 'internal')
        if (default_storage_id && default_storage_id !== 'internal') {
            const source = db.prepare('SELECT id FROM storage_sources WHERE id = ?').get(default_storage_id);
            if (!source) {
                return res.status(400).json({ error: 'Storage source not found' });
            }
        }

        // Update user
        db.prepare('UPDATE users SET default_storage_id = ? WHERE id = ?')
            .run(default_storage_id || 'internal', userId);

        res.json({ message: 'Storage assigned successfully' });
    } catch (error) {
        console.error('Update user storage error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /api/admin/users/:id
 * Deletes a user (admin only)
 * 
 * PERMISSION RULES:
 * - Cannot delete yourself
 * - Cannot delete the Super Admin (user id = 1, the first user)
 * - Only the Super Admin can delete other admins
 * - Regular admins can only delete non-admin users
 */
router.delete('/users/:id', requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const currentUserId = req.user.userId;

        // Prevent deleting yourself
        if (userId === currentUserId) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }

        // Check if target user exists and get their admin status
        const targetUser = db.prepare(
            'SELECT id, username, is_admin FROM users WHERE id = ?'
        ).get(userId);

        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Prevent deleting the Super Admin (first user, id = 1)
        if (userId === 1) {
            return res.status(403).json({ error: 'Cannot delete the Super Admin' });
        }

        // Only the Super Admin (id = 1) can delete other admins
        if (targetUser.is_admin && currentUserId !== 1) {
            return res.status(403).json({ 
                error: 'Only the Super Admin can delete other admins' 
            });
        }

        // Delete user
        db.prepare('DELETE FROM users WHERE id = ?').run(userId);

        res.json({ message: 'User deleted successfully' });

    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ error: 'Server error during user deletion' });
    }
});

/**
 * GET /api/admin/settings
 * Returns all configurable settings (admin only)
 */
router.get('/settings', requireAdmin, (req, res) => {
    try {
        const rows = db.prepare('SELECT key, value, description FROM settings').all();

        // Convert array of {key, value, description} to a structured object
        const settings = {};
        for (const row of rows) {
            settings[row.key] = {
                value: row.value,
                description: row.description,
            };
        }

        res.json({ settings });
    } catch (error) {
        console.error('Get settings error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/admin/settings
 * Updates settings (Super Admin only)
 * 
 * Body: { settings: { key: value, key: value, ... } }
 */
router.put('/settings', requireAdmin, (req, res) => {
    try {
        const currentUserId = req.user.userId;

        // Only Super Admin can change settings
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can change settings' });
        }

        const { settings } = req.body;

        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ error: 'Settings object is required' });
        }

        // Allowed setting keys (whitelist to prevent injection)
        const allowedKeys = [
            'rate_limit_api_max', 'rate_limit_api_window',
            'rate_limit_auth_max', 'rate_limit_auth_window',
            'rate_limit_upload_max', 'rate_limit_upload_window',
        ];

        const updateStmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
        const updated = [];

        for (const [key, value] of Object.entries(settings)) {
            if (!allowedKeys.includes(key)) {
                return res.status(400).json({ error: `Unknown setting: ${key}` });
            }

            // Validate numeric values
            const numValue = parseInt(value, 10);
            if (isNaN(numValue) || numValue < 1 || numValue > 1000) {
                return res.status(400).json({ 
                    error: `Invalid value for ${key}: must be a number between 1 and 1000` 
                });
            }

            updateStmt.run(String(numValue), key);
            updated.push(key);
        }

        console.log(`⚙️ Settings updated by Super Admin: ${updated.join(', ')}`);

        res.json({ message: 'Settings updated successfully', updated });

    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// STORAGE SOURCE MANAGEMENT (Super Admin only)
// ============================================

/**
 * GET /api/admin/storage
 * List all storage sources with usage stats
 */
router.get('/storage', requireAdmin, (req, res) => {
    try {
        const sources = db.prepare(`
            SELECT s.*,
                   COALESCE(SUM(f.size), 0) as used_bytes,
                   COUNT(f.id) as file_count
            FROM storage_sources s
            LEFT JOIN files f ON f.storage_source_id = s.id AND f.type != 'folder'
            GROUP BY s.id
            ORDER BY s.type ASC, s.created_at ASC
        `).all();

        // Check if external drives are still accessible
        const enriched = sources.map(source => {
            let is_accessible = false;
            try {
                is_accessible = fs.existsSync(source.path);
            } catch (e) {
                is_accessible = false;
            }

            // Get total disk space if accessible
            let total_bytes = source.total_bytes;
            let free_bytes = 0;
            if (is_accessible && source.type !== 'internal') {
                try {
                    const stats = fs.statfsSync(source.path);
                    total_bytes = stats.bsize * stats.blocks;
                    free_bytes = stats.bsize * stats.bavail;
                } catch (e) {
                    // statfsSync may not be available on all platforms
                }
            }

            return {
                ...source,
                is_accessible,
                total_bytes,
                free_bytes
            };
        });

        res.json({ sources: enriched });
    } catch (error) {
        console.error('List storage error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/admin/storage
 * Register a new external storage source
 * Body: { path: "/mnt/usb1", label: "My USB Drive" }
 */
router.post('/storage', requireAdmin, (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can manage storage' });
        }

        const { path: drivePath, label } = req.body;

        if (!drivePath || !label) {
            return res.status(400).json({ error: 'Path and label are required' });
        }

        // Check path exists
        if (!fs.existsSync(drivePath)) {
            return res.status(400).json({ error: `Path not found: ${drivePath}` });
        }

        // Check if this drive was previously registered (has .cloudpi-id)
        const idFilePath = path.join(drivePath, '.cloudpi-id');
        let driveId;

        if (fs.existsSync(idFilePath)) {
            // Re-registering an existing drive
            try {
                const content = fs.readFileSync(idFilePath, 'utf8');
                const match = content.match(/drive_id=(.+)/);
                if (match) {
                    driveId = match[1].trim();
                    // Check if this source exists in DB
                    const existing = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(driveId);
                    if (existing) {
                        // Re-activate it
                        db.prepare('UPDATE storage_sources SET is_active = 1, path = ?, label = ? WHERE id = ?')
                            .run(drivePath, label, driveId);
                        console.log(`💾 Re-activated storage: ${label} (${driveId})`);
                        const source = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(driveId);
                        return res.json({ message: 'Storage source re-activated!', source });
                    }
                }
            } catch (e) {
                // Couldn't read the file, treat as new
            }
        }

        // New drive — generate ID and write .cloudpi-id
        driveId = driveId || uuidv4();

        // Write the .cloudpi-id file
        const idContent = `drive_id=${driveId}\nregistered=${new Date().toISOString()}\nlabel=${label}\n`;
        try {
            fs.writeFileSync(idFilePath, idContent);
        } catch (e) {
            return res.status(400).json({ error: `Cannot write to drive: ${e.message}` });
        }

        // Create cloudpi-data directory on the drive
        const dataDir = path.join(drivePath, 'cloudpi-data');
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Get drive capacity
        let totalBytes = 0;
        try {
            const stats = fs.statfsSync(drivePath);
            totalBytes = stats.bsize * stats.blocks;
        } catch (e) {
            // statfsSync not available on all platforms
        }

        // Insert into DB
        db.prepare(`
            INSERT INTO storage_sources (id, label, path, type, is_active, total_bytes)
            VALUES (?, ?, ?, 'external', 1, ?)
        `).run(driveId, label, drivePath, totalBytes);

        console.log(`💾 Registered storage: ${label} at ${drivePath} (${driveId})`);

        const source = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(driveId);
        res.status(201).json({ message: 'Storage source registered!', source });

    } catch (error) {
        console.error('Add storage error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/admin/storage/:id
 * Update a storage source (label, active status)
 * Body: { label?: "New Name", is_active?: 0 }
 */
router.put('/storage/:id', requireAdmin, (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can manage storage' });
        }

        const sourceId = req.params.id;
        const source = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(sourceId);

        if (!source) {
            return res.status(404).json({ error: 'Storage source not found' });
        }

        // Cannot deactivate internal storage
        if (source.type === 'internal' && req.body.is_active === 0) {
            return res.status(400).json({ error: 'Cannot deactivate internal storage' });
        }

        const { label, is_active } = req.body;
        if (label !== undefined) {
            db.prepare('UPDATE storage_sources SET label = ? WHERE id = ?').run(label, sourceId);
        }
        if (is_active !== undefined) {
            db.prepare('UPDATE storage_sources SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, sourceId);
        }

        const updated = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(sourceId);
        res.json({ message: 'Storage source updated', source: updated });

    } catch (error) {
        console.error('Update storage error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * DELETE /api/admin/storage/:id
 * Remove a storage source (only if no files are stored on it)
 */
router.delete('/storage/:id', requireAdmin, (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can manage storage' });
        }

        const sourceId = req.params.id;
        const source = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(sourceId);

        if (!source) {
            return res.status(404).json({ error: 'Storage source not found' });
        }

        if (source.type === 'internal') {
            return res.status(400).json({ error: 'Cannot remove internal storage' });
        }

        // Check if files exist on this source
        const fileCount = db.prepare(
            'SELECT COUNT(*) as count FROM files WHERE storage_source_id = ?'
        ).get(sourceId);

        if (fileCount.count > 0) {
            return res.status(400).json({
                error: `Cannot remove: ${fileCount.count} file(s) are stored on this drive. Move or delete them first.`
            });
        }

        db.prepare('DELETE FROM storage_sources WHERE id = ?').run(sourceId);
        console.log(`💾 Removed storage: ${source.label} (${sourceId})`);

        res.json({ message: 'Storage source removed' });

    } catch (error) {
        console.error('Delete storage error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DRIVE DETECTION & MANAGEMENT (Super Admin only)
// ================================================

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const isLinux = process.platform === 'linux';

/**
 * GET /api/admin/drives
 * Scans the system for removable drives using lsblk.
 * Returns detected drives with mount status, UUID, model, label, and filesystem.
 * Cross-references with storage_sources to show registered status.
 * Also detects "dirty unplug" — registered drives that are no longer present.
 */
router.get('/drives', requireAdmin, async (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can manage drives' });
        }

        if (!isLinux) {
            return res.json({
                drives: [],
                registeredSources: [],
                platform: process.platform,
                message: 'Drive detection is only available on Linux (Raspberry Pi)'
            });
        }

        // Get block devices with full info including UUID
        const { stdout } = await execAsync(
            'lsblk -J -o NAME,SIZE,FSTYPE,MOUNTPOINT,RM,TYPE,LABEL,MODEL,UUID,HOTPLUG',
            { timeout: 10000 } // 10s timeout for slow VPN connections
        );

        const lsblkData = JSON.parse(stdout);
        const drives = [];

        // Get all registered storage sources from DB
        const registeredSources = db.prepare(
            'SELECT id, label, path, type, is_active FROM storage_sources WHERE type = \'external\''
        ).all();

        // Parse lsblk output — find removable devices (RM=1 or HOTPLUG=1)
        for (const device of lsblkData.blockdevices || []) {
            // Only look at disks that are removable
            if (device.type === 'disk' && (device.rm === true || device.rm === '1' || device.hotplug === true || device.hotplug === '1')) {
                // Get partitions (children)
                const partitions = device.children || [];

                if (partitions.length === 0) {
                    // Unpartitioned drive
                    drives.push({
                        device: `/dev/${device.name}`,
                        name: device.name,
                        size: device.size,
                        fstype: device.fstype || null,
                        mountpoint: device.mountpoint || null,
                        label: device.label || null,
                        model: device.model || 'Unknown Device',
                        uuid: device.uuid || null,
                        isMounted: !!device.mountpoint,
                        isRegistered: false,
                        registeredId: null,
                        fsWarning: null,
                    });
                } else {
                    for (const part of partitions) {
                        // Check if this partition is registered in our DB (by UUID or mountpoint)
                        let isRegistered = false;
                        let registeredId = null;

                        for (const src of registeredSources) {
                            // Check if the mountpoint matches the registered path
                            if (part.mountpoint && src.path === part.mountpoint) {
                                isRegistered = true;
                                registeredId = src.id;
                                break;
                            }
                            // Also check by reading .cloudpi-id from the mountpoint
                            if (part.mountpoint) {
                                try {
                                    const idFile = path.join(part.mountpoint, '.cloudpi-id');
                                    if (fs.existsSync(idFile)) {
                                        const content = fs.readFileSync(idFile, 'utf8');
                                        const match = content.match(/drive_id=(.+)/);
                                        if (match && match[1].trim() === src.id) {
                                            isRegistered = true;
                                            registeredId = src.id;
                                            break;
                                        }
                                    }
                                } catch (e) { /* ignore */ }
                            }
                        }

                        // NTFS warning
                        let fsWarning = null;
                        if (part.fstype === 'ntfs' || part.fstype === 'ntfs3') {
                            fsWarning = 'NTFS may have lower performance on Linux. ext4 is recommended.';
                        } else if (part.fstype === 'exfat') {
                            fsWarning = 'exFAT works but lacks Linux permission support.';
                        }

                        drives.push({
                            device: `/dev/${part.name}`,
                            name: part.name,
                            size: part.size || device.size,
                            fstype: part.fstype || null,
                            mountpoint: part.mountpoint || null,
                            label: part.label || null,
                            model: device.model || 'Unknown Device',
                            uuid: part.uuid || null,
                            isMounted: !!part.mountpoint,
                            isRegistered,
                            registeredId,
                            fsWarning,
                        });
                    }
                }
            }
        }

        // Dirty unplug detection: check registered sources that aren't in the detected drives
        const enrichedSources = registeredSources.map(src => {
            const isPresent = drives.some(d => d.registeredId === src.id);
            const isAccessible = src.path ? fs.existsSync(src.path) : false;
            return {
                ...src,
                status: isAccessible ? 'online' : (isPresent ? 'detected' : 'offline'),
            };
        });

        res.json({
            drives,
            registeredSources: enrichedSources,
            platform: process.platform,
        });

    } catch (error) {
        console.error('Drive scan error:', error);
        res.status(500).json({ error: `Failed to scan drives: ${error.message}` });
    }
});

/**
 * POST /api/admin/drives/mount
 * Mounts a drive using udisksctl (non-root, async).
 * Body: { device: "/dev/sda1" }
 * Optionally auto-registers the drive in storage_sources.
 */
router.post('/drives/mount', requireAdmin, async (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can mount drives' });
        }

        if (!isLinux) {
            return res.status(400).json({ error: 'Drive mounting is only available on Linux' });
        }

        const { device } = req.body;
        if (!device || !device.startsWith('/dev/')) {
            return res.status(400).json({ error: 'Invalid device path' });
        }

        // Safety: only allow mounting removable devices (sd*, mmcblk partitions)
        const deviceName = path.basename(device);
        if (!deviceName.match(/^(sd[a-z]\d*|mmcblk\d+p\d+)$/)) {
            return res.status(400).json({ error: 'Only removable storage devices can be mounted' });
        }

        console.log(`💾 Mounting ${device}...`);

        // Use udisksctl for non-root mounting
        const { stdout } = await execAsync(`udisksctl mount -b ${device}`, { timeout: 30000 });

        // Parse the mountpoint from udisksctl output
        // Output format: "Mounted /dev/sda1 at /media/root/DRIVE_LABEL."
        const mountMatch = stdout.match(/at (.+?)\.?\s*$/);
        const mountpoint = mountMatch ? mountMatch[1].trim() : null;

        if (!mountpoint) {
            return res.status(500).json({ error: 'Drive mounted but could not determine mount point', raw: stdout });
        }

        console.log(`💾 Mounted ${device} at ${mountpoint}`);

        // Get drive info for the response
        let driveInfo = {};
        try {
            const { stdout: lsblkOut } = await execAsync(
                `lsblk -J -o NAME,SIZE,FSTYPE,LABEL,UUID -n ${device}`,
                { timeout: 5000 }
            );
            const parsed = JSON.parse(lsblkOut);
            if (parsed.blockdevices && parsed.blockdevices[0]) {
                driveInfo = parsed.blockdevices[0];
            }
        } catch (e) { /* not critical */ }

        // Automatically reactivate if it was previously registered
        let reactivated = false;
        try {
            // Check by .cloudpi-id file
            const idFile = path.join(mountpoint, '.cloudpi-id');
            if (fs.existsSync(idFile)) {
                const content = fs.readFileSync(idFile, 'utf8');
                const match = content.match(/drive_id=(.+)/);
                if (match) {
                    const driveId = match[1].trim();
                    db.prepare('UPDATE storage_sources SET is_active = 1, path = ? WHERE id = ?').run(mountpoint, driveId);
                    console.log(`💾 Auto-reactivated registered drive: ${driveId} at ${mountpoint}`);
                    reactivated = true;
                }
            }

            // Fallback: check by matching the mountpoint path
            if (!reactivated) {
                const existing = db.prepare('SELECT id FROM storage_sources WHERE path = ?').get(mountpoint);
                if (existing) {
                    db.prepare('UPDATE storage_sources SET is_active = 1 WHERE id = ?').run(existing.id);
                    console.log(`💾 Auto-reactivated registered drive by path: ${existing.id}`);
                }
            }
        } catch (e) {
            console.error('Failed to auto-reactivate drive:', e.message);
        }

        res.json({
            message: `Drive mounted successfully at ${mountpoint}`,
            mountpoint,
            device,
            label: driveInfo.label || null,
            uuid: driveInfo.uuid || null,
            fstype: driveInfo.fstype || null,
        });

    } catch (error) {
        console.error('Mount error:', error);
        // Parse udisksctl error messages
        const errMsg = error.stderr || error.message;
        if (errMsg.includes('already mounted')) {
            return res.status(400).json({ error: 'Drive is already mounted' });
        }
        if (errMsg.includes('not authorized') || errMsg.includes('Not authorized')) {
            return res.status(403).json({
                error: 'Permission denied. Run: sudo usermod -aG disk $USER && sudo reboot'
            });
        }
        res.status(500).json({ error: `Failed to mount: ${errMsg}` });
    }
});

/**
 * POST /api/admin/drives/unmount
 * Safely unmounts a drive using udisksctl.
 * Body: { device: "/dev/sda1" }
 * Marks the storage source as inactive if registered.
 */
router.post('/drives/unmount', requireAdmin, async (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can unmount drives' });
        }

        if (!isLinux) {
            return res.status(400).json({ error: 'Drive unmounting is only available on Linux' });
        }

        const { device } = req.body;
        if (!device || !device.startsWith('/dev/')) {
            return res.status(400).json({ error: 'Invalid device path' });
        }

        console.log(`💾 Unmounting ${device}...`);

        // Use udisksctl for safe unmount
        await execAsync(`udisksctl unmount -b ${device}`, { timeout: 30000 });

        console.log(`💾 Unmounted ${device} safely`);

        // Check if this drive was registered and mark it inactive
        // Find by looking at storage sources whose paths are now inaccessible
        const sources = db.prepare(
            'SELECT id, path FROM storage_sources WHERE type = \'external\' AND is_active = 1'
        ).all();

        for (const src of sources) {
            if (!fs.existsSync(src.path)) {
                db.prepare('UPDATE storage_sources SET is_active = 0 WHERE id = ?').run(src.id);
                console.log(`💾 Marked storage ${src.id} as inactive (unmounted)`);
            }
        }

        res.json({ message: `Drive ${device} unmounted safely. You can remove it now.` });

    } catch (error) {
        console.error('Unmount error:', error);
        const errMsg = error.stderr || error.message;
        if (errMsg.includes('not mounted')) {
            return res.status(400).json({ error: 'Drive is not currently mounted' });
        }
        if (errMsg.includes('target is busy')) {
            return res.status(400).json({
                error: 'Drive is busy. Close any open files from this drive and try again.'
            });
        }
        res.status(500).json({ error: `Failed to unmount: ${errMsg}` });
    }
});

module.exports = router;

