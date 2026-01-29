# Step 1: Backend Foundation

## What Was Created

Set up a modular backend structure with a complete database schema.

## Folder Structure
```
backend/
├── server.js          # Main Express server
├── database/
│   └── db.js          # Database connection + tables
├── uploads/           # File storage directory
└── cloudpi.db         # SQLite database file
```

## Database Tables

| Table | Purpose |
|-------|---------|
| `users` | User accounts (username, email, hashed password) |
| `files` | File/folder metadata (name, path, type, starred, trashed) |
| `shares` | Sharing permissions between users |

## Key Files

- [database/db.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/database/db.js) - Creates all tables on startup
- [server.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/server.js) - Express server with CORS and static file serving

## Test Command
```bash
# Start server
node server.js

# Test endpoint
curl http://localhost:3001/api/test
```
