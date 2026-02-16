/**
 * AUTHENTICATION ROUTES
 * =====================
 * Handles user login, setup, and password recovery
 * 
 * ENDPOINTS:
 * GET  /api/auth/setup-status - Check if first-time setup is required
 * POST /api/auth/setup        - Create first admin account (returns backup code)
 * POST /api/auth/login        - Login with username + password
 * GET  /api/auth/me           - Get current user info (requires token)
 * PUT  /api/auth/profile      - Update username
 * PUT  /api/auth/password     - Change password
 * POST /api/auth/recover      - Recover super admin with backup code
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../database/db');

const router = express.Router();

/**
 * SECRET KEY for JWT tokens
 * In production, this should be in an environment variable!
 * For your local Raspberry Pi, this is fine.
 */
const JWT_SECRET = 'cloudpi-secret-key-change-this-in-production';

/**
 * BCRYPT SALT ROUNDS
 * Higher = more secure but slower
 * 10 is a good balance for Raspberry Pi performance
 */
const SALT_ROUNDS = 10;

/**
 * Generate a random backup code like "XXXX-XXXX-XXXX"
 */
function generateBackupCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O/0/1/I to avoid confusion
    let code = '';
    for (let i = 0; i < 12; i++) {
        if (i > 0 && i % 4 === 0) code += '-';
        code += chars[crypto.randomInt(chars.length)];
    }
    return code;
}

/**
 * GET /api/auth/setup-status
 * Checks if initial setup is required (no users in database)
 */
router.get('/setup-status', (req, res) => {
    try {
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
        res.json({ 
            setupRequired: userCount.count === 0,
            userCount: userCount.count
        });
    } catch (error) {
        console.error('Setup status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/auth/setup
 * Creates the first admin user (only works when no users exist)
 * Returns a one-time backup code for password recovery
 */
router.post('/setup', async (req, res) => {
    try {
        // Check if any users already exist
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
        
        if (userCount.count > 0) {
            return res.status(403).json({ error: 'Setup already completed. Users exist.' });
        }

        const { username, password } = req.body;

        // Validate required fields
        if (!username || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['username', 'password']
            });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // Generate backup code for super admin recovery
        const backupCode = generateBackupCode();
        const hashedBackupCode = await bcrypt.hash(backupCode, SALT_ROUNDS);

        // Insert first user as admin with backup code
        const result = db.prepare(
            'INSERT INTO users (username, password, is_admin, backup_code) VALUES (?, ?, 1, ?)'
        ).run(username, hashedPassword, hashedBackupCode);

        // Create JWT token
        const token = jwt.sign(
            { userId: result.lastInsertRowid, username, tokenVersion: 1 },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Admin account created successfully',
            token,
            backupCode, // Shown once to the user, then never again
            user: {
                id: result.lastInsertRowid,
                username,
                is_admin: 1
            }
        });

    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: 'Server error during setup' });
    }
});

/**
 * POST /api/auth/login
 * Authenticates user with username + password and returns JWT token
 * 
 * REQUEST BODY:
 * {
 *   "username": "admin",
 *   "password": "MyPassword123"
 * }
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validate required fields
        if (!username || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['username', 'password']
            });
        }

        // Find user by username
        const user = db.prepare(
            'SELECT * FROM users WHERE username = ?'
        ).get(username);

        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Compare password with hash
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Create JWT token
        const token = jwt.sign(
            { userId: user.id, username: user.username, tokenVersion: user.token_version || 1 },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                is_admin: user.is_admin
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

/**
 * GET /api/auth/me
 * Returns current user info based on JWT token
 */
