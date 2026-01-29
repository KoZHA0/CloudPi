# Migration: Next.js to React + Vite

## What Changed

Migrated from Next.js to plain React + Vite for simpler setup on Raspberry Pi.

## New Project Structure

```
CloudPi/
├── backend/           # Express.js + SQLite (unchanged)
│   ├── server.js
│   ├── database/
│   ├── routes/
│   └── walkthroughs/
│   
└── frontend/          # NEW: React + Vite (replaces Next.js)
    ├── src/
    │   ├── App.tsx           # Main app with React Router
    │   ├── main.tsx          # Entry point
    │   ├── index.css         # Tailwind styles
    │   ├── components/       # UI components
    │   ├── contexts/         # Auth context
    │   ├── lib/              # API utilities
    │   └── pages/            # Page components
    ├── vite.config.ts
    └── package.json
```

## Key Differences

| Next.js | React + Vite |
|---------|--------------|
| `next/link` → `Link` | `react-router-dom` → `Link` |
| `next/navigation` → `useRouter` | `react-router-dom` → `useNavigate` |
| App Router (`app/`) | React Router (`<Routes>`) |
| Server Components | All Client Components |
| `"use client"` directive | Not needed |

## How to Run

```bash
# Terminal 1 - Backend
cd backend
node server.js

# Terminal 2 - Frontend
cd frontend
npm run dev
```

**Frontend:** http://localhost:3000
**Backend:** http://localhost:3001

## What's Still the Same

- All UI components (Button, Card, Input, etc.)
- Auth context and API layer
- Dark theme styling
- Express.js backend with SQLite
