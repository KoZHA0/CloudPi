/**
 * STORAGE STATUS — Internal Storage State Tracker
 * =================================================
 * Tracks the accessibility of internal storage and emits SSE events
 * when the state changes.
 *
 * Previously gated behind LUKS mount status. Now that encryption has moved
 * to the application layer, internal storage is always accessible.
 * The module is retained for its event-bus integration and compatibility
 * with events.js startup reconciliation.
 */

const db = require('../database/db');
const eventBus = require('./event-bus');

const INTERNAL_STORAGE_ID = 'internal';
const INTERNAL_STORAGE_FALLBACK_LABEL = 'Internal Storage';

function getInternalStorageRow() {
    return db.prepare('SELECT id, label, is_accessible FROM storage_sources WHERE id = ?').get(INTERNAL_STORAGE_ID);
}

function getInternalStorageLabel() {
    return getInternalStorageRow()?.label || INTERNAL_STORAGE_FALLBACK_LABEL;
}

/**
 * Internal storage is always accessible under application-level encryption.
 * @returns {boolean}
 */
function isInternalStorageAccessible() {
    return true;
}

function emitStorageStatusChange(sourceId, label, status) {
    eventBus.emit('drive_status_change', {
        source_id: sourceId,
        label,
        status,
        timestamp: Date.now(),
    });
}

function syncInternalStorageState(options = {}) {
    const { emitOnChange = true, forceEmit = false } = options;
    const row = getInternalStorageRow();
    const label = row?.label || INTERNAL_STORAGE_FALLBACK_LABEL;
    const accessible = true; // Always accessible without LUKS
    const nextValue = 1;
    const previousValue = row?.is_accessible ? 1 : 0;
    const changed = previousValue !== nextValue;

    if (row && changed) {
        db.prepare('UPDATE storage_sources SET is_accessible = ? WHERE id = ?').run(nextValue, INTERNAL_STORAGE_ID);
    }

    if ((emitOnChange && changed) || forceEmit) {
        emitStorageStatusChange(INTERNAL_STORAGE_ID, label, 'online');
    }

    return {
        source_id: INTERNAL_STORAGE_ID,
        label,
        status: 'online',
        is_accessible: true,
    };
}

/**
 * No-op — polling is no longer needed since internal storage is always available.
 * Kept for API compatibility with events.js.
 */
function startInternalStorageMonitor(intervalMs = 2000) {
    // No-op: LUKS polling removed
}

module.exports = {
    INTERNAL_STORAGE_ID,
    emitStorageStatusChange,
    getInternalStorageLabel,
    isInternalStorageAccessible,
    startInternalStorageMonitor,
    syncInternalStorageState,
};
