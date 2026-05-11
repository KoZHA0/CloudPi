/**
 * PROTECTED STORAGE — No-op Compatibility Module
 * ================================================
 * Previously gated internal storage behind LUKS mount status.
 * Now that encryption has moved to the application layer (AES-256-GCM),
 * internal storage is always available — no block-device gating needed.
 *
 * This module is kept as a no-op stub so existing callers don't break.
 */

'use strict';

/**
 * No-op — internal storage is always available under application-level encryption.
 * Previously threw when the LUKS mount was not present.
 */
function ensureProtectedInternalStorageAvailable() {
    // No-op: LUKS gating removed. Internal storage is always accessible.
}

module.exports = {
    ensureProtectedInternalStorageAvailable,
};
