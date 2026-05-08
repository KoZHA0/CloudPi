/**
 * WEBDAV ROUTE
 * ============
 * Mounts a WebDAV server at /webdav/ so Cryptomator (and any other WebDAV
 * client) can connect to CloudPi and create encrypted vaults.
 *
 * AUTHENTICATION:
 *   WebDAV clients use HTTP Basic Auth (username + password).
 *   Credentials are verified against the existing SQLite `users` table.
 *   The same username/password used in the Web UI works here.
 *
 * USER ISOLATION:
 *   Every user is chrooted to their own directory:
 *     <LUKS_MOUNT_POINT>/users/<userId>/
 *   A user can never see or access another user's directory — the WebDAV
 *   server's virtual filesystem is scoped to that single folder.
 *
 * LUKS GATE:
 *   If the LUKS drive is not mounted, all WebDAV requests are rejected with
 *   503 Service Unavailable. Users get a clear error message in Cryptomator.
 *
 * DRIVE STATUS API:
 *   GET  /api/luks/status        — Returns current LUKS status (public-ish;
 *                                  the frontend polls this to show the
 *                                  "Drive Locked" overlay)
 *   POST /api/luks/unlock        — Admin-only: submit passphrase to unlock
 *   POST /api/luks/lock          — Admin-only: lock drive
 *
 * LIBRARY: webdav-server v2 (already in package.json)
 *   Docs: https://github.com/OpenMarshal/npm-WebDAV-Server
 */

'use strict';

const express    = require('express');
const bcrypt     = require('bcrypt');
const path       = require('path');
const fs         = require('fs');
const jwt        = require('jsonwebtoken');

const db                              = require('../database/db');
const { JWT_SECRET }                  = require('../utils/auth-config');
const { getLuksStatus, unlockAndMount, luksClose, MOUNT_POINT } = require('../utils/luks');
const { syncInternalStorageState }    = require('../utils/storage-status');

const router = express.Router();
const LUKS_UNLOCK_WINDOW_MS = 5 * 60 * 1000;
const LUKS_UNLOCK_MAX_FAILURES = 3;
const luksUnlockFailures = new Map();

// ── webdav-server v2 ──────────────────────────────────────────────────────────
const webdav = require('webdav-server').v2;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify HTTP Basic credentials against the SQLite database.
 * Returns the user row (id, username, is_admin, is_disabled) or null.
 *
 * @param {string} username
 * @param {string} password  (plain-text; bcrypt compared to stored hash)
 * @returns {Promise<object|null>}
 */
async function verifyBasicCredentials(username, password) {
  if (!username || !password) return null;

  const user = db
    .prepare('SELECT id, username, password, is_admin, is_disabled FROM users WHERE username = ?')
    .get(username);

  if (!user || user.is_disabled) return null;

  const match = await bcrypt.compare(password, user.password);
  return match ? user : null;
}

/**
 * Parse the Authorization header for HTTP Basic credentials.
 * Returns { username, password } or null.
 *
 * @param {import('express').Request} req
 * @returns {{ username: string, password: string } | null}
 */
function parseBasicAuth(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Basic ')) return null;

  const b64 = authHeader.slice('Basic '.length);
  let decoded;
  try {
    decoded = Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }

  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) return null;

  return {
    username: decoded.slice(0, colonIdx),
    password: decoded.slice(colonIdx + 1),
  };
}

/**
 * Authenticate a JWT Bearer token from the Authorization header.
 * Returns the user row or null.
 *
 * @param {import('express').Request} req
 * @returns {object|null}
 */
function verifyBearerToken(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return null;

  try {
    const decoded = jwt.verify(authHeader.slice('Bearer '.length), JWT_SECRET);
    return db.prepare('SELECT id, username, is_admin, is_disabled FROM users WHERE id = ?').get(decoded.userId);
  } catch {
    return null;
  }
}

/**
 * Admin-only middleware.  Accepts either JWT Bearer (Web UI) or HTTP Basic
 * (curl / scripted access).
 */
async function requireAdmin(req, res, next) {
  let user = verifyBearerToken(req);

  if (!user) {
    const creds = parseBasicAuth(req);
    if (creds) {
      user = await verifyBasicCredentials(creds.username, creds.password);
    }
  }

  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.user = user;
  next();
}

function getUnlockRateLimitKey(req) {
  return `${req.user?.id || req.user?.username || 'unknown'}:${req.ip || 'unknown'}`;
}

