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
 * POST   /api/admin/storage/:id/reactivate - Reactivate a returning drive (explicit admin action)
 * GET    /api/admin/drives             - Detect auto-mounted USB drives
 *
 * ARCHITECTURE NOTE:
 * Drive management follows the Nextcloud pattern (Separation of Concerns).
 * The host OS handles USB mounting automatically (via udisks2/usbmount).
 * This backend only reads the filesystem to detect what's already mounted.
 * No shell commands (lsblk, mount, umount) are executed — no root needed.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('../database/db');
const { JWT_SECRET, SALT_ROUNDS } = require('../utils/auth-config');
const { sendEmail } = require('../utils/mailer');
const { isInternalStorageAccessible, syncInternalStorageState } = require('../utils/storage-status');

const router = express.Router();
const LUKS_MOUNT_POINT = path.resolve(process.env.LUKS_MOUNT_POINT || '/media/cloudpi-data');

function isReservedLuksStoragePath(candidatePath) {
    if (!candidatePath) return false;
    const normalizedCandidate = path.resolve(candidatePath);
    return normalizedCandidate === LUKS_MOUNT_POINT
        || normalizedCandidate.startsWith(`${LUKS_MOUNT_POINT}${path.sep}`);
}

function getMountSourceForPath(targetPath) {
    try {
        const normalizedTarget = path.resolve(targetPath);
        const mountInfo = fs.readFileSync('/proc/self/mountinfo', 'utf8');
        const lines = mountInfo.trim().split('\n');
        let bestMatch = null;

        for (const line of lines) {
            const parts = line.split(' - ');
            if (parts.length !== 2) continue;

            const left = parts[0].split(' ');
            const right = parts[1].split(' ');
            if (left.length < 5 || right.length < 2) continue;

            const mountPoint = left[4].replace(/\\040/g, ' ');
            const source = right[1];

            if (normalizedTarget === mountPoint || normalizedTarget.startsWith(`${mountPoint}/`)) {
                if (!bestMatch || mountPoint.length > bestMatch.mountPoint.length) {
                    bestMatch = { mountPoint, source };
                }
            }
        }

        return bestMatch?.source || null;
    } catch {
        return null;
    }
}

function getParentBlockDeviceName(deviceName) {
    if (!deviceName) return null;
    if (/^nvme\d+n\d+p\d+$/.test(deviceName)) return deviceName.replace(/p\d+$/, '');
    if (/^mmcblk\d+p\d+$/.test(deviceName)) return deviceName.replace(/p\d+$/, '');
    if (/^[a-z]+[0-9]+$/.test(deviceName)) return deviceName.replace(/[0-9]+$/, '');
    return deviceName;
}

function getBlockMountInfo(drivePath) {
    const source = getMountSourceForPath(drivePath);
    if (!source || !source.startsWith('/dev/')) {
        return { source, reason: source ? `mount source is ${source}` : 'no block-device mount source found' };
    }

    const deviceName = path.basename(source);
    const parentDeviceName = getParentBlockDeviceName(deviceName);
    if (!parentDeviceName) {
        return { source, deviceName, reason: 'could not determine parent block device' };
    }

    let removable = false;
    let isUsb = false;
    try {
        const removablePath = `/sys/class/block/${parentDeviceName}/removable`;
        removable = fs.existsSync(removablePath)
            ? fs.readFileSync(removablePath, 'utf8').trim() === '1'
            : false;
    } catch {
        removable = false;
    }

    try {
        const deviceRealPath = fs.realpathSync(`/sys/class/block/${parentDeviceName}/device`);
        isUsb = deviceRealPath.includes('/usb');
    } catch {
        isUsb = false;
    }

    return {
        source,
        deviceName,
        parentDeviceName,
        removable,
        isUsb,
    };
}

function classifyExternalDrivePath(drivePath) {
    if (isReservedLuksStoragePath(drivePath)) {
        return { eligible: false, reason: 'reserved CloudPi LUKS internal storage mount' };
    }

    const info = getBlockMountInfo(drivePath);
    if (info.reason) {
        return { eligible: false, ...info };
    }

    if (/^mmcblk\d+$/.test(info.parentDeviceName)) {
        return { eligible: false, reason: 'Raspberry Pi SD-card partition', ...info };
    }

    if (info.isUsb || info.removable || /^sd[a-z]+$/.test(info.parentDeviceName)) {
        return { eligible: true, ...info };
    }

    return { eligible: false, reason: 'not a removable or USB-style block device', ...info };
}

