/**
 * EVENTS ROUTES — SSE + Drive Webhook
 * ====================================
 * Two responsibilities:
 *
 * 1. GET  /api/events       — Server-Sent Events stream for real-time UI updates.
 *                              Authenticated via ?token=JWT (SSE can't set headers).
 *
 * 2. POST /api/events/drive-change — Webhook called by the udev notification script
 *                                     when a USB drive is plugged/unplugged.
 *                                     Authenticated via X-Udev-Secret header.
 *
 * ARCHITECTURE:
 *   udev rule → cloudpi-drive-notify.sh → POST /drive-change → event-bus → SSE clients
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../database/db');
const eventBus = require('../utils/event-bus');
const { JWT_SECRET } = require('../utils/auth-config');

const router = express.Router();

// ============================================
// SSE ENDPOINT — Real-time push to frontend
// ============================================

/**
 * GET /api/events?token=<JWT>
 *
 * Opens a persistent SSE connection. The frontend subscribes to this to
 * receive drive status changes in real-time (no polling needed).
 *
 * Events sent:
 *   event: drive_status_change
 *   data: { source_id, label, status: 'online'|'offline' }
 *
 *   event: heartbeat
 *   data: { timestamp }
 */
router.get('/', (req, res) => {
    // Authenticate via query string token (SSE/EventSource can't set headers)
    const token = req.query.token;
    if (!token) {
        return res.status(401).json({ error: 'Token required (?token=...)' });
    }

    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Validate token_version
    const user = db.prepare('SELECT token_version, is_disabled FROM users WHERE id = ?').get(decoded.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.is_disabled) return res.status(403).json({ error: 'Account is disabled' });
    if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== (user.token_version || 1)) {
        return res.status(401).json({ error: 'Token invalidated' });
    }

    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',  // Disable nginx buffering for SSE
    });

    // Send initial connection event with current drive statuses
    const sources = db.prepare(
        "SELECT id, label, is_accessible FROM storage_sources WHERE type = 'external'"
    ).all();

    res.write(`event: connected\ndata: ${JSON.stringify({
        message: 'SSE connected',
        drives: sources.map(s => ({
            source_id: s.id,
            label: s.label,
            status: s.is_accessible ? 'online' : 'offline',
        })),
    })}\n\n`);

    // Listen for drive status changes from the event bus
    function onDriveChange(data) {
        res.write(`event: drive_status_change\ndata: ${JSON.stringify(data)}\n\n`);
    }

    eventBus.on('drive_status_change', onDriveChange);

    // Heartbeat every 30 seconds to keep the connection alive
    const heartbeatInterval = setInterval(() => {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);
    }, 30000);

    // Cleanup on client disconnect
    req.on('close', () => {
        eventBus.off('drive_status_change', onDriveChange);
        clearInterval(heartbeatInterval);
    });
});


// ============================================
// UDEV WEBHOOK — Drive plug/unplug events
// ============================================

// HMAC helpers for .cloudpi-id integrity (shared utility)
const { computeDriveHmac, verifyDriveHmac } = require('../utils/drive-hmac');

/**
 * POST /api/events/drive-change
 *
 * Called by the udev notification script (cloudpi-drive-notify.sh) when a
 * USB drive is plugged in or unplugged.
 *
 * Auth: X-Udev-Secret header must match CLOUDPI_UDEV_SECRET env var.
 *
 * Body: {
 *   action: "add" | "remove",
 *   device: "sda1",
 *   path: "/media/pi/sda1"
 * }
 */
