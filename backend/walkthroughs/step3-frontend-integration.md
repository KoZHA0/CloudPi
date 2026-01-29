# Step 3: Connecting Frontend to Backend

## What Was Created

Connected the Next.js frontend to the Express.js backend API.

## New Files

| File | Purpose |
|------|---------|
| `lib/api.ts` | API utility with auth functions and token management |
| `contexts/auth-context.tsx` | React context providing auth state to all components |
| `components/providers.tsx` | Client-side wrapper for context providers |

## Files Modified

| File | Changes |
|------|---------|
| `app/layout.tsx` | Wrapped app with AuthProvider |
| `app/auth/login/page.tsx` | Connected to real login API with error display |
| `app/auth/register/page.tsx` | Connected to real register API with error display |
| `components/sidebar.tsx` | Conditional login button vs user menu based on auth state |

## Key Concepts

### Token Storage
- JWT token stored in `localStorage` under key `cloudpi_token`
- Token automatically added to API requests via `Authorization` header

### Auth Context
Provides these values to all components:
```typescript
const { user, isAuthenticated, isLoading, login, logout, register } = useAuth()
```

### Conditional Rendering
Sidebar now shows:
- **Sign In button** when `!isAuthenticated`
- **User dropdown with logout** when `isAuthenticated`

## How to Test

1. Start both servers:
   ```bash
   # Terminal 1 - Backend
   cd backend && node server.js
   
   # Terminal 2 - Frontend
   npm run dev
   ```

2. Open http://localhost:3000
3. Click **Sign In** in sidebar
4. Register a new account or login
5. After login, sidebar shows your username
6. Click Sign out to logout
