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

// Database path: configurable via env var (for Docker), falls back to backend root
const dbPath = process.env.CLOUDPI_DB_PATH || path.join(__dirname, "..", "cloudpi.db");
const db = new Database(dbPath);

// Enable foreign keys (SQLite has them disabled by default!)
db.pragma("foreign_keys = ON");

// Enable Write-Ahead Logging (WAL) for massive concurrency improvements
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

const FILES_TABLE_SCHEMA = `
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
    storage_source_id TEXT REFERENCES storage_sources(id),
    sha256_hash TEXT DEFAULT NULL,
    encrypted INTEGER DEFAULT 0,
    storage_id TEXT DEFAULT NULL,
    encrypted_metadata TEXT DEFAULT NULL,
    e2ee_iv TEXT DEFAULT NULL,
    is_chunked INTEGER DEFAULT 0,
    chunk_count INTEGER DEFAULT 0,
    vault_root_id INTEGER REFERENCES files(id),
    is_secure_vault INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES files(id) ON DELETE CASCADE
  )
`;

function hasColumn(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some((column) => column.name === columnName);
}

function syncAutoincrementSequence(tableName) {
  const row = db.prepare(`SELECT COALESCE(MAX(id), 0) AS maxId FROM ${tableName}`).get();
  const maxId = row?.maxId || 0;
  const updated = db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = ?").run(maxId, tableName);
  if (updated.changes === 0) {
    db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)").run(tableName, maxId);
  }
}

function migrateLegacyFilesTable() {
  if (!hasColumn("files", "key_wrapped")) {
    return;
  }

  console.log("🛠️ Migrating files table to remove legacy per-drive encryption metadata...");

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE files RENAME TO files_legacy;
        ${FILES_TABLE_SCHEMA.replace("IF NOT EXISTS ", "")};
        INSERT INTO files (
          id, user_id, name, path, type, size, mime_type, parent_id, starred,
          trashed, trashed_at, created_at, modified_at, storage_source_id,
          sha256_hash, encrypted, storage_id, encrypted_metadata, e2ee_iv,
          is_chunked, chunk_count, vault_root_id, is_secure_vault
        )
        SELECT
          id, user_id, name, path, type, size, mime_type, parent_id, starred,
          trashed, trashed_at, created_at, modified_at, storage_source_id,
          sha256_hash, encrypted, storage_id, encrypted_metadata, e2ee_iv,
          is_chunked, chunk_count, vault_root_id, is_secure_vault
        FROM files_legacy;
        DROP TABLE files_legacy;
      `);

      syncAutoincrementSequence("files");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }

  const foreignKeyIssues = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyIssues.length > 0) {
    throw new Error(`files table migration failed foreign key check: ${JSON.stringify(foreignKeyIssues[0])}`);
  }

  console.log("✅ Files table migration complete. Legacy key_wrapped column removed.");
}

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

// Add 2FA columns
try {
  db.exec(`ALTER TABLE users ADD COLUMN two_factor_secret TEXT DEFAULT NULL`);
  db.exec(`ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore error
}

// Add is_disabled column (disable user without deleting)
try {
  db.exec(`ALTER TABLE users ADD COLUMN is_disabled INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore error
}

// Add failed_login_attempts counter (for account lockout)
try {
  db.exec(`ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore error
}

// Add locked_until timestamp (NULL = not locked)
try {
  db.exec(`ALTER TABLE users ADD COLUMN locked_until DATETIME DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore error
}

// Add email field (optional, for notifications and future password reset)
try {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore error
}

// Add avatar_url field (stores filename of uploaded avatar)
try {
  db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore error
}

/**
 * PASSWORD RESET TOKENS
 * ---------------------
 * Stores one-time use tokens for password recovery.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

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
db.exec(FILES_TABLE_SCHEMA);

db.exec(`
  CREATE TABLE IF NOT EXISTS folder_locks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id INTEGER NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    salt TEXT NOT NULL,
    encrypted_dek TEXT NOT NULL,
    dek_iv TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (folder_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS vault_upload_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    vault_root_id INTEGER NOT NULL,
    parent_id INTEGER NOT NULL,
    storage_source_id TEXT NOT NULL,
    storage_id TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL,
    encrypted_metadata TEXT NOT NULL,
    e2ee_iv TEXT NOT NULL,
    temp_path TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vault_root_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

// Add is_accessible column (system-controlled drive connectivity status)
// Separate from is_active (admin-controlled). is_accessible tracks physical hardware state.
try {
  db.exec(`ALTER TABLE storage_sources ADD COLUMN is_accessible INTEGER DEFAULT 1`);
} catch (e) {
  // Column already exists, ignore
}

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
  ["password_min_length", "8", "Minimum password length"],
  ["account_lockout_attempts", "5", "Failed login attempts before account lockout"],
  ["account_lockout_duration", "15", "Account lockout duration in minutes"],
  ["smtp_host", "", "SMTP server hostname"],
  ["smtp_port", "587", "SMTP server port"],
  ["smtp_user", "", "SMTP authentication username"],
  ["smtp_pass", "", "SMTP authentication password (encrypted)"],
  ["smtp_from_email", "", "Sender email address"],
];

const insertSetting = db.prepare(
  "INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)",
);
for (const [key, value, desc] of defaultSettings) {
  insertSetting.run(key, value, desc);
}

db.prepare("DELETE FROM settings WHERE key = ?").run("encryption_enabled");

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

// Add storage_quota column if it doesn't exist (NULL = unlimited, value in bytes)
try {
  db.exec(`ALTER TABLE users ADD COLUMN storage_quota INTEGER DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore
}

// Add sha256_hash column for file integrity verification
try {
  db.exec(`ALTER TABLE files ADD COLUMN sha256_hash TEXT DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore
}

// Add encrypted flag for client-side vault ciphertext records
try {
  db.exec(`ALTER TABLE files ADD COLUMN encrypted INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE files ADD COLUMN storage_id TEXT DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE files ADD COLUMN encrypted_metadata TEXT DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE files ADD COLUMN e2ee_iv TEXT DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE files ADD COLUMN is_chunked INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE files ADD COLUMN chunk_count INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE files ADD COLUMN vault_root_id INTEGER REFERENCES files(id)`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE files ADD COLUMN is_secure_vault INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore
}

migrateLegacyFilesTable();

// Export the database connection so other files can use it
module.exports = db;
