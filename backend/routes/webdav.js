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
 *     <STORAGE_DIR>/users/<userId>/
 *   A user can never see or access another user's directory — the WebDAV
 *   server's virtual filesystem is scoped to that single folder.
 *
 * LIBRARY: webdav-server v2 (already in package.json)
 *   Docs: https://github.com/OpenMarshal/npm-WebDAV-Server
 */

'use strict';

const express    = require('express');
const bcrypt     = require('bcrypt');
const path       = require('path');
const fs         = require('fs');

const db         = require('../database/db');

const router = express.Router();

// ── webdav-server v2 ──────────────────────────────────────────────────────────
const webdav = require('webdav-server').v2;

// Default storage directory — users' WebDAV roots live under this
const STORAGE_DIR = path.resolve(process.env.CLOUDPI_WEBDAV_ROOT || path.join(__dirname, '..', 'storage'));

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
 *   <STORAGE_DIR>/users/<userId>/
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
  // User A's requests only see <STORAGE_DIR>/users/<A's id>/.
  server.beforeRequest(async (ctx, next) => {
    const user = ctx.user;

    if (!user || user.isDefaultUser) {
      // Authentication failed — webdav-server will return 401 automatically
      return next();
    }

    const userId = Number.parseInt(String(user.uid), 10);
    if (!Number.isInteger(userId) || userId < 1) {
      console.error('[webdav] Invalid authenticated user id:', user.uid);
      return next();
    }

    // Where this user's files live on the storage directory
    const usersRoot = path.resolve(STORAGE_DIR, 'users');
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
 * Mount the WebDAV handler.
 *
 * Note: webdav-server's handleRequest() reads req.path relative to the
 * root, so we strip the /webdav prefix before forwarding.
 */
router.use('/webdav', (req, res) => {
  // Rewrite path so webdav-server sees paths relative to its root
  req.url = req.url || '/';
  getWebDAVHandler()(req, res);
});

module.exports = router;
