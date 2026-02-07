/**
 * AUTHENTICATION ROUTES
 * =====================
 * Handles user login and setup
 * 
 * ENDPOINTS:
 * GET  /api/auth/setup-status - Check if first-time setup is required
 * POST /api/auth/setup        - Create first admin account
 * POST /api/auth/login        - Login and get JWT token
 * GET  /api/auth/me           - Get current user info (requires token)
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
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
 */
router.post('/setup', async (req, res) => {
    try {
        // Check if any users already exist
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
        
        if (userCount.count > 0) {
            return res.status(403).json({ error: 'Setup already completed. Users exist.' });
        }

        const { username, email, password } = req.body;

        // Validate required fields
        if (!username || !email || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['username', 'email', 'password']
            });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // Insert first user as admin
        const result = db.prepare(
            'INSERT INTO users (username, email, password, is_admin) VALUES (?, ?, ?, 1)'
        ).run(username, email, hashedPassword);

        // Create JWT token with token_version
        const token = jwt.sign(
            { userId: result.lastInsertRowid, email, username, isAdmin: true, tokenVersion: 1 },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Admin account created successfully',
            token,
            user: {
                id: result.lastInsertRowid,
                username,
                email,
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
 * Authenticates user and returns JWT token
 * 
 * REQUEST BODY:
 * {
 *   "email": "john@example.com",
 *   "password": "MyPassword123"
 * }
 * 
 * RESPONSE:
 * - 200: Login successful, returns JWT token
 * - 400: Missing fields
 * - 401: Invalid credentials
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Validate required fields
        if (!email || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['email', 'password']
            });
        }

        // Find user by email
        const user = db.prepare(
            'SELECT * FROM users WHERE email = ?'
        ).get(email);

        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Compare password with hash
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        // Create JWT token with token_version
        const token = jwt.sign(
            { userId: user.id, email: user.email, username: user.username, tokenVersion: user.token_version || 1 },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
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
 * 
 * HEADERS:
 * Authorization: Bearer <token>
 * 
 * RESPONSE:
 * - 200: User info
 * - 401: Invalid or missing token
 */
router.get('/me', (req, res) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);

        // Get fresh user data from database
        const user = db.prepare(
            'SELECT id, username, email, is_admin, token_version, created_at FROM users WHERE id = ?'
        ).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Validate token_version - if token version doesn't match, token is invalid
        // This prevents old tokens from working after database reset or logout
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
 * Updates user profile (username and email)
 * 
 * HEADERS:
 * Authorization: Bearer <token>
 * 
 * REQUEST BODY:
 * {
 *   "username": "newUsername",
 *   "email": "newemail@example.com"
 * }
 */
router.put('/profile', async (req, res) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const { username, email } = req.body;

        // Validate at least one field is provided
        if (!username && !email) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        // Check if new email already exists for another user
        if (email) {
            const existingUser = db.prepare(
                'SELECT id FROM users WHERE email = ? AND id != ?'
            ).get(email, decoded.userId);

            if (existingUser) {
                return res.status(400).json({ error: 'Email already in use' });
            }
        }

        // Check if new username already exists for another user
        if (username) {
            const existingUser = db.prepare(
                'SELECT id FROM users WHERE username = ? AND id != ?'
            ).get(username, decoded.userId);

            if (existingUser) {
                return res.status(400).json({ error: 'Username already in use' });
            }
        }

        // Build update query dynamically
        const updates = [];
        const values = [];

        if (username) {
            updates.push('username = ?');
            values.push(username);
        }
        if (email) {
            updates.push('email = ?');
            values.push(email);
        }

        values.push(decoded.userId);

        db.prepare(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
        ).run(...values);

        // Get updated user
        const updatedUser = db.prepare(
            'SELECT id, username, email, created_at FROM users WHERE id = ?'
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
 * 
 * HEADERS:
 * Authorization: Bearer <token>
 * 
 * REQUEST BODY:
 * {
 *   "currentPassword": "oldPassword123",
 *   "newPassword": "newPassword456"
 * }
 */
router.put('/password', async (req, res) => {
    try {
        // Get token from header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const { currentPassword, newPassword } = req.body;

        // Validate required fields
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['currentPassword', 'newPassword']
            });
        }

        // Validate new password length
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters' });
        }

        // Get current user with password
        const user = db.prepare(
            'SELECT * FROM users WHERE id = ?'
        ).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Verify current password
        const passwordMatch = await bcrypt.compare(currentPassword, user.password);

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // Update password
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

module.exports = router;