function checkUnlockRateLimit(req, res, next) {
  const key = getUnlockRateLimitKey(req);
  const now = Date.now();
  const current = luksUnlockFailures.get(key);

  if (current && current.lockedUntil && current.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((current.lockedUntil - now) / 1000);
    res.set('Retry-After', String(retryAfterSeconds));
    return res.status(429).json({
      error: `Too many failed unlock attempts. Try again in ${retryAfterSeconds} seconds.`,
    });
  }

  next();
}

function recordUnlockFailure(req) {
  const key = getUnlockRateLimitKey(req);
  const now = Date.now();
  const current = luksUnlockFailures.get(key);
  const attempts = current && current.resetAt > now ? current.attempts + 1 : 1;
  const next = {
    attempts,
    resetAt: now + LUKS_UNLOCK_WINDOW_MS,
    lockedUntil: attempts >= LUKS_UNLOCK_MAX_FAILURES ? now + LUKS_UNLOCK_WINDOW_MS : 0,
  };
  luksUnlockFailures.set(key, next);
}

function clearUnlockFailures(req) {
  luksUnlockFailures.delete(getUnlockRateLimitKey(req));
}

// ─────────────────────────────────────────────────────────────────────────────
// LUKS Status & Control API (mounted at /api/luks/*)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/luks/status
 * Returns the current LUKS drive status without requiring auth.
 * The frontend polls this to decide whether to show the "Drive Locked" overlay.
 *
 * Response:
 *   { status: 'locked' | 'unlocked' | 'mounted' | 'no_device', device, mountPoint }
 */
router.get('/api/luks/status', async (req, res) => {
  try {
    const status = await getLuksStatus();
    res.json(status);
  } catch (err) {
    console.error('[webdav] LUKS status error:', err.message);
    res.status(500).json({ error: 'Could not read LUKS drive status', detail: err.message });
  }
});

/**
 * POST /api/luks/unlock
 * Admin-only.  Accepts the LUKS passphrase and unlocks + mounts the drive.
 *
 * Request body: { passphrase: string }
 * Response:     { message: string, mountPoint: string }
 */
