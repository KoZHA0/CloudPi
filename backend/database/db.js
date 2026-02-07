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

const Database = require('better-sqlite3');
const path = require('path');

// Create database file in the backend folder
// path.join ensures it works on Windows, Mac, and Linux
const dbPath = path.join(__dirname, '..', 'cloudpi.db');
const db = new Database(dbPath);

// Enable foreign keys (SQLite has them disabled by default!)
db.pragma('foreign_keys = ON');

/**
 * USERS TABLE
 * -----------
 * Stores user account information
 * - password will store a HASHED password (never store plain text!)
 * - is_admin: 1 for admin users, 0 for regular users
 * - token_version: Incremented to invalidate all existing tokens for a user
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    token_version INTEGER DEFAULT 1,
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

console.log('✅ Database tables initialized!');

// Export the database connection so other files can use it
module.exports = db;
