# CloudPi - Private Cloud Storage Platform

## Project Overview

CloudPi is a self-hosted private cloud storage solution designed to run on a Raspberry Pi. It provides secure file storage and management with a modern web interface.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│                    (React + Vite + TypeScript)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │  Login   │  │  Setup   │  │ Dashboard │  │  Admin   │     │
│  │  Page    │  │  Page    │  │  Layout   │  │  Panel   │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
│                         │                                    │
│                    Auth Context                              │
│                  (JWT Token Management)                      │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP/REST API
┌─────────────────────────┴───────────────────────────────────┐
│                        Backend                               │
│                    (Node.js + Express)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                   │
│  │   Auth   │  │  Admin   │  │  Profile │                   │
│  │  Routes  │  │  Routes  │  │  Routes  │                   │
│  └──────────┘  └──────────┘  └──────────┘                   │
│                         │                                    │
│                    SQLite Database                           │
│                    (better-sqlite3)                          │
└─────────────────────────────────────────────────────────────┘
```

---

## Features Implemented

### 1. Database Layer

**File:** `backend/database/db.js`

| Table   | Description                                         |
| ------- | --------------------------------------------------- |
| `users` | User accounts with hashed passwords and admin flags |

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

---

### 2. Authentication System

**Files:** `backend/routes/auth.js`, `frontend/src/contexts/auth-context.tsx`

#### API Endpoints

| Method | Endpoint                 | Description                           |
| ------ | ------------------------ | ------------------------------------- |
| GET    | `/api/auth/setup-status` | Check if first-time setup is required |
| POST   | `/api/auth/setup`        | Create first admin account            |
| POST   | `/api/auth/login`        | Authenticate and get JWT token        |
| GET    | `/api/auth/me`           | Get current user info                 |
| PUT    | `/api/auth/profile`      | Update username/email                 |
| PUT    | `/api/auth/password`     | Change password                       |

#### Security Features

- **Password Hashing:** bcrypt with 10 salt rounds
- **JWT Tokens:** 7-day expiration, stored in localStorage
- **Protected Routes:** Dashboard requires authentication

---

### 3. Admin User Management

**Files:** `backend/routes/admin.js`, `frontend/src/components/admin-content.tsx`

#### Permission Hierarchy

| Role                   | Add Users | Delete Users | Delete Admins | Delete Super Admin |
| ---------------------- | --------- | ------------ | ------------- | ------------------ |
| **Super Admin** (id=1) | ✅        | ✅           | ✅            | ❌                 |
| **Other Admins**       | ✅        | ✅           | ❌            | ❌                 |
| **Regular Users**      | ❌        | ❌           | ❌            | ❌                 |

#### API Endpoints

| Method | Endpoint               | Description                          |
| ------ | ---------------------- | ------------------------------------ |
| GET    | `/api/admin/users`     | List all users (admin only)          |
| POST   | `/api/admin/users`     | Create new user (admin only)         |
| DELETE | `/api/admin/users/:id` | Delete user (with permission checks) |

---

### 4. User Profile Management

**Files:** `backend/routes/auth.js`, `frontend/src/components/profile-content.tsx`

- Update username and email
- Change password (requires current password verification)
- Real-time form validation

---

### 5. Frontend Pages

| Page      | Route         | Description                                    |
| --------- | ------------- | ---------------------------------------------- |
| Setup     | `/setup`      | First-time admin creation (only when no users) |
| Login     | `/auth/login` | User authentication                            |
| Dashboard | `/`           | Main overview page                             |
| Files     | `/files`      | File management (UI ready)                     |
| Shared    | `/shared`     | Shared files (UI ready)                        |
| Starred   | `/starred`    | Starred files (UI ready)                       |
| Recent    | `/recent`     | Recent files (UI ready)                        |
| Trash     | `/trash`      | Deleted files (UI ready)                       |
| Profile   | `/profile`    | User profile settings                          |
| Settings  | `/settings`   | App settings                                   |
| Admin     | `/admin`      | User management (admin only)                   |
| 404       | `*`           | Page not found                                 |

---

### 6. Route Protection

**File:** `frontend/src/components/dashboard-layout.tsx`

```
User visits page
       │
       ▼
  Is loading?  ──Yes──► Show spinner
       │
      No
       ▼