router.post('/api/luks/unlock', requireAdmin, checkUnlockRateLimit, async (req, res) => {
  const { passphrase } = req.body || {};

  if (!passphrase) {
    return res.status(400).json({ error: 'passphrase is required' });
  }

  try {
    const current = await getLuksStatus();

    if (current.status === 'mounted') {
      clearUnlockFailures(req);
      return res.json({ message: 'Drive is already mounted', mountPoint: MOUNT_POINT });
    }

    await unlockAndMount(passphrase);
    clearUnlockFailures(req);
    syncInternalStorageState({ emitOnChange: true, forceEmit: true });

    console.log(`✅ [luks] Drive unlocked and mounted at ${MOUNT_POINT} by admin ${req.user.username}`);
    res.json({ message: 'Drive unlocked and mounted successfully', mountPoint: MOUNT_POINT });
  } catch (err) {
    recordUnlockFailure(req);
    console.error('[luks] Unlock failed:', err.message);

    // Distinguish wrong passphrase (403) from other errors (500)
    const status = err.message.includes('Wrong passphrase') ? 403 : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/luks/lock
 * Admin-only.  Unmounts the filesystem and closes the LUKS container.
 * After this, /media/cloudpi-data is inaccessible until unlocked again.
 */
router.post('/api/luks/lock', requireAdmin, async (req, res) => {
  try {
    await luksClose();
    syncInternalStorageState({ emitOnChange: true, forceEmit: true });
    console.log(`🔒 [luks] Drive locked by admin ${req.user.username}`);
    res.json({ message: 'Drive locked successfully' });
  } catch (err) {
    console.error('[luks] Lock failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WebDAV server (mounted at /webdav/*)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WebDAV user manager that bridges the webdav-server library to our SQLite
 * users table.  Implements HTTP Basic Auth — the password is verified with
 * bcrypt before a user is allowed in.
 */
class CloudPiUserManager extends webdav.SimpleUserManager {
  /**
   * Called by webdav-server for every request to authenticate the user.
   *
   * @param {object}   ctx      - WebDAV request context
   * @param {Function} callback - (error, user) callback
   */
  getDefaultUser(callback) {
    // Return a "not authenticated" sentinel user — real auth happens below
    callback(this.anonymousUser);
  }

  async getUserByNamePassword(username, password, callback) {
    try {
      const user = await verifyBasicCredentials(username, password);
      if (!user) {
        return callback(webdav.Errors.UserNotFound);
      }
      // Create a webdav-server user object with the CloudPi user's id as uid
      callback(null, this.addUser(String(user.id), password, false));
    } catch (err) {
      callback(webdav.Errors.UserNotFound);
    }
  }
}

/**
 * Build a webdav-server v2 instance.
 *
 * Each user gets a separate PhysicalFileSystem rooted at:
 *   <MOUNT_POINT>/users/<userId>/
 *
 * This is done dynamically per-request so we always have the correct user.
 */
function buildWebDAVHandler() {
  const userManager = new CloudPiUserManager();

  const server = new webdav.WebDAVServer({
    httpAuthentication: new webdav.HTTPBasicAuthentication(userManager, 'CloudPi'),
    requireAuthentification: true,
  });

  // Request hook — called for EVERY webdav request after authentication.
  // We mount the user's chrooted PhysicalFileSystem dynamically here so that
  // User A's requests only see /media/cloudpi-data/users/<A's id>/.
  server.beforeRequest(async (ctx, next) => {
    const user = ctx.user;

    if (!user || user.isDefaultUser) {
      // Authentication failed — webdav-server will return 401 automatically
      return next();
    }

    const userId = Number.parseInt(String(user.uid), 10);  // set from DB id in getUserByNamePassword
    if (!Number.isInteger(userId) || userId < 1) {
      console.error('[webdav] Invalid authenticated user id:', user.uid);
      return next();
    }

    // Where this user's files live on the LUKS mount
    const usersRoot = path.resolve(MOUNT_POINT, 'users');
    const userRoot = path.resolve(usersRoot, String(userId));
    if (userRoot !== usersRoot && !userRoot.startsWith(`${usersRoot}${path.sep}`)) {
      console.error('[webdav] Refusing unsafe user root:', userRoot);
      return next();
    }

    // Create the directory if it doesn't exist yet (first login / new user)
    try {
      fs.mkdirSync(userRoot, { recursive: true });
    } catch (mkdirErr) {
      console.error(`[webdav] Cannot create user directory ${userRoot}:`, mkdirErr.message);
      // We'll let the request proceed — the FS mount will fail and return an
      // appropriate WebDAV error to the client
    }

    // Mount a PhysicalFileSystem for this user if not already mounted
    const mountPath = '/';
    try {
      await new Promise((resolve, reject) => {
        server.setFileSystem(
          mountPath,
          new webdav.PhysicalFileSystem(userRoot),
          // allowOverride = true so the same path can be re-mounted across users
          true,
          (success) => (success ? resolve() : reject(new Error('setFileSystem returned false')))
        );
      });
    } catch (fsErr) {
      console.error('[webdav] setFileSystem error:', fsErr.message);
    }

    next();
  });

  return server.handleRequest.bind(server);
}

// Lazily created — only initialised once the first WebDAV request arrives
let _webdavHandler = null;

function getWebDAVHandler() {
  if (!_webdavHandler) {
    _webdavHandler = buildWebDAVHandler();
  }
  return _webdavHandler;
}

/**
 * Middleware that gates all WebDAV traffic behind the LUKS mount status.
 * If the drive is not mounted, a 503 is returned with a human-readable message
 * that appears in Cryptomator's error dialog.
 */
async function luksGate(req, res, next) {
  try {
    const status = await getLuksStatus();
    if (status.status !== 'mounted') {
      res.status(503)
        .set('Content-Type', 'text/plain')
        .send(
          'CloudPi storage is locked.\n' +
          'An administrator must unlock the drive before you can access your vault.\n' +
          `Drive status: ${status.status}`
        );
      return;
    }
    next();
  } catch (err) {
    res.status(500)
      .set('Content-Type', 'text/plain')
      .send('CloudPi storage error: ' + err.message);
  }
}

/**
 * Mount the WebDAV handler.
 *
 * Note: webdav-server's handleRequest() reads req.path relative to the
 * root, so we strip the /webdav prefix before forwarding.
 *
 * We use router.use() with luksGate as a guard, then hand off to the
 * webdav-server request handler.
 */
router.use('/webdav', luksGate, (req, res) => {
  // Rewrite path so webdav-server sees paths relative to its root
  req.url = req.url || '/';
  getWebDAVHandler()(req, res);
});

module.exports = router;