router.post('/drive-change', (req, res) => {
    // Authenticate via shared secret
    // .trim() handles Windows CRLF in .env (Docker may include \r in values)
    const secret = (process.env.CLOUDPI_UDEV_SECRET || '').trim();
    if (!secret) {
        console.error('❌ [EVENTS] CLOUDPI_UDEV_SECRET not configured — rejecting drive-change webhook');
        return res.status(500).json({ error: 'Webhook secret not configured' });
    }

    const provided = (req.headers['x-udev-secret'] || '').trim();
    if (!provided || !crypto.timingSafeEqual(Buffer.from(secret), Buffer.from(provided))) {
        console.warn('⚠️ [SECURITY] Unauthorized drive-change webhook attempt');
        return res.status(403).json({ error: 'Invalid secret' });
    }

    const { action, device, path: drivePath } = req.body;

    if (!action || !drivePath) {
        return res.status(400).json({ error: 'action and path are required' });
    }

    console.log(`🔌 [UDEV] Drive event: action=${action}, device=${device || 'unknown'}, path=${drivePath}`);

    if (action === 'remove') {
        handleDriveRemove(drivePath);
    } else if (action === 'add') {
        handleDriveAdd(drivePath);
    } else {
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    res.json({ message: `Drive ${action} event processed` });
});

/**
 * Handle drive removal — mark storage source as inaccessible.
 *
 * IMPORTANT: We verify drive identity, not just path existence.
 * On some Raspberry Pi setups, an internal partition (e.g. boot)
 * sits at the same /media/pi/sda1 path.  When the USB is unplugged
 * the internal partition reappears → fs.existsSync still returns true.
 * By checking .cloudpi-id we know the *registered* drive is truly gone.
 */
function handleDriveRemove(drivePath) {
    // Find storage source by path
    const source = db.prepare(
        "SELECT id, label, path FROM storage_sources WHERE path = ? AND type = 'external'"
    ).get(drivePath);

    if (!source) {
        // Try partial path match (path may have trailing slash differences)
        const allSources = db.prepare(
            "SELECT id, label, path FROM storage_sources WHERE type = 'external'"
        ).all();
        const matched = allSources.find(s =>
            s.path === drivePath ||
            s.path === drivePath + '/' ||
            s.path + '/' === drivePath
        );
        if (!matched) {
            console.log(`🔌 [UDEV] No registered storage source found for path: ${drivePath}`);
            return;
        }
        return markDriveOffline(matched);
    }

    markDriveOffline(source);
}

function markDriveOffline(source) {
    db.prepare('UPDATE storage_sources SET is_accessible = 0 WHERE id = ?').run(source.id);

    const eventData = {
        source_id: source.id,
        label: source.label,
        status: 'offline',
        timestamp: Date.now(),
    };

    console.log(`🔴 [DRIVE] "${source.label}" marked OFFLINE (${source.id})`);
    eventBus.emit('drive_status_change', eventData);
}

/**
 * Handle drive reconnection — verify identity via HMAC, then mark accessible
 */
function handleDriveAdd(drivePath) {
    // Read .cloudpi-id from the drive
    const idFilePath = path.join(drivePath, '.cloudpi-id');

    if (!fs.existsSync(idFilePath)) {
        console.log(`🔌 [UDEV] No .cloudpi-id found at ${drivePath} — ignoring (unregistered drive)`);
        return;
    }

    let driveId = null;
    let hmacValid = false;

    try {
        const content = fs.readFileSync(idFilePath, 'utf8');
        const idMatch = content.match(/drive_id=(.+)/);
        if (idMatch) {
            driveId = idMatch[1].trim();
            const hmacMatch = content.match(/hmac=(.+)/);
            if (hmacMatch) {
                hmacValid = verifyDriveHmac(driveId, hmacMatch[1].trim());
            }
        }
    } catch (err) {
        console.error(`❌ [UDEV] Failed to read .cloudpi-id at ${drivePath}:`, err.message);
        return;
    }

    if (!driveId) {
        console.warn(`⚠️ [UDEV] Invalid .cloudpi-id at ${drivePath} — no drive_id found`);
        return;
    }

    // SECURITY: Verify HMAC to prevent drive identity spoofing
    if (!hmacValid) {
        console.warn(`⚠️ [SECURITY] Drive reconnected at ${drivePath} but HMAC verification FAILED for drive_id=${driveId}. ` +
            `NOT auto-reactivating — admin must manually reactivate via the UI.`);
        return;
    }

    // Verify the storage source exists in our database
    const source = db.prepare('SELECT id, label, is_active FROM storage_sources WHERE id = ?').get(driveId);
    if (!source) {
        console.log(`🔌 [UDEV] Drive ${driveId} has valid .cloudpi-id but is not in the database — ignoring`);
        return;
    }

    // Only reactivate if admin hasn't intentionally deactivated it
    if (!source.is_active) {
        console.log(`🔌 [UDEV] Drive "${source.label}" (${driveId}) reconnected but is_active=0 (admin deactivated). ` +
            `Skipping automatic reactivation.`);
        return;
    }

    // All checks passed — mark as accessible
    db.prepare('UPDATE storage_sources SET is_accessible = 1, path = ? WHERE id = ?').run(drivePath, driveId);

    const eventData = {
        source_id: source.id,
        label: source.label,
        status: 'online',
        timestamp: Date.now(),
    };

    console.log(`🟢 [DRIVE] "${source.label}" verified and marked ONLINE (${driveId}, HMAC ✓)`);
    eventBus.emit('drive_status_change', eventData);
}


// ============================================
// IDENTITY-AWARE DRIVE CHECK
// ============================================

/**
 * Verify that the drive at `drivePath` actually belongs to the registered
 * storage source with `expectedDriveId`.
 *
 * On Raspberry Pi, an internal partition (boot/root) can auto-mount at
 * the same /media/pi/sda1 path.  fs.existsSync alone can't distinguish
 * between the USB drive and this ghost partition.  Checking .cloudpi-id
 * resolves this: if the file is absent or contains a different drive_id,
 * the registered drive is NOT actually present.
 *
 * @param {string} drivePath - Mount point to check (e.g. /media/pi/sda1)
 * @param {string} expectedDriveId - The registered storage source UUID
 * @returns {boolean} True only if the path exists AND .cloudpi-id matches
 */
function isDriveActuallyPresent(drivePath, expectedDriveId) {
    try {
        if (!fs.existsSync(drivePath)) return false;

        const idFile = path.join(drivePath, '.cloudpi-id');
        if (!fs.existsSync(idFile)) {
            // Path exists but no .cloudpi-id → this is NOT our registered drive
            // (likely an internal partition at the same mount point)
            return false;
        }

        const content = fs.readFileSync(idFile, 'utf8');
        const match = content.match(/drive_id=(.+)/);
        if (!match) return false;

        return match[1].trim() === expectedDriveId;
    } catch {
        return false;
    }
}


// ============================================
// STARTUP RECONCILIATION
// ============================================

/**
 * Called once at module load to sync is_accessible with actual filesystem state.
 * Handles the case where drives were plugged/unplugged while the server was down.
 *
 * Uses identity-aware checking (isDriveActuallyPresent) instead of plain
 * fs.existsSync to handle the ghost partition edge case on Raspberry Pi.
 */
function reconcileDriveStates() {
    const sources = db.prepare(
        "SELECT id, label, path, is_active FROM storage_sources WHERE type = 'external'"
    ).all();

    for (const source of sources) {
        // Identity-aware check: verify .cloudpi-id matches, not just path exists
        const accessible = isDriveActuallyPresent(source.path, source.id);

        const currentState = db.prepare('SELECT is_accessible FROM storage_sources WHERE id = ?').get(source.id);
        const wasAccessible = currentState?.is_accessible === 1;

        if (accessible !== wasAccessible) {
            db.prepare('UPDATE storage_sources SET is_accessible = ? WHERE id = ?')
                .run(accessible ? 1 : 0, source.id);
            console.log(`🔄 [STARTUP] Drive "${source.label}" reconciled: ${wasAccessible ? 'online→offline' : 'offline→online'}`);
        }
    }
}

// Export for use by admin.js storage listing cross-check
module.exports = router;
module.exports.isDriveActuallyPresent = isDriveActuallyPresent;

// Run reconciliation on module load
reconcileDriveStates();

