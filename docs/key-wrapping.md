# Key-Wrapping Guide

## Overview

CloudPi uses **AES-256-GCM** to encrypt files at rest. By default, a single
server-side master key (stored in `.env`) protects all files. While this prevents
raw-disk attacks on the server, it means that if a USB drive is unplugged and
connected to another device, the files on it cannot be decrypted — the key stays
on the server.

**Per-drive key wrapping** solves this. Each USB drive carries its own
**Data Encryption Key (DEK)** inside a small file called `key.blob`, stored in
the drive's root directory. The DEK is never stored in plaintext; it is wrapped
(encrypted) using a key derived from a user passphrase via **scrypt**. Anyone who
knows the passphrase can unwrap the DEK and decrypt the files, on any machine.

---

## How It Works

```
User passphrase
     │
     │  scrypt(passphrase, per-drive salt)
     ▼
  wrapKey (32 bytes)
     │
     │  AES-256-GCM-Encrypt(DEK, wrapKey, IV)
     ▼
  wrappedDek  ──────────────────────┐
                                    │  written to drive
  salt + IV ────────────────────────┤
                                    ▼
                              key.blob (JSON)
```

At runtime:
1. Admin calls the **unlock** endpoint with the passphrase.
2. CloudPi reads `key.blob`, re-derives `wrapKey` with scrypt, and decrypts the DEK.
3. The DEK is cached in process memory (never on disk).
4. All subsequent uploads and downloads for that drive use the per-drive DEK.
5. When the server restarts, the DEK is lost from memory; the drive must be
   unlocked again.

### Why a password salt?

scrypt is a password-based key derivation function (KDF). Without a per-drive
random salt, two drives protected with the same passphrase would produce
**identical wrapping keys** — an attacker holding both drives could confirm that
the passphrases match, making dictionary attacks cheaper. The 32-byte random salt
stored in `key.blob` ensures that each drive's wrapping key is unique, even if the
passphrase is reused across drives.

---

## key.blob Format

`key.blob` is a UTF-8 JSON file placed in the root of the drive.

```json
{
  "version": 1,
  "kdf": "scrypt",
  "kdfParams": {
    "N": 16384,
    "r": 8,
    "p": 1,
    "salt": "<64 hex chars — 32 random bytes, unique to this drive>"
  },
  "wrapIv": "<24 hex chars — 12 random bytes>",
  "wrappedDek": "<96 hex chars — 32-byte AES-GCM ciphertext + 16-byte auth tag>"
}
```

| Field | Description |
|---|---|
| `version` | Format version (currently `1`). Increment for breaking changes. |
| `kdf` | Key derivation function (`"scrypt"`). |
| `kdfParams.N` | scrypt CPU/memory cost (2^14 = 16 384). Increase for higher security at the cost of unlock time. |
| `kdfParams.r` | scrypt block size (8). |
| `kdfParams.p` | scrypt parallelisation (1). |
| `kdfParams.salt` | Per-drive random salt (hex). Must be at least 16 bytes; we use 32. |
| `wrapIv` | Random IV used for the AES-256-GCM wrapping operation (hex). |
| `wrappedDek` | `AES-256-GCM(DEK, wrapKey, wrapIv)` — ciphertext concatenated with the 16-byte authentication tag (hex). |

### File encryption format (unchanged)

Individual encrypted files retain the existing binary layout:

```
[12 bytes: IV] [16 bytes: Auth Tag] [N bytes: AES-256-GCM ciphertext]
```

The only change is which key is used to create that ciphertext.

---

## Admin API

All key-wrapping endpoints require an admin JWT and are restricted to the
**Super Admin** (user id = 1).

### Set up key-wrapping on a drive (first time)

```http
POST /api/admin/storage/:id/setup-key
Content-Type: application/json
Authorization: Bearer <admin-jwt>

{
  "passphrase": "your-strong-passphrase"
}
```

- Generates a random 32-byte DEK.
- Derives a wrapping key via scrypt.
- Writes `key.blob` to the drive root.
- Caches the DEK in memory (drive is immediately usable).

**Response (201):**
```json
{
  "message": "Key-wrapping set up for \"My USB Drive\". The drive is now unlocked in memory.",
  "source_id": "...",
  "key_blob_path": "/mnt/usb1/key.blob",
  "migration_note": "Existing files encrypted with the server master key are NOT re-encrypted automatically. ..."
}
```

### Unlock a drive (after server restart)

```http
POST /api/admin/storage/:id/unlock
Content-Type: application/json
Authorization: Bearer <admin-jwt>

{
  "passphrase": "your-strong-passphrase"
}
```