Is authenticated? ──No──► Redirect to /auth/login
       │
      Yes
       ▼
  Show dashboard
```

---

### 7. UI Components

Built with **shadcn/ui** component library:

- Button, Input, Label
- Card, Dialog, AlertDialog
- Avatar, Badge, Progress
- DropdownMenu, Checkbox
- Custom Sidebar with mobile support

---

## Project Structure

```
CloudPi/
├── backend/
│   ├── database/
│   │   └── db.js              # SQLite initialization
│   ├── routes/
│   │   ├── auth.js            # Authentication endpoints
│   │   └── admin.js           # Admin user management
│   ├── server.js              # Express server setup
│   ├── package.json
│   └── walkthroughs/          # Documentation
│
└── frontend/
    ├── src/
    │   ├── components/
    │   │   ├── ui/            # shadcn/ui components
    │   │   ├── sidebar.tsx    # Navigation sidebar
    │   │   ├── dashboard-layout.tsx  # Protected layout
    │   │   ├── admin-content.tsx     # Admin panel
    │   │   └── profile-content.tsx   # Profile settings
    │   ├── contexts/
    │   │   └── auth-context.tsx      # Auth state management
    │   ├── lib/
    │   │   ├── api.ts         # API functions
    │   │   └── utils.ts       # Utility functions
    │   ├── pages/
    │   │   ├── login.tsx
    │   │   ├── setup.tsx
    │   │   ├── dashboard.tsx
    │   │   ├── admin.tsx
    │   │   ├── not-found.tsx
    │   │   └── ...
    │   ├── App.tsx            # Router configuration
    │   └── main.tsx           # Entry point
    └── package.json
```

---

## User Flow

### First-Time Setup

1. Start both backend and frontend
2. Navigate to `http://localhost:3000`
3. See Setup page (only appears when database is empty)
4. Create Super Admin account
5. Automatically redirected to login page

### Normal Login

1. Navigate to `http://localhost:3000`
2. Redirected to login page (if not authenticated)
3. Enter credentials
4. Access dashboard and all features

### Admin Operations

1. Login as admin user
2. Click "Admin" link in sidebar (only visible to admins)
3. View all users
4. Create new users (with optional admin flag)
5. Delete users (respecting permission hierarchy)

---

## Security Measures

| Feature              | Implementation                                       |
| -------------------- | ---------------------------------------------------- |
| Password Storage     | bcrypt hashing (10 rounds)                           |
| Authentication       | JWT tokens (7-day expiry)                            |
| Route Protection     | Frontend redirect + Backend middleware               |
| Admin Protection     | `requireAdmin` middleware                            |
| Super Admin          | Cannot be deleted, full control                      |
| CORS                 | Configured for localhost development                 |
| File Encryption      | AES-256-GCM at rest (per-file unique IV)             |
| Drive Key Wrapping   | Per-drive DEK wrapped via scrypt + AES-256-GCM       |
| Portable Decryption  | key.blob on drive root — unlock on any CloudPi device |

---

## Tech Stack

### Backend

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** SQLite (better-sqlite3)
- **Auth:** JWT (jsonwebtoken) + bcrypt

### Frontend

- **Framework:** React 18
- **Build Tool:** Vite
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **UI Components:** shadcn/ui + Radix UI
- **Icons:** Lucide React
- **Routing:** React Router v6

---

## Next Steps (Future Features)

- [ ] File upload/download functionality
- [ ] Folder creation and management
- [ ] File sharing with links
- [ ] Storage quota management
- [ ] File preview (images, videos, documents)
- [ ] Search functionality
- [ ] Activity logs
