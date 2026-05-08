/**
 * LUKS UTILITIES
 * ==============
 * Interfaces with the Linux `cryptsetup` and `mount` commands to manage
 * the LUKS-encrypted external USB drive at the HOST OS level.
 *
 * SECURITY NOTE:
 *   These utilities call privileged OS commands (cryptsetup, mount).
 *   They must ONLY be called by admin-authenticated API routes.
 *   All external values are passed as discrete argv items (execFile) —
 *   never interpolated into a shell string — preventing shell injection.
 *
 * EXPECTED ENVIRONMENT:
 *   LUKS_DEVICE        - Persistent device reference to unlock
 *                        (recommended: /dev/disk/by-uuid/<luks-uuid>)
 *   LUKS_MAPPER_NAME   - dm-crypt mapper name    (default: cloudpi-data)
 *   LUKS_MOUNT_POINT   - Where to mount the fs   (default: /media/cloudpi-data)
 *
 * HOST OS PRE-REQUISITES:
 *   - `cryptsetup` installed on the Pi host
 *   - The Node process (or a sudo wrapper script) has permission to run
 *     cryptsetup luksOpen / luksClose and mount / umount.
 *   - Recommended: a dedicated sudoers snippet that allows only these exact
 *     commands without a password, rather than running the entire container
 *     as root.  See docs/luks-sudoers.md for the recommended snippet.
 *
 * HOW LUKS WORKS AT A HIGH LEVEL:
 *   1. The USB drive's partition is a LUKS container — all data
 *      on disk is AES-256-XTS encrypted.
 *   2. `cryptsetup luksOpen` decrypts the LUKS header using the passphrase
 *      and creates a transparent block device at /dev/mapper/<name>.
 *   3. The filesystem (ext4 / exfat) inside that block device is then mounted
 *      normally.  Everything written goes through the dm-crypt layer.
 *   4. `cryptsetup luksClose` reverses step 2 — the mapper disappears and the
 *      raw, encrypted bytes on disk are once again inaccessible without the key.
 */

'use strict';

const { execFile } = require('child_process');
const fs           = require('fs');

// ── Configuration (read from environment, with safe defaults) ─────────────────
const LUKS_DEVICE      = process.env.LUKS_DEVICE      || 'UNSET_RUN_LUKS_SETUP';
const MAPPER_NAME      = process.env.LUKS_MAPPER_NAME || 'cloudpi-data';
const MOUNT_POINT      = process.env.LUKS_MOUNT_POINT || '/media/cloudpi-data';
const MAPPER_DEVICE    = `/dev/mapper/${MAPPER_NAME}`;
const MOUNT_MARKER     = process.env.LUKS_MOUNT_MARKER || '.cloudpi-luks-ready';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Promisified execFile.  Uses execFile (not exec) so arguments are never
 * passed through a shell — no injection risk even if an env var contains
 * special characters.
 *
 * @param {string}   cmd  - The executable to run
 * @param {string[]} args - Argument list
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function run(cmd, args = []) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        const message = stderr.trim() || err.message;
        return reject(new Error(`[luks] ${cmd} failed: ${message}`));
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check the current LUKS drive status.
 *
 * Returns a status object that the API can send directly to the frontend:
 *   { status: 'locked' | 'unlocked' | 'mounted' | 'no_device', device, mapperDevice, mountPoint }
 *
 * Status meanings:
 *   no_device  - The configured block device doesn't exist at all (drive unplugged?)
 *   locked     - Block device exists but the LUKS container is not open
 *   unlocked   - LUKS container is open (mapper device exists) but not yet mounted
 *   mounted    - Filesystem is mounted and ready for use
 *
 * @returns {Promise<object>}
 */