- Reads `key.blob`, derives `wrapKey`, decrypts DEK.
- Caches DEK in memory.

### Lock a drive (clear DEK from memory)

```http
POST /api/admin/storage/:id/lock
Authorization: Bearer <admin-jwt>
```

Removes the DEK from process memory. Files on the drive cannot be
encrypted or decrypted until the drive is unlocked again.

### Check key status

```http
GET /api/admin/storage/:id/key-status
Authorization: Bearer <admin-jwt>
```

Returns whether `key.blob` exists and whether the drive is currently unlocked.
**No key material is exposed.**

---

## Decrypting Files Off-Device

Because the DEK and the wrapping metadata are stored in `key.blob` on the drive,
you can decrypt files on any machine:

### Using the CloudPi server on another machine

1. Install CloudPi and register the drive.
2. Call `POST /api/admin/storage/:id/unlock` with the passphrase.
3. Download files normally through the API.

### Manual decryption (Node.js script)

```javascript
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const DRIVE_PATH  = '/media/pi/MyDrive';   // adjust to your mount point
const PASSPHRASE  = 'your-strong-passphrase';
const ENCRYPTED_FILE = path.join(DRIVE_PATH, 'cloudpi-data', '1', 'some-uuid.ext');

// 1. Read key.blob
const blob = JSON.parse(fs.readFileSync(path.join(DRIVE_PATH, 'key.blob'), 'utf8'));
const { N, r, p, salt } = blob.kdfParams;

// 2. Derive wrapKey
const wrapKey = crypto.scryptSync(
    PASSPHRASE,
    Buffer.from(salt, 'hex'),
    32,
    { N, r, p }
);

// 3. Unwrap DEK
const wrappedBuf = Buffer.from(blob.wrappedDek, 'hex');
const wrapIv     = Buffer.from(blob.wrapIv, 'hex');
const ciphertext = wrappedBuf.subarray(0, 32);
const authTag    = wrappedBuf.subarray(32);

const decipher = crypto.createDecipheriv('aes-256-gcm', wrapKey, wrapIv, { authTagLength: 16 });
decipher.setAuthTag(authTag);
const dek = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

// 4. Decrypt the file
const encData    = fs.readFileSync(ENCRYPTED_FILE);
const fileIv     = encData.subarray(0, 12);
const fileTag    = encData.subarray(12, 28);
const fileCipher = encData.subarray(28);

const fileDec = crypto.createDecipheriv('aes-256-gcm', dek, fileIv, { authTagLength: 16 });
fileDec.setAuthTag(fileTag);
const plaintext = Buffer.concat([fileDec.update(fileCipher), fileDec.final()]);

fs.writeFileSync('decrypted-output', plaintext);
console.log('Decrypted successfully!');
```

---

## Migration from the Server Master Key

Existing files encrypted with `CLOUDPI_ENCRYPTION_KEY` (the server `.env` key) are
identified in the database by `encrypted = 1, key_wrapped = 0`. These files
continue to work unchanged; no migration is required for them.

New files uploaded to a drive **after** `setup-key` is run (and while the drive is
unlocked) are stored with `encrypted = 1, key_wrapped = 1` and use the per-drive
DEK.

### To migrate existing files to per-drive encryption:

1. Run `setup-key` on the drive.
2. For each file on the drive with `key_wrapped = 0`:
   a. Download the file (this decrypts it with the master key server-side).
   b. Re-upload the file to the same drive (this re-encrypts it with the DEK).
3. Verify all files show `key_wrapped = 1`.
4. At this point, the drive can be decrypted fully off-device.

> ⚠️  Do not remove `CLOUDPI_ENCRYPTION_KEY` from `.env` until all files on all
> drives have been migrated (`key_wrapped = 1`).

---

## Security Considerations

| Topic | Details |
|---|---|
| **DEK confidentiality** | The DEK is never written to disk in plaintext. It lives only in process memory after unlock. |
| **key.blob confidentiality** | `key.blob` contains only the wrapped (encrypted) DEK. An attacker who copies the file still needs the passphrase to obtain the DEK. |
| **Passphrase strength** | Use a strong passphrase (≥ 12 characters, mixed classes). scrypt makes brute force expensive, but a weak passphrase is still vulnerable. |
| **Drive custody** | If an attacker obtains both the drive (with `key.blob`) and your passphrase, they can decrypt all files. Protect the passphrase as carefully as the drive. |
| **Auth-tag integrity** | AES-256-GCM provides authenticated encryption. Both the DEK wrapping (in `key.blob`) and individual files are protected against tampering. |
| **Server restart** | The DEK is not persisted to disk. Re-unlock each drive after a server restart. |
