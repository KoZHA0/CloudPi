const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { JWT_SECRET } = require('../utils/auth-config');
const {
    clearReadNotifications,
    getNotificationPreferences,
    getUnreadCount,
    listNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    updateNotificationPreferences,
} = require('../utils/notifications');

const router = express.Router();

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
        console.error('Notifications auth error:', error);
        res.status(500).json({ error: 'Server error' });
    }
}

router.get('/unread-count', requireAuth, (req, res) => {
    try {
        res.json({ unreadCount: getUnreadCount(req.user.userId) });
    } catch (error) {
        console.error('Unread notification count error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/preferences', requireAuth, (req, res) => {
    try {
        res.json({ preferences: getNotificationPreferences(req.user.userId) });
    } catch (error) {
        console.error('Get notification preferences error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.patch('/preferences', requireAuth, (req, res) => {
    try {
        const { share_notifications, storage_warnings } = req.body || {};
        res.json({
            preferences: updateNotificationPreferences(req.user.userId, {
                share_notifications,
                storage_warnings,
            }),
        });
    } catch (error) {
        console.error('Update notification preferences error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/', requireAuth, (req, res) => {
    try {
        const data = listNotifications(req.user.userId, {
            limit: req.query.limit,
            offset: req.query.offset,
            status: req.query.status,
        });
        res.json(data);
    } catch (error) {
        console.error('List notifications error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.patch('/read-all', requireAuth, (req, res) => {
    try {
        res.json(markAllNotificationsRead(req.user.userId));
    } catch (error) {
        console.error('Mark all notifications read error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/read', requireAuth, (req, res) => {
    try {
        res.json(clearReadNotifications(req.user.userId));
    } catch (error) {
        console.error('Clear read notifications error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

router.patch('/:id/read', requireAuth, (req, res) => {
    try {
        const notification = markNotificationRead(req.user.userId, req.params.id);
        if (!notification) return res.status(404).json({ error: 'Notification not found' });
        res.json({ notification, unreadCount: getUnreadCount(req.user.userId) });
    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
