const db = require('../database/db');

const MAX_ACTIVITY_LIMIT = 50;

function clampLimit(value, fallback = 10) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, MAX_ACTIVITY_LIMIT);
}

function serializeMetadata(value) {
    if (value === undefined || value === null) return null;
    try {
        return JSON.stringify(value);
    } catch {
        return null;
    }
}

function parseMetadata(value) {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function shapeActivity(row) {
    return {
        id: String(row.id),
        type: row.type,
        title: row.title,
        body: row.body || '',
        link: row.link,
        created_at: row.created_at,
        metadata: parseMetadata(row.metadata_json),
    };
}

function createActivityEvent({ userId, actorId = null, type, title, body = '', link = null, metadata = null }) {
    if (!userId || !type || !title) return null;

    try {
        const result = db.prepare(`
            INSERT INTO activity_events (user_id, actor_id, type, title, body, link, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
            userId,
            actorId || null,
            String(type).slice(0, 80),
            String(title).slice(0, 180),
            body ? String(body).slice(0, 500) : null,
            link ? String(link).slice(0, 300) : null,
            serializeMetadata(metadata)
        );

        return db.prepare(`
            SELECT id, type, title, body, link, metadata_json, created_at
            FROM activity_events
            WHERE id = ?
        `).get(result.lastInsertRowid);
    } catch (error) {
        console.error('Activity logging failed:', error.message);
        return null;
    }
}

function listActivityEvents(userId, options = {}) {
    const limit = clampLimit(options.limit);
    const rows = db.prepare(`
        SELECT id, type, title, body, link, metadata_json, created_at
        FROM activity_events
        WHERE user_id = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?
    `).all(userId, limit);

    return rows.map(shapeActivity);
}

module.exports = {
    createActivityEvent,
    listActivityEvents,
};
