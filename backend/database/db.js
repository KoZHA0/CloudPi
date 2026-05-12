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
const {
  ensureFileVersioningSchema,
  migrateDuplicateActiveSiblings,
  createFileVersionUniqueIndexes,
} = require("../utils/file-versioning");

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
    accessed_at DATETIME DEFAULT NULL,
    version_number INTEGER NOT NULL DEFAULT 1,
    storage_source_id TEXT REFERENCES storage_sources(id),
    sha256_hash TEXT DEFAULT NULL,
    encrypted INTEGER DEFAULT 0,
    encryption_auth_tag TEXT DEFAULT NULL,
    integrity_failed INTEGER DEFAULT 0,
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

function tableSqlReferences(tableName, referencedTableName) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return !!row?.sql && row.sql.includes(referencedTableName);
}

function repairStaleFilesLegacyForeignKeys() {
  const staleTables = ["shares", "folder_locks", "vault_upload_sessions"]
    .filter((tableName) => tableSqlReferences(tableName, "files_legacy"));

  if (staleTables.length === 0) {
    return;
  }

  console.log(`🛠️ Repairing stale files_legacy foreign keys in ${staleTables.join(", ")}...`);

  db.pragma("foreign_keys = OFF");
  try {
    db.transaction(() => {
      if (staleTables.includes("folder_locks")) {
        db.exec(`
          ALTER TABLE folder_locks RENAME TO folder_locks_fk_repair_old;
          CREATE TABLE folder_locks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_id INTEGER NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            salt TEXT NOT NULL,
            encrypted_dek TEXT NOT NULL,
            dek_iv TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (folder_id) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          );
          INSERT INTO folder_locks (id, folder_id, user_id, salt, encrypted_dek, dek_iv, created_at)
          SELECT id, folder_id, user_id, salt, encrypted_dek, dek_iv, created_at
          FROM folder_locks_fk_repair_old;
          DROP TABLE folder_locks_fk_repair_old;
        `);
        syncAutoincrementSequence("folder_locks");
      }

      if (staleTables.includes("vault_upload_sessions")) {
        db.exec(`
          ALTER TABLE vault_upload_sessions RENAME TO vault_upload_sessions_fk_repair_old;
          CREATE TABLE vault_upload_sessions (
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
          );
          INSERT INTO vault_upload_sessions (
            id, user_id, vault_root_id, parent_id, storage_source_id, storage_id,
            mime_type, size, chunk_count, encrypted_metadata, e2ee_iv, temp_path, created_at
          )
          SELECT
            id, user_id, vault_root_id, parent_id, storage_source_id, storage_id,
            mime_type, size, chunk_count, encrypted_metadata, e2ee_iv, temp_path, created_at
          FROM vault_upload_sessions_fk_repair_old;
          DROP TABLE vault_upload_sessions_fk_repair_old;
        `);
      }

      if (staleTables.includes("shares")) {
        const hasSharedWith = hasColumn("shares", "shared_with");
        db.exec(`
          ALTER TABLE shares RENAME TO shares_fk_repair_old;
          CREATE TABLE shares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_id INTEGER NOT NULL,
            shared_by INTEGER NOT NULL,
            shared_with_email TEXT,
            permission TEXT DEFAULT 'view',
            share_link TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            share_type TEXT DEFAULT 'user',
            expires_at DATETIME DEFAULT NULL,
            password_hash TEXT DEFAULT NULL,
            allow_download INTEGER DEFAULT 1,
            access_count INTEGER DEFAULT 0,
            last_accessed_at DATETIME DEFAULT NULL,
            shared_with INTEGER REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
            FOREIGN KEY (shared_by) REFERENCES users(id) ON DELETE CASCADE
          );
        `);
        if (hasSharedWith) {
          db.exec(`
            INSERT INTO shares (
              id, file_id, shared_by, shared_with_email, permission, share_link, created_at,
              share_type, expires_at, password_hash, allow_download, access_count, last_accessed_at,
              shared_with
            )
            SELECT
              id, file_id, shared_by, shared_with_email, permission, share_link, created_at,
              CASE WHEN shared_with IS NULL THEN 'link' ELSE 'user' END,
              NULL, NULL, 1, 0, NULL, shared_with
            FROM shares_fk_repair_old;
          `);
        } else {
          db.exec(`
            INSERT INTO shares (
              id, file_id, shared_by, shared_with_email, permission, share_link, created_at,
              share_type, expires_at, password_hash, allow_download, access_count, last_accessed_at,
              shared_with
            )
            SELECT
              id, file_id, shared_by, shared_with_email, permission, share_link, created_at,
              'link', NULL, NULL, 1, 0, NULL, NULL
            FROM shares_fk_repair_old;
          `);
        }
        db.exec("DROP TABLE shares_fk_repair_old;");
        syncAutoincrementSequence("shares");
      }
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }

  console.log("✅ Stale file foreign key repair complete.");
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
          trashed, trashed_at, created_at, modified_at, version_number, storage_source_id,
          sha256_hash, encrypted, encryption_auth_tag, integrity_failed,
          storage_id, encrypted_metadata, e2ee_iv,
          is_chunked, chunk_count, vault_root_id, is_secure_vault
        )
        SELECT
          id, user_id, name, path, type, size, mime_type, parent_id, starred,
          trashed, trashed_at, created_at, modified_at, 1, storage_source_id,
          sha256_hash, encrypted, NULL, 0,
          storage_id, encrypted_metadata, e2ee_iv,
          is_chunked, chunk_count, vault_root_id, is_secure_vault
        FROM files_legacy;
        DROP TABLE files_legacy;
      `);

      syncAutoincrementSequence("files");
    })();
  } finally {
    db.pragma("foreign_keys = ON");
  }

  repairStaleFilesLegacyForeignKeys();

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
    share_type TEXT DEFAULT 'user',
    expires_at DATETIME DEFAULT NULL,
    password_hash TEXT DEFAULT NULL,
    allow_download INTEGER DEFAULT 1,
    access_count INTEGER DEFAULT 0,
    last_accessed_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
    FOREIGN KEY (shared_by) REFERENCES users(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS share_access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id INTEGER NOT NULL,
    accessed_by INTEGER DEFAULT NULL,
    ip_address TEXT,
    user_agent TEXT,
    action TEXT DEFAULT 'view',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE,
    FOREIGN KEY (accessed_by) REFERENCES users(id) ON DELETE SET NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS share_shortcuts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    share_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, share_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (share_id) REFERENCES shares(id) ON DELETE CASCADE
  )
`);

/**
 * NOTIFICATIONS TABLE
 * -------------------
 * In-app notifications for user-facing events such as private shares.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link TEXT,
    metadata_json TEXT,
    read_at DATETIME DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read_at)`);

db.exec(`
  CREATE TABLE IF NOT EXISTS notification_states (
    user_id INTEGER NOT NULL,
    state_key TEXT NOT NULL,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, state_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id INTEGER PRIMARY KEY,
    share_notifications INTEGER DEFAULT 1,
    storage_warnings INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

/**
 * ACTIVITY EVENTS TABLE
 * ---------------------
 * Lightweight user-visible activity history for dashboard feeds.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    actor_id INTEGER DEFAULT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    link TEXT,
    metadata_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
  )
`);

db.exec(`CREATE INDEX IF NOT EXISTS idx_activity_events_user_created ON activity_events(user_id, created_at DESC)`);

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

// Track the last time a file was opened in the browser preview.
try {
  db.exec(`ALTER TABLE files ADD COLUMN accessed_at DATETIME DEFAULT NULL`);
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
  ["encryption_enabled", "0", "Enable AES-256-GCM encryption for new file uploads (0=disabled, 1=enabled)"],
  ["trash_retention_days", "30", "Days to keep items in Trash before permanent deletion"],
];

const insertSetting = db.prepare(
  "INSERT OR IGNORE INTO settings (key, value, description) VALUES (?, ?, ?)",
);
for (const [key, value, desc] of defaultSettings) {
  insertSetting.run(key, value, desc);
}

// encryption_enabled is now a permanent setting — no longer deleted

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

try {
  db.exec(`ALTER TABLE shares ADD COLUMN share_type TEXT DEFAULT 'user'`);
  db.exec(`UPDATE shares SET share_type = CASE WHEN shared_with IS NULL THEN 'link' ELSE 'user' END WHERE share_type IS NULL`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE shares ADD COLUMN expires_at DATETIME DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE shares ADD COLUMN password_hash TEXT DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE shares ADD COLUMN allow_download INTEGER DEFAULT 1`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE shares ADD COLUMN access_count INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore
}

try {
  db.exec(`ALTER TABLE shares ADD COLUMN last_accessed_at DATETIME DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore
}

db.exec(`UPDATE shares SET share_type = CASE WHEN shared_with IS NULL THEN 'link' ELSE 'user' END WHERE share_type IS NULL`);
db.exec(`UPDATE shares SET allow_download = 1 WHERE allow_download IS NULL`);
db.exec(`UPDATE shares SET access_count = 0 WHERE access_count IS NULL`);

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

// Add encryption_auth_tag for AES-256-GCM authentication tag storage
try {
  db.exec(`ALTER TABLE files ADD COLUMN encryption_auth_tag TEXT DEFAULT NULL`);
} catch (e) {
  // Column already exists, ignore
}

// Add integrity_failed flag for files that fail auth tag verification
try {
  db.exec(`ALTER TABLE files ADD COLUMN integrity_failed INTEGER DEFAULT 0`);
} catch (e) {
  // Column already exists, ignore
}

migrateLegacyFilesTable();
repairStaleFilesLegacyForeignKeys();
ensureFileVersioningSchema(db);
const versioningMigration = migrateDuplicateActiveSiblings(db);
if (
  versioningMigration.renamed ||
  versioningMigration.fileRowsMerged ||
  versioningMigration.folderRowsMerged ||
  versioningMigration.sharesMoved
) {
  console.log(
    `✅ File versioning migration resolved duplicates: ` +
    `${versioningMigration.fileRowsMerged} file row(s) merged, ` +
    `${versioningMigration.folderRowsMerged} folder row(s) merged, ` +
    `${versioningMigration.renamed} item(s) renamed, ` +
    `${versioningMigration.sharesMoved} share reference(s) moved.`
  );
}
createFileVersionUniqueIndexes(db);

// Export the database connection so other files can use it
module.exports = db;
