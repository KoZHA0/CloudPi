const db = require('../database/db');
const eventBus = require('./event-bus');
const {
    isProtectedInternalStorageRequired,
    isProtectedMountAvailable,
} = require('./protected-storage');

const INTERNAL_STORAGE_ID = 'internal';
const INTERNAL_STORAGE_FALLBACK_LABEL = 'Internal Storage';

let internalStorageMonitor = null;

function getInternalStorageRow() {
    return db.prepare('SELECT id, label, is_accessible FROM storage_sources WHERE id = ?').get(INTERNAL_STORAGE_ID);
}

function getInternalStorageLabel() {
    return getInternalStorageRow()?.label || INTERNAL_STORAGE_FALLBACK_LABEL;
}

function isInternalStorageAccessible() {
    if (!isProtectedInternalStorageRequired()) {
        return true;
    }
    return isProtectedMountAvailable();
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
    const accessible = isInternalStorageAccessible();
    const nextValue = accessible ? 1 : 0;
    const previousValue = row?.is_accessible ? 1 : 0;
    const changed = previousValue !== nextValue;

    if (row && changed) {
        db.prepare('UPDATE storage_sources SET is_accessible = ? WHERE id = ?').run(nextValue, INTERNAL_STORAGE_ID);
    }

    if ((emitOnChange && changed) || forceEmit) {
        emitStorageStatusChange(INTERNAL_STORAGE_ID, label, accessible ? 'online' : 'offline');
    }

    return {
        source_id: INTERNAL_STORAGE_ID,
        label,
        status: accessible ? 'online' : 'offline',
        is_accessible: accessible,
    };
}

function startInternalStorageMonitor(intervalMs = 2000) {
    if (!isProtectedInternalStorageRequired() || internalStorageMonitor) {
        return;
    }

    internalStorageMonitor = setInterval(() => {
        try {
            syncInternalStorageState({ emitOnChange: true });
        } catch (error) {
            console.error('[storage-status] Internal storage monitor error:', error.message);
        }
    }, intervalMs);

    if (typeof internalStorageMonitor.unref === 'function') {
        internalStorageMonitor.unref();
    }
}

module.exports = {
    INTERNAL_STORAGE_ID,
    emitStorageStatusChange,
    getInternalStorageLabel,
    isInternalStorageAccessible,
    startInternalStorageMonitor,
    syncInternalStorageState,
};