// HMAC helpers for .cloudpi-id integrity (shared utility)
const { computeDriveHmac, verifyDriveHmac } = require('../utils/drive-hmac');

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

        // Get user from database to check admin status and token validity
        const user = db.prepare(
            'SELECT id, is_admin, is_disabled, token_version FROM users WHERE id = ?'
        ).get(decoded.userId);

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
            'SELECT id, username, email, is_admin, is_disabled, failed_login_attempts, locked_until, default_storage_id, storage_quota, created_at FROM users ORDER BY created_at DESC'
        ).all();

        // Calculate used bytes for each user
        const enriched = users.map(user => {
            const usedRow = db.prepare(
                "SELECT COALESCE(SUM(size), 0) as used FROM files WHERE user_id = ? AND trashed = 0 AND type != 'folder'"
            ).get(user.id);
            return { ...user, used_bytes: usedRow.used || 0 };
        });

        res.json({ users: enriched });
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
        const { username, password, email, isAdmin = false } = req.body;

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
            'INSERT INTO users (username, password, email, is_admin) VALUES (?, ?, ?, ?)'
        ).run(username, hashedPassword, email || null, isAdmin ? 1 : 0);

        res.status(201).json({
            message: 'User created successfully',
            user: {
                id: result.lastInsertRowid,
                username,
                email: email || null,
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
            'SELECT id, username, is_admin, token_version FROM users WHERE id = ?'
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
            const source = db.prepare('SELECT id, label, path FROM storage_sources WHERE id = ?').get(default_storage_id);
            if (!source) {
                return res.status(400).json({ error: 'Storage source not found' });
            }

            // SAFETY CHECK: Warn if the drive is not currently accessible
            let driveAccessible = false;
            try {
                driveAccessible = fs.existsSync(source.path);
            } catch (e) {
                driveAccessible = false;
            }

            if (!driveAccessible) {
                return res.status(400).json({
                    error: `Drive "${source.label}" is not currently attached or accessible at ${source.path}. Please connect the drive first, or choose a different storage source.`
                });
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
 * PUT /api/admin/users/:id/quota
 * Sets a storage quota for a user (Super Admin only)
 * Body: { quota_mb: 500 } — quota in MB, or 0/null for unlimited
 */
router.put('/users/:id/quota', requireAdmin, (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can set quotas' });
        }

        const userId = parseInt(req.params.id);
        const { quota_mb } = req.body;

        const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Convert MB to bytes, or NULL for unlimited
        const quotaBytes = (quota_mb && quota_mb > 0) ? Math.round(quota_mb * 1024 * 1024) : null;

        db.prepare('UPDATE users SET storage_quota = ? WHERE id = ?').run(quotaBytes, userId);

        console.log(`📊 Set quota for ${user.username}: ${quota_mb ? quota_mb + ' MB' : 'Unlimited'}`);

        res.json({
            message: `Quota ${quota_mb ? `set to ${quota_mb} MB` : 'removed (unlimited)'} for ${user.username}`,
            storage_quota: quotaBytes,
        });
    } catch (error) {
        console.error('Set quota error:', error);
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
 * PUT /api/admin/users/:id/disable
 * Disable or enable a user account (Super Admin only)
 * Body: { disabled: true/false }
 */
router.put('/users/:id/disable', requireAdmin, (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can disable/enable users' });
        }

        const userId = parseInt(req.params.id);
        const { disabled } = req.body;

        // Cannot disable yourself or the super admin
        if (userId === 1) {
            return res.status(400).json({ error: 'Cannot disable the Super Admin' });
        }
        if (userId === currentUserId) {
            return res.status(400).json({ error: 'Cannot disable your own account' });
        }

        const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        db.prepare('UPDATE users SET is_disabled = ? WHERE id = ?').run(disabled ? 1 : 0, userId);

        // If disabling, also invalidate their tokens
        if (disabled) {
            const currentVersion = db.prepare('SELECT token_version FROM users WHERE id = ?').get(userId);
            db.prepare('UPDATE users SET token_version = ? WHERE id = ?')
                .run((currentVersion?.token_version || 1) + 1, userId);
        }

        console.log(`${disabled ? '🚫' : '✅'} User ${user.username} ${disabled ? 'disabled' : 'enabled'} by Super Admin`);

        res.json({
            message: `User ${user.username} ${disabled ? 'disabled' : 'enabled'} successfully`,
            is_disabled: disabled ? 1 : 0
        });
    } catch (error) {
        console.error('Disable user error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/admin/users/:id/role
 * Toggle admin status for a user (Super Admin only)
 * Body: { is_admin: true/false }
 */
router.put('/users/:id/role', requireAdmin, (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can change user roles' });
        }

        const userId = parseInt(req.params.id);
        const { is_admin } = req.body;

        if (userId === 1) {
            return res.status(400).json({ error: 'Cannot change the Super Admin role' });
        }

        const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, userId);

        console.log(`🔐 User ${user.username} ${is_admin ? 'promoted to admin' : 'demoted to user'} by Super Admin`);

        res.json({
            message: `${user.username} is now ${is_admin ? 'an Admin' : 'a regular User'}`,
            is_admin: is_admin ? 1 : 0
        });
    } catch (error) {
        console.error('Change role error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/admin/users/:id/unlock
 * Unlock a locked account (Admin only)
 */
router.put('/users/:id/unlock', requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        const user = db.prepare('SELECT id, username, locked_until FROM users WHERE id = ?').get(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?').run(userId);

        console.log(`🔓 Account ${user.username} unlocked by admin`);

        res.json({ message: `Account ${user.username} unlocked successfully` });
    } catch (error) {
        console.error('Unlock user error:', error);
        res.status(500).json({ error: 'Server error' });
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
        const allowedNumericKeys = [
            'rate_limit_api_max', 'rate_limit_api_window',
            'rate_limit_auth_max', 'rate_limit_auth_window',
            'rate_limit_upload_max', 'rate_limit_upload_window',
            'password_min_length',
            'account_lockout_attempts', 'account_lockout_duration',
        ];
        
        const allowedStringKeys = [
            'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from_email'
        ];

        const updateStmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
        const updated = [];

        for (const [key, value] of Object.entries(settings)) {
            if (!allowedNumericKeys.includes(key) && !allowedStringKeys.includes(key)) {
                return res.status(400).json({ error: `Unknown setting: ${key}` });
            }

            let finalValue = value;

            if (allowedNumericKeys.includes(key)) {
                // Validate numeric values
                const numValue = parseInt(value, 10);
                if (isNaN(numValue) || numValue < 0 || numValue > 1000) {
                    return res.status(400).json({ 
                        error: `Invalid value for ${key}: must be a number between 0 and 1000` 
                    });
                }
                finalValue = String(numValue);
            } else if (allowedStringKeys.includes(key)) {
                finalValue = String(value);
            }
            
            // Handle smtp_pass encryption
            if (key === 'smtp_pass' && finalValue.length > 0 && finalValue !== '********') {
                 const crypto = require('crypto');
                 const ENCRYPTION_KEY = process.env.CLOUDPI_ENCRYPTION_KEY;
                 if (ENCRYPTION_KEY && ENCRYPTION_KEY.length === 64) {
                     const iv = crypto.randomBytes(16);
                     const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
                     let encrypted = cipher.update(finalValue);
                     encrypted = Buffer.concat([encrypted, cipher.final()]);
                     finalValue = iv.toString('hex') + ':' + encrypted.toString('hex');
                 } else {
                     // Fallback to base64 if no key configured (not great, but better than nothing)
                     finalValue = Buffer.from(finalValue).toString('base64');
                 }
            } else if (key === 'smtp_pass' && finalValue === '********') {
                // Do not update the password if the UI sent back the mask!
                continue;
            }

            updateStmt.run(finalValue, key);
            updated.push(key);
        }

        console.log(`⚙️ Settings updated by Super Admin: ${updated.join(', ')}`);

        res.json({ message: 'Settings updated successfully', updated });

    } catch (error) {
        console.error('Update settings error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/admin/settings/test-smtp
 * Test SMTP configuration without saving it
 */
router.post('/settings/test-smtp', requireAdmin, async (req, res) => {
    try {
        const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_email } = req.body;
        
        if (!smtp_host || !smtp_port) {
            return res.status(400).json({ error: 'SMTP Host and Port are required' });
        }
        
        const nodemailer = require('nodemailer');
        
        // If password is masked, fetch the real one from DB
        let actualPass = smtp_pass;
        if (actualPass === '********') {
            const dbPass = db.prepare("SELECT value FROM settings WHERE key = 'smtp_pass'").get();
            if (dbPass && dbPass.value) {
                // Decrypt it
                const val = dbPass.value;
                if (val.includes(':')) {
                    const crypto = require('crypto');
                    const ENCRYPTION_KEY = process.env.CLOUDPI_ENCRYPTION_KEY;
                    if (ENCRYPTION_KEY && ENCRYPTION_KEY.length === 64) {
                        const textParts = val.split(':');
                        const iv = Buffer.from(textParts.shift(), 'hex');
                        const encryptedText = Buffer.from(textParts.join(':'), 'hex');
                        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
                        let decrypted = decipher.update(encryptedText);
                        decrypted = Buffer.concat([decrypted, decipher.final()]);
                        actualPass = decrypted.toString();
                    }
                } else {
                    actualPass = Buffer.from(val, 'base64').toString('ascii');
                }
            }
        }

        const transporter = nodemailer.createTransport({
            host: smtp_host,
            port: parseInt(smtp_port, 10),
            secure: parseInt(smtp_port, 10) === 465,
            auth: smtp_user ? {
                user: smtp_user,
                pass: actualPass,
            } : undefined,
        });
        
        // Get the super admin's email to send the test to
        const adminUser = db.prepare('SELECT email FROM users WHERE id = ?').get(req.user.userId);
        const toEmail = adminUser?.email || smtp_user;
        
        if (!toEmail) {
            return res.status(400).json({ error: 'Please set your admin account email first to receive the test' });
        }

        await transporter.sendMail({
            from: `"${smtp_from_email || 'CloudPi Test'}" <${smtp_user || 'no-reply@cloudpi'}>`,
            to: toEmail,
            subject: 'CloudPi: SMTP Test Successful',
            text: 'Your SMTP configuration in CloudPi is working perfectly!',
        });

        res.json({ message: 'Test email sent successfully to ' + toEmail });

    } catch (error) {
        console.error('SMTP test error:', error);
        res.status(500).json({ error: 'SMTP Test Failed: ' + error.message });
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
        syncInternalStorageState({ emitOnChange: false });

        const sources = db.prepare(`
            SELECT s.*,
                   COALESCE(SUM(f.size), 0) as used_bytes,
                   COUNT(f.id) as file_count
            FROM storage_sources s
            LEFT JOIN files f ON f.storage_source_id = s.id AND f.type != 'folder'
            GROUP BY s.id
            ORDER BY s.type ASC, s.created_at ASC
        `).all();

        // Import identity-aware check (handles ghost partition at same mount point)
        const { isDriveActuallyPresent } = require('./events');

        // Enrich with live accessibility info and disk space
        const enriched = sources.map(source => {
            // Primary source: the is_accessible column (updated by udev events)
            // Cross-check: verify filesystem agrees with DB state
            let is_accessible = !!source.is_accessible;
            if (source.type === 'internal') {
                is_accessible = isInternalStorageAccessible();
            } else {
                try {
                    // Identity-aware: check .cloudpi-id matches, not just path exists
                    const fsAccessible = isDriveActuallyPresent(source.path, source.id);
                    // If DB says accessible but filesystem disagrees, update DB
                    if (is_accessible && !fsAccessible) {
                        db.prepare('UPDATE storage_sources SET is_accessible = 0 WHERE id = ?').run(source.id);
                        is_accessible = false;
                    } else if (!is_accessible && fsAccessible) {
                        // Drive appeared without udev event (edge case) — don't auto-reactivate
                        // Admin must manually verify via reactivate endpoint
                    }
                } catch (e) {
                    is_accessible = false;
                }
            }

            // Get total disk space if accessible
            let total_bytes = source.total_bytes;
            let free_bytes = 0;
            if (is_accessible) {
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

        if (isReservedLuksStoragePath(drivePath)) {
            return res.status(400).json({
                error: 'The CloudPi LUKS mount is reserved for Layer 1 application storage and cannot be registered as a user storage source.'
            });
        }

        // Check path exists
        if (!fs.existsSync(drivePath)) {
            return res.status(400).json({ error: `Path not found: ${drivePath}` });
        }

        // Check if this drive was previously registered (has .cloudpi-id)
        const idFilePath = path.join(drivePath, '.cloudpi-id');
        let driveId;

        if (fs.existsSync(idFilePath)) {
            // Re-registering an existing drive — verify HMAC if present
            try {
                const content = fs.readFileSync(idFilePath, 'utf8');
                const match = content.match(/drive_id=(.+)/);
                if (match) {
                    driveId = match[1].trim();

                    // SECURITY: Verify HMAC to detect forged .cloudpi-id files
                    const hmacMatch = content.match(/hmac=(.+)/);
                    const hmacOk = hmacMatch ? verifyDriveHmac(driveId, hmacMatch[1].trim()) : false;
                    if (!hmacOk) {
                        console.warn(`⚠️ [SECURITY] .cloudpi-id HMAC verification failed for drive at ${drivePath} (drive_id=${driveId}). File may have been tampered with or created by another server.`);
                    }

                    // Check if this source exists in DB
                    const existing = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(driveId);
                    if (existing) {
                        // Re-activate it
                        db.prepare('UPDATE storage_sources SET is_active = 1, path = ?, label = ? WHERE id = ?')
                            .run(drivePath, label, driveId);
                        console.log(`💾 Re-activated storage: ${label} (${driveId})`);
                        const source = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(driveId);
                        return res.json({
                            message: 'Storage source re-activated!',
                            source,
                            hmac_verified: hmacOk,
                            ...(!hmacOk && { security_notice: 'Warning: .cloudpi-id HMAC could not be verified. This file may have been modified or created by another server.' })
                        });
                    }
                }
            } catch (e) {
                // Couldn't read the file, treat as new
            }
        }

        // New drive — generate ID and write .cloudpi-id
        driveId = driveId || uuidv4();

        // Write the .cloudpi-id file with HMAC signature for tamper detection
        const hmac = computeDriveHmac(driveId);
        let idContent = `drive_id=${driveId}\nregistered=${new Date().toISOString()}\nlabel=${label}\n`;
        if (hmac) {
            idContent += `hmac=${hmac}\n`;
        }
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

        console.log(`💾 [AUDIT] Drive registered by admin (user_id=${currentUserId}): ${label} at ${drivePath} (${driveId})`);

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

        // Clear any users whose default storage points to this source (FK dependency)
        const affectedUsers = db.prepare(
            'SELECT id FROM users WHERE default_storage_id = ?'
        ).all(sourceId).map(u => u.id);
        if (affectedUsers.length > 0) {
            db.prepare('UPDATE users SET default_storage_id = NULL WHERE default_storage_id = ?').run(sourceId);
            console.log(`💾 [AUDIT] Cleared default_storage_id for user_id(s) [${affectedUsers.join(', ')}] referencing removed source (admin user_id=${currentUserId}): ${source.label} (${sourceId})`);
        }

        db.prepare('DELETE FROM storage_sources WHERE id = ?').run(sourceId);
        console.log(`💾 [AUDIT] Drive removed by admin (user_id=${currentUserId}): ${source.label} (${sourceId})`);

        res.json({ message: 'Storage source removed' });

    } catch (error) {
        console.error('Delete storage error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// DRIVE DETECTION (Super Admin only)
// ================================================
// Architecture: Follows the Nextcloud pattern (Separation of Concerns).
// The host OS handles USB mounting automatically (via udisks2/usbmount).
// This backend only reads the filesystem to detect what's already mounted.
// No shell commands (lsblk, mount, umount) are executed — no root needed.
// ================================================

// Path where the host OS auto-mounts USB drives
// - Raspberry Pi OS (desktop): /media/pi
// - Headless Pi with usbmount: /media/usb0, /media/usb1, etc.
// - Docker: set via CLOUDPI_EXTERNAL_DRIVES_PATH env var
let EXTERNAL_DRIVES_PATH = process.env.CLOUDPI_EXTERNAL_DRIVES_PATH;

if (!EXTERNAL_DRIVES_PATH && process.platform === 'linux') {
    const username = os.userInfo().username;
    // Check common Linux mount points
    const commonPaths = [
        `/run/media/${username}`, // Modern Linux (Kali, Arch, Fedora)
        `/media/${username}`,     // Ubuntu, Debian, Mint
        '/media/pi',              // Raspberry Pi OS fallback
        '/media'                  // Generic fallback
    ];
    
    // Find the first path that actually exists on the system
    for (const p of commonPaths) {
        if (fs.existsSync(p)) {
            EXTERNAL_DRIVES_PATH = p;
            break;
        }
    }
    if (!EXTERNAL_DRIVES_PATH) EXTERNAL_DRIVES_PATH = '/media/pi'; // Ultimate fallback
}

/**
 * GET /api/admin/drives
 * Scans the external drives directory for auto-mounted USB drives.
 * No shell commands — just reads the filesystem.
 * Cross-references with storage_sources to show registered status.
 * Also detects "dirty unplug" — registered drives that are no longer present.
 */
router.get('/drives', requireAdmin, async (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can manage drives' });
        }

        // Get all registered storage sources from DB
        const registeredSources = db.prepare(
            "SELECT id, label, path, type, is_active FROM storage_sources WHERE type = 'external'"
        ).all();

        // If no external drives path configured (e.g., Windows dev)
        if (!EXTERNAL_DRIVES_PATH) {
            return res.json({
                drives: [],
                registeredSources: registeredSources.map(s => ({
                    ...s,
                    status: fs.existsSync(s.path) ? 'online' : 'offline'
                })),
                platform: process.platform,
                message: 'Drive detection is only available on Linux (Raspberry Pi)'
            });
        }

        const drives = [];
        const skippedCandidates = [];

        // Scan the external drives directory for auto-mounted USB drives
        let entries = [];
        try {
            entries = fs.readdirSync(EXTERNAL_DRIVES_PATH, { withFileTypes: true });
        } catch (e) {
            // Directory doesn't exist or isn't accessible
            return res.json({
                drives: [],
                registeredSources: registeredSources.map(s => ({
                    ...s,
                    status: fs.existsSync(s.path) ? 'online' : 'offline'
                })),
                platform: process.platform,
                message: `External drives path not accessible: ${EXTERNAL_DRIVES_PATH}`
            });
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const drivePath = path.join(EXTERNAL_DRIVES_PATH, entry.name);
            const classification = classifyExternalDrivePath(drivePath);
            if (!classification.eligible) {
                skippedCandidates.push({
                    name: entry.name,
                    path: drivePath,
                    reason: classification.reason || 'not eligible for registration',
                    source: classification.source || null,
                    device: classification.parentDeviceName || classification.deviceName || null,
                });
                continue;
            }

            // Check if registered in our DB
            let isRegistered = false;
            let registeredId = null;

            // Check by .cloudpi-id file first, with HMAC verification
            let hmacValid = false;
            try {
                const idFile = path.join(drivePath, '.cloudpi-id');
                if (fs.existsSync(idFile)) {
                    const content = fs.readFileSync(idFile, 'utf8');
                    const match = content.match(/drive_id=(.+)/);
                    if (match) {
                        const driveId = match[1].trim();
                        // Verify HMAC if present
                        const hmacMatch = content.match(/hmac=(.+)/);
                        if (hmacMatch) {
                            hmacValid = verifyDriveHmac(driveId, hmacMatch[1].trim());
                        }
                        const src = registeredSources.find(s => s.id === driveId);
                        if (src) {
                            isRegistered = true;
                            registeredId = driveId;
                        }
                    }
                }
            } catch (e) { /* ignore */ }

            // Fallback: check by path match
            if (!isRegistered) {
                const src = registeredSources.find(s => s.path === drivePath);
                if (src) {
                    isRegistered = true;
                    registeredId = src.id;
                }
            }

            // Get disk space info
            let totalBytes = 0, freeBytes = 0;
            try {
                const stats = fs.statfsSync(drivePath);
                totalBytes = stats.bsize * stats.blocks;
                freeBytes = stats.bsize * stats.bavail;
            } catch (e) { /* not critical */ }

            drives.push({
                name: entry.name,
                path: drivePath,
                size: totalBytes,
                freeBytes,
                label: entry.name,
                isMounted: true,  // It's in the directory, so it's auto-mounted
                isRegistered,
                registeredId,
                hmac_verified: hmacValid,  // false if .cloudpi-id has no/bad HMAC
                source: classification.source,
            });
        }

        // Dirty unplug detection: check registered sources that aren't in the detected drives
        const { isDriveActuallyPresent } = require('./events');
        const enrichedSources = registeredSources.map(src => {
            const isPresent = drives.some(d => d.registeredId === src.id);
            // Identity-aware: verify .cloudpi-id matches, not just path exists
            const isAccessible = src.path ? isDriveActuallyPresent(src.path, src.id) : false;
            return {
                ...src,
                status: isAccessible ? 'online' : (isPresent ? 'detected' : 'offline'),
            };
        });

        // SECURITY: Do NOT auto-reactivate drives silently.
        // A crafted .cloudpi-id on a rogue USB could spoof a trusted drive.
        // Instead, flag drives that need reactivation — admin must click to confirm.
        for (const drive of drives) {
            if (drive.isRegistered && drive.registeredId) {
                const src = enrichedSources.find(s => s.id === drive.registeredId);
                if (src && !src.is_active) {
                    drive.needs_reactivation = true;
                }
            }
        }

        // Audit log: record scan event
        console.log(`🔍 [AUDIT] Drive scan by admin (user_id=${currentUserId}): found ${drives.length} drive(s), ${enrichedSources.length} registered source(s)`);
        if (skippedCandidates.length > 0) {
            console.log(`🔍 [AUDIT] Skipped drive candidate(s): ${skippedCandidates.map(d => `${d.path} (${d.reason})`).join(', ')}`);
        }

        // Log unknown drives (not in allow-list)
        const unknownDrives = drives.filter(d => !d.isRegistered);
        if (unknownDrives.length > 0) {
            console.warn(`⚠️ [AUDIT] Unknown drive(s) detected: ${unknownDrives.map(d => d.path).join(', ')}`);
        }

        // Log drives with failed/missing HMAC (potential spoofing)
        const unsignedDrives = drives.filter(d => d.isRegistered && !d.hmac_verified);
        if (unsignedDrives.length > 0) {
            console.warn(`⚠️ [SECURITY] Registered drive(s) with unverified HMAC: ${unsignedDrives.map(d => d.path).join(', ')}. These .cloudpi-id files may be unsigned (legacy) or tampered with.`);
        }

        res.json({
            drives,
            skippedCandidates,
            registeredSources: enrichedSources,
            platform: process.platform,
        });

    } catch (error) {
        console.error('Drive scan error:', error);
        res.status(500).json({ error: `Failed to scan drives: ${error.message}` });
    }
});

/**
 * POST /api/admin/storage/:id/reactivate
 * Explicitly reactivate a previously registered drive that has reappeared.
 * Replaces the old silent auto-reactivation for security.
 * Body: { path: "/media/pi/MyDrive" }
 */
router.post('/storage/:id/reactivate', requireAdmin, (req, res) => {
    try {
        const currentUserId = req.user.userId;
        if (currentUserId !== 1) {
            return res.status(403).json({ error: 'Only the Super Admin can reactivate drives' });
        }

        const sourceId = req.params.id;
        const { path: drivePath } = req.body;

        // Verify the storage source exists in our DB
        const source = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(sourceId);
        if (!source) {
            return res.status(404).json({ error: 'Storage source not found in registry' });
        }

        if (source.is_active) {
            return res.status(400).json({ error: 'Storage source is already active' });
        }

        // Verify the drive path is accessible
        const targetPath = drivePath || source.path;
        if (!fs.existsSync(targetPath)) {
            return res.status(400).json({ error: `Drive path not accessible: ${targetPath}` });
        }

        // Reactivate
        db.prepare('UPDATE storage_sources SET is_active = 1, path = ? WHERE id = ?')
            .run(targetPath, sourceId);

        console.log(`✅ [AUDIT] Drive reactivated by admin (user_id=${currentUserId}): ${source.label} (${sourceId}) at ${targetPath}`);

        const updated = db.prepare('SELECT * FROM storage_sources WHERE id = ?').get(sourceId);
        res.json({ message: `Drive "${source.label}" reactivated successfully`, source: updated });

    } catch (error) {
        console.error('Reactivate storage error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
