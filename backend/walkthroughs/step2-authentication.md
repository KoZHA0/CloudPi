# Step 2: Authentication System

## What Was Created

User authentication with password hashing and JWT tokens.

## New Files

| File | Purpose |
|------|---------|
| `routes/auth.js` | Register, login, token verification endpoints |

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/register` | POST | Create new user |
| `/api/auth/login` | POST | Login, get JWT token |
| `/api/auth/me` | GET | Get current user (requires token) |

## Key Concepts

- **bcrypt**: Hashes passwords (never store plain text!)
- **JWT**: Token stored by frontend to prove user is logged in
- **Salt Rounds**: Set to 10 for Raspberry Pi performance

## Frontend Changes

- Added **Sign In** button to sidebar
- Added **Sign Out** option in user dropdown

## Test Commands

```bash
# Register
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"test","email":"test@test.com","password":"Password123"}'

# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"Password123"}'
```