router.get('/me', (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        // Get fresh user data from database
        const user = db.prepare(
            'SELECT id, username, is_admin, token_version, created_at FROM users WHERE id = ?'
        ).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Validate token_version
        const tokenVersion = decoded.tokenVersion || 0;
        const dbTokenVersion = user.token_version || 1;
        
        if (tokenVersion !== dbTokenVersion) {
            return res.status(401).json({ error: 'Token expired or invalidated' });
        }

        res.json({ user });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error('Auth check error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/auth/profile
 * Updates user profile (username only)
 */
router.put('/profile', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const { username } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        // Check if new username already exists for another user
        const existingUser = db.prepare(
            'SELECT id FROM users WHERE username = ? AND id != ?'
        ).get(username, decoded.userId);

        if (existingUser) {
            return res.status(400).json({ error: 'Username already in use' });
        }

        db.prepare(
            'UPDATE users SET username = ? WHERE id = ?'
        ).run(username, decoded.userId);

        // Get updated user
        const updatedUser = db.prepare(
            'SELECT id, username, is_admin, created_at FROM users WHERE id = ?'
        ).get(decoded.userId);

        res.json({
            message: 'Profile updated successfully',
            user: updatedUser
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Server error during profile update' });
    }
});

/**
 * PUT /api/auth/password
 * Changes user password
 */
router.put('/password', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['currentPassword', 'newPassword']
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        const user = db.prepare(
            'SELECT * FROM users WHERE id = ?'
        ).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        const passwordMatch = await bcrypt.compare(currentPassword, user.password);

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        db.prepare(
            'UPDATE users SET password = ? WHERE id = ?'
        ).run(hashedPassword, decoded.userId);

        res.json({ message: 'Password changed successfully' });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Password change error:', error);
        res.status(500).json({ error: 'Server error during password change' });
    }
});

/**
 * POST /api/auth/recover
 * Recovers super admin account using backup code
 * Sets a new password and generates a new backup code
 * 
 * REQUEST BODY:
 * {
 *   "backupCode": "XXXX-XXXX-XXXX",
 *   "newPassword": "newPassword123"
 * }
 */
router.post('/recover', async (req, res) => {
    try {
        const { backupCode, newPassword } = req.body;

        if (!backupCode || !newPassword) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['backupCode', 'newPassword']
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        // Only the super admin (id = 1) has a backup code
        const superAdmin = db.prepare(
            'SELECT * FROM users WHERE id = 1'
        ).get();

        if (!superAdmin) {
            return res.status(404).json({ error: 'Super admin not found' });
        }

        if (!superAdmin.backup_code) {
            return res.status(400).json({ error: 'No backup code set for this account' });
        }

        // Verify backup code
        const codeMatch = await bcrypt.compare(backupCode.toUpperCase(), superAdmin.backup_code);

        if (!codeMatch) {
            return res.status(401).json({ error: 'Invalid backup code' });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // Generate a NEW backup code for next time
        const newBackupCode = generateBackupCode();
        const hashedNewBackupCode = await bcrypt.hash(newBackupCode, SALT_ROUNDS);

        // Update password, backup code, and invalidate old tokens
        const newTokenVersion = (superAdmin.token_version || 1) + 1;
        db.prepare(
            'UPDATE users SET password = ?, backup_code = ?, token_version = ? WHERE id = 1'
        ).run(hashedPassword, hashedNewBackupCode, newTokenVersion);

        // Create new JWT token
        const token = jwt.sign(
            { userId: 1, username: superAdmin.username, tokenVersion: newTokenVersion },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Password reset successfully',
            token,
            newBackupCode, // Show the new backup code to the user
            user: {
                id: superAdmin.id,
                username: superAdmin.username,
                is_admin: superAdmin.is_admin
            }
        });

    } catch (error) {
        console.error('Recovery error:', error);
        res.status(500).json({ error: 'Server error during recovery' });
    }
});

/**
 * POST /api/auth/check-recovery
 * Checks if a username can use backup code recovery
 * Only the Super Admin (id=1) can recover via backup code
 */
router.post('/check-recovery', (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        const user = db.prepare(
            'SELECT id FROM users WHERE username = ?'
        ).get(username);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Only super admin (id=1) can use backup code recovery
        res.json({ canRecover: user.id === 1 });

    } catch (error) {
        console.error('Check recovery error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
