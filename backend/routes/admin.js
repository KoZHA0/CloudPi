/**
 * ADMIN ROUTES
 * ============
 * Handles admin-only operations like user management
 * 
 * ENDPOINTS:
 * GET    /api/admin/users     - List all users
 * POST   /api/admin/users     - Create new user
 * DELETE /api/admin/users/:id - Delete user
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
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
            'SELECT id, username, email, is_admin, created_at FROM users ORDER BY created_at DESC'
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
        const { username, email, password, isAdmin = false } = req.body;

        // Validate required fields
        if (!username || !email || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['username', 'email', 'password']
            });
        }

        // Check if user already exists
        const existingUser = db.prepare(
            'SELECT id FROM users WHERE email = ? OR username = ?'
        ).get(email, username);

        if (existingUser) {
            return res.status(400).json({
                error: 'User with this email or username already exists'
            });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // Insert new user
        const result = db.prepare(
            'INSERT INTO users (username, email, password, is_admin) VALUES (?, ?, ?, ?)'
        ).run(username, email, hashedPassword, isAdmin ? 1 : 0);

        res.status(201).json({
            message: 'User created successfully',
            user: {
                id: result.lastInsertRowid,
                username,
                email,
                is_admin: isAdmin ? 1 : 0
            }
        });

    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({ error: 'Server error during user creation' });
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

module.exports = router;
