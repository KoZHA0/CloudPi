/**
 * CLOUDPI BACKEND SERVER
 * ======================
 * Main entry point for the Express.js API server
 * 
 * WHAT THIS FILE DOES:
 * 1. Loads environment variables from .env
 * 2. Sets up Express with middleware (cors, json parsing)
 * 3. Imports the database connection (which creates tables)
 * 4. Mounts route handlers
 * 5. Starts the server on configured port
 */

// Load environment variables from .env file (must be first!)
require('dotenv').config();

const express = require('express');
const cors = require('cors');

// Import database - this also initializes all tables!
const db = require('./database/db');

// Create Express app
const app = express();

app.set('trust proxy', 1);

/**
 * MIDDLEWARE SETUP
 * ----------------
 * Middleware are functions that run on every request before your routes
 */

// CORS: allow same-origin requests, local development, and configured origins.
const defaultAllowedOrigins = process.env.NODE_ENV === 'production'
  ? []
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];
const allowedOrigins = (process.env.CLOUDPI_ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean)
  .concat(defaultAllowedOrigins);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());

/**
 * DYNAMIC RATE LIMITING (fully admin-configurable)
 * -------------------------------------------------
 * Custom rate limiter that reads BOTH max and window from the settings DB
 * on every request. Changes take effect immediately — no restart needed.
 *
 * express-rate-limit doesn't support dynamic windowMs, so we built our own.
 * Each IP's request timestamps are stored in memory. On each request:
 * 1. Read current max and window from DB
 * 2. Filter out timestamps older than the window
 * 3. If count >= max, return 429 with a clear error message
 * 4. Otherwise, record this request and continue
 */

// Helper: get a setting value from the database (with fallback)
function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? parseInt(row.value, 10) : fallback;
}

// Factory: creates a dynamic rate limiter middleware
function createDynamicLimiter({ maxKey, maxDefault, windowKey, windowDefault, errorPrefix, skipPaths = [] }) {
  const hits = new Map(); // IP -> [timestamp, timestamp, ...]

  return (req, res, next) => {
    // Skip CORS preflight requests (OPTIONS) — blocking these breaks the browser
    if (req.method === 'OPTIONS') return next();

    // Skip certain paths (e.g., admin settings) so admin doesn't lock themselves out
    if (skipPaths.some(p => req.path.startsWith(p))) return next();

    const max = getSetting(maxKey, maxDefault);
    const windowMinutes = getSetting(windowKey, windowDefault);
    const windowMs = windowMinutes * 60 * 1000;
    const ip = req.ip;
    const now = Date.now();

    // Get existing timestamps and filter out expired ones
    const timestamps = (hits.get(ip) || []).filter(t => now - t < windowMs);

    if (timestamps.length >= max) {
      // Blocked!
      hits.set(ip, timestamps);
      return res.status(429).json({
        error: `${errorPrefix} You've hit the limit of ${max}. Please wait ${windowMinutes} minute(s) before trying again.`
      });
    }

    // Allow — record this request
    timestamps.push(now);
    hits.set(ip, timestamps);

    // Set standard rate limit headers
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(max - timestamps.length));

    next();
  };
}

// Global API limiter (default: 100 per 15 min)
const globalLimiter = createDynamicLimiter({
  maxKey: 'rate_limit_api_max',
  maxDefault: 100,
  windowKey: 'rate_limit_api_window',
  windowDefault: 15,
  errorPrefix: 'Too many requests.',
  skipPaths: ['/admin/settings'],  // Don't lock admin out of settings
});
app.use('/api', globalLimiter);

// Auth limiter (default: 10 per 15 min)
const authLimiter = createDynamicLimiter({
  maxKey: 'rate_limit_auth_max',
  maxDefault: 10,
  windowKey: 'rate_limit_auth_window',
  windowDefault: 15,
  errorPrefix: 'Too many login attempts.',
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/recover', authLimiter);

/**
 * TEST ENDPOINT
 * -------------
 * Simple endpoint to verify the server is running
 * Test it: http://localhost:3001/api/test
 */
app.get('/api/test', (req, res) => {
  res.json({
    message: 'CloudPi Backend is running!',
    database: 'Connected',
    timestamp: new Date().toISOString()
  });
});

/**
 * ROUTES SETUP
 * ------------
 * Import and mount route handlers
 */

// Auth routes (login, setup, get current user)
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Admin routes (user management - admin only)
const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

// File routes (upload, download, folders)
const fileRoutes = require('./routes/files');
app.use('/api/files', fileRoutes);

// Share routes (share links, public access)
const shareRoutes = require('./routes/shares');
app.use('/api/shares', shareRoutes);

// Dashboard routes (stats, system health)
const dashboardRoutes = require('./routes/dashboard');
app.use('/api/dashboard', dashboardRoutes);

// WebDAV + LUKS routes
// - /webdav/*        — Cryptomator-compatible WebDAV endpoint (per-user chroot)
// - /api/luks/status — LUKS drive status (polled by the frontend)
// - /api/luks/unlock — Admin-only: unlock + mount the LUKS drive
// - /api/luks/lock   — Admin-only: lock the LUKS drive
const webdavRoutes = require('./routes/webdav');
app.use('/', webdavRoutes);

// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 CloudPi Backend Server Started!');
  console.log(`   URL:    http://localhost:${PORT}`);
  console.log(`   Test:   http://localhost:${PORT}/api/test`);
  console.log(`   WebDAV: http://localhost:${PORT}/webdav/`);
  // Log the LUKS drive status asynchronously (non-blocking)
  require('./utils/luks').getLuksStatus()
    .then(s => console.log(`   LUKS:   ${s.status.toUpperCase()} (${s.device})`))
    .catch(() => console.log('   LUKS:   status unavailable (running on non-Linux host?)'))
    .finally(() => console.log(''));
});
