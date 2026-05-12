const db = require('../database/db');
const { getTotalUsedBytesForUser } = require('./file-versioning');

const MAX_NOTIFICATION_LIMIT = 100;
const STORAGE_QUOTA_STATE_KEY = 'storage.quota.bucket';
const DEFAULT_NOTIFICATION_PREFERENCES = {
    share_notifications: true,
    storage_warnings: true,
};
const STORAGE_BUCKET_SEVERITY = {
    below: 0,
    warning_80: 80,
    warning_95: 95,
    quota_reached: 100,
};

function clampLimit(value, fallback = 20) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, MAX_NOTIFICATION_LIMIT);
}

function normalizeOffset(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) return 0;
    return parsed;
}

function parseMetadata(value) {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function serializeMetadata(value) {
    if (value === undefined || value === null) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function boolFromDb(value, fallback = true) {
    if (value === undefined || value === null) return fallback;
    return Number(value) === 1;
}

function boolToDb(value, fallback = true) {
    if (value === undefined || value === null) return fallback ? 1 : 0;
    return value === true || value === 1 || value === '1' ? 1 : 0;
}

function getNotificationPreferences(userId) {
    const row = db.prepare(`
        SELECT share_notifications, storage_warnings
        FROM notification_preferences
        WHERE user_id = ?
    `).get(userId);

    return {
        share_notifications: boolFromDb(row?.share_notifications, DEFAULT_NOTIFICATION_PREFERENCES.share_notifications),
        storage_warnings: boolFromDb(row?.storage_warnings, DEFAULT_NOTIFICATION_PREFERENCES.storage_warnings),
    };
}

function updateNotificationPreferences(userId, preferences = {}) {
    const current = getNotificationPreferences(userId);
    const next = {
        share_notifications: boolToDb(preferences.share_notifications, current.share_notifications),
        storage_warnings: boolToDb(preferences.storage_warnings, current.storage_warnings),
    };

    db.prepare(`
        INSERT INTO notification_preferences (user_id, share_notifications, storage_warnings, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id)
        DO UPDATE SET
            share_notifications = excluded.share_notifications,
            storage_warnings = excluded.storage_warnings,
            updated_at = CURRENT_TIMESTAMP
    `).run(userId, next.share_notifications, next.storage_warnings);

    return getNotificationPreferences(userId);
}

function isNotificationTypeEnabled(userId, type) {
    const notificationType = String(type || '');
    const preferences = getNotificationPreferences(userId);

    if (notificationType.startsWith('share.')) {
        return preferences.share_notifications;
    }

    if (
        notificationType === 'storage.warning_80'
        || notificationType === 'storage.warning_95'
        || notificationType === 'storage.quota_reached'
        || notificationType.startsWith('storage.drive_')
    ) {
        return preferences.storage_warnings;
    }

    return true;
}

function shapeNotification(row) {
    if (!row) return null;
    return {
        id: row.id,
        user_id: row.user_id,
        type: row.type,
        title: row.title,
        body: row.body,
        link: row.link,
        read_at: row.read_at,
        created_at: row.created_at,
        metadata: parseMetadata(row.metadata_json),
    };
}

function getNotificationState(userId, stateKey) {
    const row = db.prepare(`
        SELECT value
        FROM notification_states
        WHERE user_id = ? AND state_key = ?
    `).get(userId, stateKey);
    return row?.value || null;
}

function setNotificationState(userId, stateKey, value) {
    db.prepare(`
        INSERT INTO notification_states (user_id, state_key, value, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, state_key)
        DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(userId, stateKey, value);
}

function createNotification({ userId, type, title, body, link = null, metadata = null }) {
    if (!userId || !type || !title || !body) return null;
    if (!isNotificationTypeEnabled(userId, type)) return null;

    const result = db.prepare(`
        INSERT INTO notifications (user_id, type, title, body, link, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        userId,
        String(type),
        String(title).slice(0, 160),
        String(body).slice(0, 500),
        link ? String(link).slice(0, 300) : null,
        serializeMetadata(metadata)
    );

    return getNotification(userId, result.lastInsertRowid);
}

function storageBucketForUsage(usedBytes, quotaBytes) {
    if (!quotaBytes || quotaBytes <= 0) return null;
    const percent = (Math.max(0, Number(usedBytes) || 0) / quotaBytes) * 100;
    if (percent >= 100) return 'quota_reached';
    if (percent >= 95) return 'warning_95';
    if (percent >= 80) return 'warning_80';
    return 'below';
}

function storageNotificationContent(bucket, usedBytes, quotaBytes) {
    const used = formatBytes(usedBytes);
    const quota = formatBytes(quotaBytes);
    const percent = quotaBytes > 0 ? Math.min(100, Math.round((usedBytes / quotaBytes) * 100)) : 0;

    if (bucket === 'quota_reached') {
        return {
            type: 'storage.quota_reached',
            title: 'Storage quota reached',
            body: `Uploads may fail because you are using ${used} of your ${quota} quota.`,
            link: '/settings',
        };
    }

    if (bucket === 'warning_95') {
        return {
            type: 'storage.warning_95',
            title: 'Storage is almost full',
            body: `You are using ${used} of your ${quota} quota (${percent}%).`,
            link: '/settings',
        };
    }

    return {
        type: 'storage.warning_80',
        title: 'Storage is getting full',
        body: `You are using ${used} of your ${quota} quota (${percent}%).`,
        link: '/settings',
    };
}

function evaluateStorageQuotaNotification(userId, options = {}) {
    try {
        const user = db.prepare('SELECT storage_quota FROM users WHERE id = ?').get(userId);
        const quotaBytes = Number(options.quotaBytes ?? user?.storage_quota) || 0;

        if (!quotaBytes || quotaBytes <= 0) {
            setNotificationState(userId, STORAGE_QUOTA_STATE_KEY, 'below');
            return null;
        }

        const usedBytes = Number(options.usedBytes ?? getTotalUsedBytesForUser(db, userId)) || 0;
        const bucket = options.forceBucket || storageBucketForUsage(usedBytes, quotaBytes);
        const previousBucket = getNotificationState(userId, STORAGE_QUOTA_STATE_KEY) || 'below';

        if (!bucket || bucket === 'below') {
            if (previousBucket !== 'below') {
                setNotificationState(userId, STORAGE_QUOTA_STATE_KEY, 'below');
            }
            return null;
        }

        const currentSeverity = STORAGE_BUCKET_SEVERITY[bucket] || 0;
        const previousSeverity = STORAGE_BUCKET_SEVERITY[previousBucket] || 0;
        if (currentSeverity <= previousSeverity) return null;

        const content = storageNotificationContent(bucket, usedBytes, quotaBytes);
        if (!isNotificationTypeEnabled(userId, content.type)) return null;

        const notification = createNotification({
            userId,
            ...content,
            metadata: {
                usedBytes,
                quotaBytes,
                percent: Math.round((usedBytes / quotaBytes) * 100),
                bucket,
            },
        });

        setNotificationState(userId, STORAGE_QUOTA_STATE_KEY, bucket);
        return notification;
    } catch (error) {
        console.error('Storage quota notification failed:', error.message);
        return null;
    }
}

function getNotification(userId, notificationId) {
    const row = db.prepare(`
        SELECT id, user_id, type, title, body, link, metadata_json, read_at, created_at
        FROM notifications
        WHERE user_id = ? AND id = ?
    `).get(userId, notificationId);
    return shapeNotification(row);
}

function getUnreadCount(userId) {
    const row = db.prepare(`
        SELECT COUNT(*) as count
        FROM notifications
        WHERE user_id = ? AND read_at IS NULL
    `).get(userId);
    return row?.count || 0;
}

function listNotifications(userId, options = {}) {
    const limit = clampLimit(options.limit);
    const offset = normalizeOffset(options.offset);
    const status = options.status === 'read' || options.status === 'unread' ? options.status : 'all';
    const params = [userId];
    let where = 'WHERE user_id = ?';

    if (status === 'read') {
        where += ' AND read_at IS NOT NULL';
    } else if (status === 'unread') {
        where += ' AND read_at IS NULL';
    }

    const total = db.prepare(`SELECT COUNT(*) as count FROM notifications ${where}`).get(...params).count || 0;
    const rows = db.prepare(`
        SELECT id, user_id, type, title, body, link, metadata_json, read_at, created_at
        FROM notifications
        ${where}
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    return {
        notifications: rows.map(shapeNotification),
        total,
        limit,
        offset,
        unreadCount: getUnreadCount(userId),
    };
}

function markNotificationRead(userId, notificationId) {
    const result = db.prepare(`
        UPDATE notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE user_id = ? AND id = ?
    `).run(userId, notificationId);

    if (result.changes === 0) return null;
    return getNotification(userId, notificationId);
}

function markAllNotificationsRead(userId) {
    const result = db.prepare(`
        UPDATE notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE user_id = ? AND read_at IS NULL
    `).run(userId);

    return {
        updated: result.changes,
        unreadCount: getUnreadCount(userId),
    };
}

function clearReadNotifications(userId) {
    const result = db.prepare(`
        DELETE FROM notifications
        WHERE user_id = ? AND read_at IS NOT NULL
    `).run(userId);

    return {
        deleted: result.changes,
        unreadCount: getUnreadCount(userId),
    };
}

module.exports = {
    clearReadNotifications,
    createNotification,
    evaluateStorageQuotaNotification,
    getNotificationPreferences,
    getUnreadCount,
    listNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    updateNotificationPreferences,
};
