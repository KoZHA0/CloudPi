# Walkthrough: LUKS → AES-256-GCM Encryption Migration

## Problem
The LUKS block-level encryption created a three-layer hardware stack (physical device → device mapper → filesystem) that became a zombie state on sudden USB disconnection. The device mapper layer persisted after drive removal, causing the backend to hang before the udev notification could arrive.

## Solution
Replace LUKS with **application-level AES-256-GCM streaming encryption**. This moves the encryption boundary from the OS/block layer into Node.js itself, eliminating the device mapper entirely.

---

## Changes Made

### Backend — Crypto Foundation

#### [crypto-utils.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/utils/crypto-utils.js)
- **New**: Full streaming AES-256-GCM encrypt/decrypt module
- Master key loaded from `CLOUDPI_ENCRYPTION_KEY` env var once at startup
- Binary format: `[12-byte IV][16-byte Auth Tag][Ciphertext]`
- `encryptFile(src, dest)` — streaming file encryption
- `decryptToStream(filePath, res)` — decrypt and pipe to HTTP response
- `createDecryptStream(filePath)` — returns readable stream for ZIP packing
- `isEncryptionEnabled(db)` — checks admin toggle

#### [db.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/database/db.js)
- Added `encryption_auth_tag` TEXT column to files table
- Added `integrity_failed` INTEGER column (flags corrupted files)
- Seeded `encryption_enabled` = `'0'` in settings table

---

### Backend — Upload Pipeline

#### [files.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/routes/files.js) — `uploadWorker()`
- SHA-256 hash computed on **plaintext before encryption** (consistent across IVs)
- If `encryption_enabled`, writes `.enc` temp file, then atomically replaces original
- On encryption failure mid-write (drive pull), cleans up `.enc` and either:
  - Throws if original file is also gone (drive disconnected)
  - Falls back to unencrypted storage (graceful degradation)
- Stores `encrypted`, `e2ee_iv`, `encryption_auth_tag` in DB row

---

### Backend — Download/Preview Decryption

#### [files.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/routes/files.js) — Download/Preview/Thumbnail
- `GET /:id/preview` — checks `file.encrypted === 1`, pipes through `decryptToStream()`
- `GET /:id/download` — same decryption for single files; folder ZIP collects `encrypted` flag per child and uses `createDecryptStream()` for encrypted entries
- `GET /:id/thumbnail` — returns 400 for encrypted files (avoids writing decrypted temp files on Pi)
- Integrity failures update `integrity_failed` column and return 500

#### [shares.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/routes/shares.js)
- All 5 content-serving endpoints updated:
  - Shared-folder single file download
  - Shared-folder ZIP download  
  - Public link download
  - Public link preview
- Each checks `encrypted` / `share.encrypted` flag and decrypts on-the-fly

---

### Backend — Admin & Settings

#### [admin.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/routes/admin.js)
- Added `encryption_enabled` to the settings whitelist (numeric key, 0/1)
- New `GET /api/admin/encryption-stats` endpoint returning:
  - `encryption_enabled` (boolean)
  - `encrypted_files` / `unencrypted_files` counts
  - `integrity_failed_files` count
- Removed `isReservedLuksStoragePath` function and its guard calls
- Removed `LUKS_MOUNT_POINT` constant

---

### Backend — LUKS Cleanup

| File | Action |
|------|--------|
| [luks.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/utils/) | **Deleted** |
| [protected-storage.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/utils/protected-storage.js) | Converted to **no-op stub** (preserves API for callers) |
| [storage-status.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/utils/storage-status.js) | `isInternalStorageAccessible()` always returns `true`; monitor is no-op |
| [webdav.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/routes/webdav.js) | Rewritten without LUKS gate, LUKS API endpoints, or LUKS rate limiting |
| [server.js](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/server.js) | LUKS logging and route registration removed (done in prior session) |

---

### Frontend

#### [api.ts](file:///c:/Users/kozhi/Desktop/Cloudpi/frontend/src/lib/api.ts)
- Added `EncryptionStats` interface and `getEncryptionStats()` function
- Removed `LuksStatus` interface, `getLuksStatus()`, `unlockLuksDrive()`, `lockLuksDrive()`

#### [settings-content.tsx](file:///c:/Users/kozhi/Desktop/Cloudpi/frontend/src/components/settings-content.tsx)
- New "File Encryption" card with:
  - Toggle switch for `encryption_enabled`
  - Three stat tiles: Encrypted / Unencrypted / Integrity Issues
  - Explanatory footer text

#### [admin-content.tsx](file:///c:/Users/kozhi/Desktop/Cloudpi/frontend/src/components/admin-content.tsx)
- Removed entire LUKS Manager card (status indicators, unlock/lock buttons, info box)
- Removed LUKS unlock dialog
- Removed all LUKS state variables, useEffect polling, and handler functions
- Removed LUKS imports

#### [files-content.tsx](file:///c:/Users/kozhi/Desktop/Cloudpi/frontend/src/components/files-content.tsx)
- Updated internal storage disconnection message to remove LUKS reference

---

### Infrastructure

#### [docker-compose.yml](file:///c:/Users/kozhi/Desktop/Cloudpi/docker-compose.yml)
- Removed `LUKS_DEVICE`, `LUKS_MAPPER_NAME`, `LUKS_MOUNT_POINT`, `CLOUDPI_INTERNAL_STORAGE_REQUIRES_LUKS` env vars
- Removed `/media/cloudpi-data` volume mount
- Removed LUKS-related comments

#### [.env.example](file:///c:/Users/kozhi/Desktop/Cloudpi/backend/.env.example)
- Removed LUKS configuration section
- Updated `CLOUDPI_ENCRYPTION_KEY` description to reflect AES-256-GCM role

---

## Drive Disconnection Handling

The new encryption architecture is **fully compatible** with the existing event-driven drive disconnection system:

1. **No device mapper dependency** — encrypted files are regular files on the filesystem, so `udev` events propagate cleanly
2. **Upload mid-disconnect** — if the drive is pulled during encryption, the `.enc` temp file is cleaned up and the upload fails gracefully with a descriptive error
3. **Download mid-disconnect** — `decryptToStream()` reads from disk; if I/O fails (ENOENT/EIO), the stream errors and the response returns 503
4. **Drive accessibility checks** — all handlers still verify `isDriveActuallyPresent()` before attempting file access, ensuring consistent 503 responses for disconnected drives