async function getLuksStatus() {
  const base = {
    device:       LUKS_DEVICE,
    mapperDevice: MAPPER_DEVICE,
    mountPoint:   MOUNT_POINT,
  };

  const markerPath = `${MOUNT_POINT}/${MOUNT_MARKER}`;

  // Docker deployments often manage LUKS on the host and only bind-mount the
  // decrypted filesystem into the container. In that case the container may
  // not see /dev/disk/by-uuid/... at all, so the mount itself becomes the
  // source of truth.
  if (fs.existsSync(markerPath)) {
    return { ...base, status: 'mounted' };
  }

  // 1. Does the raw block device exist?
  if (!fs.existsSync(LUKS_DEVICE)) {
    return { ...base, status: 'no_device' };
  }

  // 2. Is the LUKS container open? (mapper device exists under /dev/mapper/)
  const mapperExists = fs.existsSync(MAPPER_DEVICE);
  if (!mapperExists) {
    return { ...base, status: 'locked' };
  }

  // 3. Is the filesystem mounted?
  try {
    const { stdout } = await run('findmnt', ['-n', '-o', 'TARGET', MAPPER_DEVICE]);
    if (stdout.includes(MOUNT_POINT)) {
      return { ...base, status: 'mounted' };
    }
  } catch {
    // findmnt returns non-zero if nothing is mounted — that's fine
  }

  return { ...base, status: 'unlocked' };
}

/**
 * Open the LUKS container with the supplied passphrase.
 *
 * Runs: cryptsetup luksOpen <device> <mapperName> --key-file=-
 * The passphrase is piped to stdin so it never appears in the process table.
 *
 * @param {string} passphrase - The LUKS passphrase
 * @returns {Promise<void>}
 * @throws {Error} if the passphrase is wrong or the device is not a LUKS container
 */
function luksOpen(passphrase) {
  if (!passphrase || passphrase.length === 0) {
    return Promise.reject(new Error('Passphrase must not be empty'));
  }

  return new Promise((resolve, reject) => {
    // Pass passphrase via stdin (--key-file=-) — never via argv
    const child = require('child_process').spawn(
      'cryptsetup',
      ['luksOpen', LUKS_DEVICE, MAPPER_NAME, '--key-file=-'],
      { timeout: 30_000 }
    );

    child.stdin.write(passphrase);
    child.stdin.end();

    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });

    child.on('close', code => {
      if (code === 0) return resolve();
      reject(new Error(
        code === 5
          ? 'Wrong passphrase — LUKS authentication failed'
          : `cryptsetup luksOpen failed (exit ${code}): ${stderr.trim()}`
      ));
    });

    child.on('error', err => reject(new Error(`Failed to spawn cryptsetup: ${err.message}`)));
  });
}

/**
 * Mount the decrypted block device (the mapper) at the configured mount point.
 * The mount point directory is created if it doesn't exist.
 *
 * @returns {Promise<void>}
 */
async function mountLuks() {
  // Ensure mount point exists
  if (!fs.existsSync(MOUNT_POINT)) {
    fs.mkdirSync(MOUNT_POINT, { recursive: true });
  }

  // mount will auto-detect the filesystem type (ext4 / exfat)
  await run('mount', [MAPPER_DEVICE, MOUNT_POINT]);
}

/**
 * Unmount the filesystem and then close the LUKS container.
 * Safe to call even if only partially mounted.
 *
 * @returns {Promise<void>}
 */
async function luksClose() {
  // Step 1: Unmount (ignore errors — might not be mounted)
  try {
    await run('umount', [MOUNT_POINT]);
  } catch {
    // Already unmounted — continue to luksClose
  }

  // Step 2: Close the LUKS container
  await run('cryptsetup', ['luksClose', MAPPER_NAME]);
}

/**
 * Convenience: open the LUKS container AND mount the filesystem in one call.
 * This is what the admin "Unlock Drive" button in the Web UI calls.
 *
 * @param {string} passphrase
 * @returns {Promise<void>}
 */
async function unlockAndMount(passphrase) {
  await luksOpen(passphrase);
  await mountLuks();
}

module.exports = {
  getLuksStatus,
  luksOpen,
  mountLuks,
  luksClose,
  unlockAndMount,
  // Expose config constants so routes can reference them
  MOUNT_POINT,
  MAPPER_NAME,
  LUKS_DEVICE,
};
