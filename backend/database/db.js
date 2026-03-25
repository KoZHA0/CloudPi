/**
 * DATABASE CONNECTION MODULE
 * ==========================
 * This file sets up the SQLite database connection and creates all tables.
 *
 * WHY SEPARATE FILE?
 * - Keeps database logic organized in one place
 * - Can be imported by any route file that needs database access
 * - Makes it easy to add new tables later
 */

const Database = require("better-sqlite3");
const path = require("path");

// Create database file in the backend folder
// path.join ensures it works on Windows, Mac, and Linux
const dbPath = path.join(__dirname, "..", "cloudpi.db");
const db = new Database(dbPath);

// Enable foreign keys (SQLite has them disabled by default!)
db.pragma("foreign_keys = ON");

/**
 * USERS TABLE
 * -----------
 * Stores user account information
 * - password will store a HASHED password (never store plain text!)
 * - is_admin: 1 for admin users, 0 for regular users
 * - token_version: Incremented to invalidate all existing tokens for a user
 * - backup_code: Hashed one-time recovery code (super admin only)
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT DEFAULT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    token_version INTEGER DEFAULT 1,
    backup_code TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add is_admin column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore error
}

// Add token_version column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE users ADD COLUMN token_version INTEGER DEFAULT 1`);
} catch (e) {
  // Column already exists, ignore error
}

// Add backup_code column if it doesn't exist (for existing databases)
try {
  db.exec(`ALTER TABLE users ADD COLUMN backup_code TEXT DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore error
}

/**
 * FILES TABLE
 * -----------
 * Stores metadata about uploaded files and folders
 *
 * KEY FIELDS:
 * - user_id: Links file to owner (foreign key to users)
 * - parent_id: Links to parent folder (NULL = root level)
 * - path: Actual file path on disk
 * - type: 'folder', 'document', 'image', 'video', 'audio', 'archive'
 * - starred: For quick access feature
 * - trashed: Soft delete (moves to trash instead of permanent delete)
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER DEFAULT 0,
    mime_type TEXT,
    parent_id INTEGER,
    starred INTEGER DEFAULT 0,
    trashed INTEGER DEFAULT 0,
    trashed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES files(id) ON DELETE CASCADE
  )
`);

/**
 * SHARES TABLE
 * ------------
 * Handles file/folder sharing
 *
 * KEY FIELDS:
 * - file_id: Which file/folder is being shared
 * - shared_by: User who created the share
 * - shared_with_email: Email of recipient (NULL for public link)
 * - permission: 'view' (read-only) or 'edit' (can modify)
 * - share_link: Unique URL for link sharing
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    shared_by INTEGER NOT NULL,
    shared_with_email TEXT,
    permission TEXT DEFAULT 'view',
    share_link TEXT UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (shared_by) REFERENCES users(id) ON DELETE CASCADE
  )
`);

/**
 * SETTINGS TABLE
 * --------------
 * Key-value store for admin-configurable settings.
 * Used for rate limits, upload limits, and other server configuration.
 * The super admin can change these from the Settings page.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT
  )
`);

/**
 * STORAGE SOURCES TABLE
 * ---------------------
 * Tracks all storage locations (internal + external drives).
 * Each source has a UUID stored as a .cloudpi-id file on the drive.
 * When a drive is unplugged, is_active can be set to 0.
 * Files reference their storage source so we know where to find them on disk.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS storage_sources (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    path TEXT NOT NULL,
    type TEXT DEFAULT 'external',
    is_active INTEGER DEFAULT 1,
    total_bytes INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add storage_source_id to files table (for existing databases)
try {
  db.exec(
    `ALTER TABLE files ADD COLUMN storage_source_id TEXT REFERENCES storage_sources(id)`,
  );
} catch (e) {
  // Column already exists, ignore
}

// Add default_storage_id to users table — admin can assign each user a default storage
try {
  db.exec(
    `ALTER TABLE users ADD COLUMN default_storage_id TEXT REFERENCES storage_sources(id)`,
  );
} catch (e) {
  // Column already exists, ignore
}

// Seed default settings (INSERT OR IGNORE = don't overwrite existing values)
const defaultSettings = [
  ["rate_limit_api_max", "100", "Max API requests per 15 minutes per IP"],
  ["rate_limit_api_window", "15", "API rate limit window in minutes"],
  [
    "rate_limit_auth_max",
    "10",
    "Max login/recovery attempts per 15 minutes per IP",
  ],
  ["rate_limit_auth_window", "15", "Auth rate limit window in minutes"],
  ["rate_limit_upload_max", "10", "Max file uploads per 15 minutes per IP"],
  ["rate_limit_upload_window", "15", "Upload rate limit window in minutes"],
];

const insertSetting = db.prepare(
  "INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)",
);
for (const [key, value, desc] of defaultSettings) {
  insertSetting.run(key, value, desc);
}

// Seed internal storage source (the existing backend/storage/ directory)
const internalStoragePath = path.join(__dirname, "..", "storage");
const INTERNAL_STORAGE_ID = "internal";
db.prepare(
  `
  INSERT OR IGNORE INTO storage_sources (id, label, path, type, is_active)
  VALUES (?, ?, ?, 'internal', 1)
`,
).run(INTERNAL_STORAGE_ID, "Internal Storage", internalStoragePath);

// Assign existing files (with no storage_source_id) to internal storage
db.prepare(
  `
  UPDATE files SET storage_source_id = ? WHERE storage_source_id IS NULL
`,
).run(INTERNAL_STORAGE_ID);

console.log("✅ Database tables initialized!");

// Add shared_with column to shares if it doesn't exist (for user-to-user sharing)
try {
  db.exec(
    `ALTER TABLE shares ADD COLUMN shared_with INTEGER REFERENCES users(id) ON DELETE CASCADE`,
  );
} catch (e) {
  // Column already exists, ignore
}

// Export the database connection so other files can use it
module.exports = db;
