/**
 * EVENT BUS — In-Process Event Emitter
 * =====================================
 * Lightweight pub/sub for broadcasting real-time events to SSE clients.
 *
 * Events:
 *   'drive_status_change' → { source_id, label, status: 'online'|'offline' }
 *
 * Usage:
 *   const eventBus = require('./event-bus');
 *   eventBus.emit('drive_status_change', { source_id: '...', status: 'offline', label: 'My USB' });
 *   eventBus.on('drive_status_change', (data) => { ... });
 */

const EventEmitter = require('events');

const eventBus = new EventEmitter();

// Support up to 100 concurrent SSE client listeners
eventBus.setMaxListeners(100);

module.exports = eventBus;
