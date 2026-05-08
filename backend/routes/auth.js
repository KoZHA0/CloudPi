/**
 * AUTHENTICATION ROUTES
 * =====================
 * Handles user login, setup, and password recovery
 * 
 * ENDPOINTS:
 * GET  /api/auth/setup-status - Check if first-time setup is required
 * POST /api/auth/setup        - Create first admin account (returns backup code)
 * POST /api/auth/login        - Login with username + password
 * GET  /api/auth/me           - Get current user info (requires token)
 * PUT  /api/auth/profile      - Update username
 * PUT  /api/auth/password     - Change password
 * POST /api/auth/recover      - Recover super admin with backup code
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../database/db');
const { JWT_SECRET, SALT_ROUNDS } = require('../utils/auth-config');
const { sendEmail } = require('../utils/mailer');
const { generateSecret, generateURI, verify } = require('otplib');
const qrcode = require('qrcode');
const { ensureProtectedInternalStorageAvailable } = require('../utils/protected-storage');

const router = express.Router();

/**
 * Read a numeric setting from the DB with a fallback default
 */
function getSetting(key, fallback) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? parseInt(row.value, 10) : fallback;
}

/**
 * Validate password against admin-configurable policy
 */
function validatePassword(password) {
    const minLength = getSetting('password_min_length', 8);
    if (!password || password.length < minLength) {
        return { valid: false, error: `Password must be at least ${minLength} characters` };
    }
    return { valid: true };
}

/**
 * Generate a random backup code like "XXXX-XXXX-XXXX"
 */
function generateBackupCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No O/0/1/I to avoid confusion
    let code = '';
    for (let i = 0; i < 12; i++) {
        if (i > 0 && i % 4 === 0) code += '-';
        code += chars[crypto.randomInt(chars.length)];
    }
    return code;
}

/**
 * GET /api/auth/setup-status
 * Checks if initial setup is required (no users in database)
 */
router.get('/setup-status', (req, res) => {
    try {
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
        res.json({ 
            setupRequired: userCount.count === 0,
            userCount: userCount.count
        });
    } catch (error) {
        console.error('Setup status error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/auth/setup
 * Creates the first admin user (only works when no users exist)
 * Returns a one-time backup code for password recovery
 */
router.post('/setup', async (req, res) => {
    try {
        // Check if any users already exist
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
        
        if (userCount.count > 0) {
            return res.status(403).json({ error: 'Setup already completed. Users exist.' });
        }

        const { username, password, email } = req.body;

        // Validate required fields
        if (!username || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['username', 'password']
            });
        }

        // Validate password strength
        const pwCheck = validatePassword(password);
        if (!pwCheck.valid) {
            return res.status(400).json({ error: pwCheck.error });
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // Generate backup code for super admin recovery
        const backupCode = generateBackupCode();
        const hashedBackupCode = await bcrypt.hash(backupCode, SALT_ROUNDS);

        // Insert first user as admin with backup code
        const result = db.prepare(
            'INSERT INTO users (username, password, email, is_admin, backup_code) VALUES (?, ?, ?, 1, ?)'
        ).run(username, hashedPassword, email || null, hashedBackupCode);

        // Create JWT token
        const token = jwt.sign(
            { userId: result.lastInsertRowid, username, tokenVersion: 1 },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'Admin account created successfully',
            token,
            backupCode, // Shown once to the user, then never again
            user: {
                id: result.lastInsertRowid,
                username,
                email: email || null,
                is_admin: 1
            }
        });

    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: 'Server error during setup' });
    }
});

/**
 * POST /api/auth/login
 * Authenticates user with username + password and returns JWT token
 * 
 * REQUEST BODY:
 * {
 *   "username": "admin",
 *   "password": "MyPassword123"
 * }
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validate required fields
        if (!username || !password) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['username', 'password']
            });
        }

        // Find user by username
        const user = db.prepare(
            'SELECT * FROM users WHERE username = ?'
        ).get(username);

        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        // Check if account is disabled
        if (user.is_disabled) {
            return res.status(403).json({ error: 'Account is disabled. Contact your administrator.' });
        }

        // Check if account is locked
        if (user.locked_until) {
            const lockExpiry = new Date(user.locked_until);
            if (lockExpiry > new Date()) {
                const minutesLeft = Math.ceil((lockExpiry - new Date()) / 60000);
                return res.status(423).json({
                    error: `Account is locked. Try again in ${minutesLeft} minute(s).`,
                    locked_until: user.locked_until
                });
            } else {
                // Lock expired — reset counters
                db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?')
                    .run(user.id);
            }
        }

        // Compare password with hash
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            // Increment failed attempts
            const attempts = (user.failed_login_attempts || 0) + 1;
            const maxAttempts = getSetting('account_lockout_attempts', 5);
            const lockoutMinutes = getSetting('account_lockout_duration', 15);

            if (attempts >= maxAttempts) {
                // Lock the account
                const lockUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000).toISOString();
                db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?')
                    .run(attempts, lockUntil, user.id);
                return res.status(423).json({
                    error: `Too many failed attempts. Account locked for ${lockoutMinutes} minutes.`,
                    locked_until: lockUntil
                });
            } else {
                db.prepare('UPDATE users SET failed_login_attempts = ? WHERE id = ?')
                    .run(attempts, user.id);
                return res.status(401).json({
                    error: 'Invalid username or password',
                    attempts_remaining: maxAttempts - attempts
                });
            }
        }

        // Successful login — reset failed attempts
        if (user.failed_login_attempts > 0 || user.locked_until) {
            db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?')
                .run(user.id);
        }

        // Create JWT token
        if (user.two_factor_enabled) {
            // Issue a temporary token for 2FA validation
            const tempToken = jwt.sign(
                { tempUserId: user.id },
                JWT_SECRET,
                { expiresIn: '5m' } // 5 minutes to complete 2FA
            );
            return res.json({
                message: '2FA required',
                requires_2fa: true,
                temp_token: tempToken
            });
        }

        const token = jwt.sign(
            { userId: user.id, username: user.username, tokenVersion: user.token_version || 1 },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                is_admin: user.is_admin,
                two_factor_enabled: user.two_factor_enabled
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
});

/**
 * POST /api/auth/login/2fa
 * Completes login by verifying 2FA code using the temp_token
 */
router.post('/login/2fa', async (req, res) => {
    try {
        const { temp_token, code } = req.body;

        if (!temp_token || !code) {
            return res.status(400).json({ error: 'Token and code are required' });
        }

        let decoded;
        try {
            decoded = jwt.verify(temp_token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({ error: 'Session expired or invalid. Please login again.' });
        }

        if (!decoded.tempUserId) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.tempUserId);
        
        if (!user || !user.two_factor_enabled || !user.two_factor_secret) {
            return res.status(401).json({ error: '2FA not configured properly' });
        }

        // Verify the code
        const result = await verify({ token: code, secret: user.two_factor_secret });
        
        if (!result.valid) {
            return res.status(401).json({ error: 'Invalid 2FA code' });
        }

        // Generate final auth token
        const token = jwt.sign(
            { userId: user.id, username: user.username, tokenVersion: user.token_version || 1 },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                is_admin: user.is_admin,
                two_factor_enabled: user.two_factor_enabled
            }
        });

    } catch (error) {
        console.error('2FA Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/auth/forgot-password
 * Initiates the password recovery flow by sending a token to the user's email.
 */
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email address is required' });
        }

        const user = db.prepare('SELECT id, username, email FROM users WHERE email = ?').get(email);

        if (!user) {
            // Important: Return success even if not found to prevent email enumeration
            return res.json({ message: 'If that email matches an account, a reset link has been sent.' });
        }

        // Generate a 32-byte secure random token
        const rawToken = crypto.randomBytes(32).toString('hex');
        
        // Hash it for DB storage
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        
        // Expiration: 1 hour from now
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        db.prepare(
            'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)'
        ).run(user.id, tokenHash, expiresAt);

        // Construct reset link. Assume frontend runs on same host/port if not provided by env.
        const origin = req.headers.origin || `http://${req.headers.host}`;
        const resetLink = `${origin}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

        const emailText = `Hello ${user.username},\n\nYou requested a password reset for your CloudPi account.\nPlease click the link below to reset your password:\n\n${resetLink}\n\nThis link will expire in 1 hour.\nIf you did not request this, please ignore this email.\n\nThanks,\nCloudPi`;

        // Send email (non-blocking)
        sendEmail(email, 'CloudPi Password Reset Request', emailText);

        res.json({ message: 'If that email matches an account, a reset link has been sent.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Server error processing request' });
    }
});

/**
 * POST /api/auth/reset-password
 * Completes password recovery using a valid token
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;

        if (!email || !token || !newPassword) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
        if (!user) {
            return res.status(400).json({ error: 'Invalid reset link' });
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

        const resetRecord = db.prepare(
            'SELECT id, expires_at FROM password_reset_tokens WHERE user_id = ? AND token_hash = ? AND used = 0'
        ).get(user.id, tokenHash);

        if (!resetRecord) {
            return res.status(400).json({ error: 'Invalid or expired reset link' });
        }

        if (new Date(resetRecord.expires_at) < new Date()) {
            return res.status(400).json({ error: 'Reset link has expired' });
        }

        // Validate password policy
        const pwCheck = validatePassword(newPassword);
        if (!pwCheck.valid) {
            return res.status(400).json({ error: pwCheck.error });
        }

        // Update password and invalidate existing sessions
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
        
        const updateTx = db.transaction(() => {
            db.prepare('UPDATE users SET password = ?, token_version = token_version + 1, failed_login_attempts = 0, locked_until = NULL WHERE id = ?')
              .run(hashedPassword, user.id);
            db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?')
              .run(resetRecord.id);
        });

        updateTx();

        res.json({ message: 'Password has been successfully reset' });

    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Server error during password reset' });
    }
});

/**
 * GET /api/auth/me
 * Returns current user info based on JWT token
 */
router.get('/me', (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        // Get fresh user data from database
        const user = db.prepare(
            'SELECT id, username, email, is_admin, is_disabled, token_version, two_factor_enabled, avatar_url, created_at FROM users WHERE id = ?'
        ).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        if (user.is_disabled) {
            return res.status(403).json({ error: 'Account is disabled' });
        }

        // Validate token_version
        const tokenVersion = decoded.tokenVersion || 0;
        const dbTokenVersion = user.token_version || 1;
        
        if (tokenVersion !== dbTokenVersion) {
            return res.status(401).json({ error: 'Token expired or invalidated' });
        }

        res.json({ user });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error('Auth check error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/auth/profile
 * Updates user profile (username only)
 */
router.put('/profile', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const { username, email, currentPassword } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        const user = db.prepare(
            'SELECT id, email, password FROM users WHERE id = ?'
        ).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Check if new username already exists for another user
        const existingUser = db.prepare(
            'SELECT id FROM users WHERE username = ? AND id != ?'
        ).get(username, decoded.userId);

        if (existingUser) {
            return res.status(400).json({ error: 'Username already in use' });
        }
        
        // If email provided, check uniqueness
        let finalEmail = email ? email.trim() : null;
        const existingEmail = user.email || null;
        const emailChanged = finalEmail !== existingEmail;

        if (emailChanged) {
            if (!currentPassword) {
                return res.status(400).json({ error: 'Current password is required to change email' });
            }

            const passwordMatch = await bcrypt.compare(currentPassword, user.password);

            if (!passwordMatch) {
                return res.status(401).json({ error: 'Current password is incorrect' });
            }
        }

        if (finalEmail) {
            const existingEmail = db.prepare(
                'SELECT id FROM users WHERE email = ? AND id != ?'
            ).get(finalEmail, decoded.userId);
            
            if (existingEmail) {
                return res.status(400).json({ error: 'Email already in use' });
            }
        }

        db.prepare(
            'UPDATE users SET username = ?, email = ? WHERE id = ?'
        ).run(username, finalEmail, decoded.userId);

        // Get updated user
        const updatedUser = db.prepare(
            'SELECT id, username, email, is_admin, two_factor_enabled, created_at FROM users WHERE id = ?'
        ).get(decoded.userId);

        res.json({
            message: 'Profile updated successfully',
            user: updatedUser
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Server error during profile update' });
    }
});

// ============================================
// TWO-FACTOR AUTHENTICATION (2FA)
// ============================================

/**
 * GET /api/auth/2fa/setup
 * Generates a TOTP secret and returns a QR code
 */
router.get('/2fa/setup', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const user = db.prepare('SELECT email, username, two_factor_enabled FROM users WHERE id = ?').get(decoded.userId);
        
        if (!user.email) {
            return res.status(400).json({ error: 'You must set an email address in your profile before enabling 2FA.' });
        }
        
        if (user.two_factor_enabled) {
            return res.status(400).json({ error: '2FA is already enabled.' });
        }

        // Generate a new secret
        const secret = generateSecret();
        
        // Temporarily save the secret (not enabled yet)
        db.prepare('UPDATE users SET two_factor_secret = ? WHERE id = ?').run(secret, decoded.userId);

        // Create the OTP Auth URL
        const service = 'CloudPi';
        const userIdentifier = user.email || user.username;
        const otpauth = generateURI({
            issuer: service,
            label: userIdentifier,
            secret
        });

        // Generate QR code Data URL
        const qrCodeUrl = await qrcode.toDataURL(otpauth);

        res.json({
            secret,
            qrCodeUrl
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error('2FA Setup Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/auth/2fa/verify
 * Verifies the TOTP code and enables 2FA
 */
router.post('/2fa/verify', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        const user = db.prepare('SELECT two_factor_secret, two_factor_enabled FROM users WHERE id = ?').get(decoded.userId);
        
        if (user.two_factor_enabled) {
            return res.status(400).json({ error: '2FA is already enabled.' });
        }
        
        if (!user.two_factor_secret) {
            return res.status(400).json({ error: '2FA setup was not initiated.' });
        }

        // Verify the token
        const result = await verify({ token: code, secret: user.two_factor_secret });
        
        if (!result.valid) {
            return res.status(400).json({ error: 'Invalid verification code.' });
        }

        // Enable 2FA
        db.prepare('UPDATE users SET two_factor_enabled = 1 WHERE id = ?').run(decoded.userId);

        // Fetch updated user to return to frontend
        const updatedUser = db.prepare(
            'SELECT id, username, email, is_admin, two_factor_enabled, created_at FROM users WHERE id = ?'
        ).get(decoded.userId);

        res.json({ 
            message: 'Two-factor authentication enabled successfully.',
            user: updatedUser 
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error('2FA Verify Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * POST /api/auth/2fa/disable
 * Disables 2FA for the current user
 */
router.post('/2fa/disable', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const { currentPassword } = req.body;

        if (!currentPassword) {
            return res.status(400).json({ error: 'Current password is required to disable 2FA' });
        }

        const user = db.prepare(
            'SELECT password, two_factor_enabled FROM users WHERE id = ?'
        ).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        if (!user.two_factor_enabled) {
            return res.status(400).json({ error: '2FA is already disabled.' });
        }

        const passwordMatch = await bcrypt.compare(currentPassword, user.password);

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        db.prepare('UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL WHERE id = ?').run(decoded.userId);

        // Fetch updated user
        const updatedUser = db.prepare(
            'SELECT id, username, email, is_admin, two_factor_enabled, created_at FROM users WHERE id = ?'
        ).get(decoded.userId);

        res.json({ 
            message: 'Two-factor authentication disabled.',
            user: updatedUser 
        });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        console.error('2FA Disable Error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

/**
 * PUT /api/auth/password
 * Changes user password
 */
router.put('/password', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['currentPassword', 'newPassword']
            });
        }

        if (newPassword.length < getSetting('password_min_length', 8)) {
            return res.status(400).json({ error: `New password must be at least ${getSetting('password_min_length', 8)} characters` });
        }

        const user = db.prepare(
            'SELECT * FROM users WHERE id = ?'
        ).get(decoded.userId);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        const passwordMatch = await bcrypt.compare(currentPassword, user.password);

        if (!passwordMatch) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        db.prepare(
            'UPDATE users SET password = ?, token_version = token_version + 1 WHERE id = ?'
        ).run(hashedPassword, decoded.userId);

        res.json({ message: 'Password changed successfully' });

    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Password change error:', error);
        res.status(500).json({ error: 'Server error during password change' });
    }
});

/**
 * POST /api/auth/recover
 * Recovers super admin account using backup code
 * Sets a new password and generates a new backup code
 * 
 * REQUEST BODY:
 * {
 *   "backupCode": "XXXX-XXXX-XXXX",
 *   "newPassword": "newPassword123"
 * }
 */
router.post('/recover', async (req, res) => {
    try {
        const { backupCode, newPassword } = req.body;

        if (!backupCode || !newPassword) {
            return res.status(400).json({
                error: 'Missing required fields',
                required: ['backupCode', 'newPassword']
            });
        }

        if (newPassword.length < getSetting('password_min_length', 8)) {
            return res.status(400).json({ error: `New password must be at least ${getSetting('password_min_length', 8)} characters` });
        }

        // Only the super admin (id = 1) has a backup code
        const superAdmin = db.prepare(
            'SELECT * FROM users WHERE id = 1'
        ).get();

        if (!superAdmin) {
            return res.status(404).json({ error: 'Super admin not found' });
        }

        if (!superAdmin.backup_code) {
            return res.status(400).json({ error: 'No backup code set for this account' });
        }

        // Verify backup code
        const codeMatch = await bcrypt.compare(backupCode.toUpperCase(), superAdmin.backup_code);

        if (!codeMatch) {
            return res.status(401).json({ error: 'Invalid backup code' });
        }

        // Hash the new password
        const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

        // Generate a NEW backup code for next time
        const newBackupCode = generateBackupCode();
        const hashedNewBackupCode = await bcrypt.hash(newBackupCode, SALT_ROUNDS);

        // Update password, backup code, and invalidate old tokens
        const newTokenVersion = (superAdmin.token_version || 1) + 1;
        db.prepare(
            'UPDATE users SET password = ?, backup_code = ?, token_version = ? WHERE id = 1'
        ).run(hashedPassword, hashedNewBackupCode, newTokenVersion);

        // Create new JWT token
        const token = jwt.sign(
            { userId: 1, username: superAdmin.username, tokenVersion: newTokenVersion },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            message: 'Password reset successfully',
            token,
            newBackupCode, // Show the new backup code to the user
            user: {
                id: superAdmin.id,
                username: superAdmin.username,
                is_admin: superAdmin.is_admin
            }
        });

    } catch (error) {
        console.error('Recovery error:', error);
        res.status(500).json({ error: 'Server error during recovery' });
    }
});

/**
 * POST /api/auth/check-recovery
 * Checks if a username can use backup code recovery
 * Only the Super Admin (id=1) can recover via backup code
 */
router.post('/check-recovery', (req, res) => {
    try {
        const { username } = req.body;

        if (!username) {
            return res.status(400).json({ error: 'Username is required' });
        }

        const user = db.prepare(
            'SELECT id FROM users WHERE username = ?'
        ).get(username);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Only super admin (id=1) can use backup code recovery
        res.json({ canRecover: user.id === 1 });

    } catch (error) {
        console.error('Check recovery error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// ============================================
// AVATAR UPLOAD
// ============================================

/**
 * Auth middleware for avatar routes.
 * The rest of auth.js uses inline JWT checks, but avatar needs
 * middleware because multer must have req.user populated before
 * it generates the filename.
 */
function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        const user = db.prepare('SELECT token_version, is_disabled FROM users WHERE id = ?').get(decoded.userId);
        if (!user) return res.status(401).json({ error: 'User not found' });
        if (user.is_disabled) return res.status(403).json({ error: 'Account is disabled' });

        const tokenVersion = decoded.tokenVersion || 0;
        if (tokenVersion !== (user.token_version || 1)) {
            return res.status(401).json({ error: 'Token expired or invalidated' });
        }

        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid token' });
        }
        console.error('Auth error:', error);
        res.status(500).json({ error: 'Server error' });
    }
}

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');

function ensureAvatarDir() {
    ensureProtectedInternalStorageAvailable();
    if (!fs.existsSync(AVATAR_DIR)) {
        fs.mkdirSync(AVATAR_DIR, { recursive: true });
    }
}

const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            ensureAvatarDir();
            cb(null, AVATAR_DIR);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `avatar-${req.user.userId}-${Date.now()}${ext}`);
    }
});

const avatarUpload = multer({
    storage: avatarStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (!allowed.includes(file.mimetype)) {
            return cb(new Error('Only JPEG, PNG, GIF, and WebP images are allowed'));
        }
        cb(null, true);
    }
});

/**
 * POST /api/auth/avatar
 * Upload a new profile picture
 */
router.post('/avatar', requireAuth, avatarUpload.single('avatar'), (req, res) => {
    try {
        ensureAvatarDir();
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const userId = req.user.userId;

        // Delete old avatar if it exists
        const existing = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(userId);
        if (existing && existing.avatar_url) {
            const oldPath = path.join(AVATAR_DIR, existing.avatar_url);
            if (fs.existsSync(oldPath)) {
                try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
            }
        }

        // Save new avatar filename in DB
        db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(req.file.filename, userId);

        res.json({
            message: 'Avatar updated',
            avatar_url: req.file.filename,
        });
    } catch (error) {
        console.error('Avatar upload error:', error);
        res.status(500).json({ error: 'Failed to upload avatar' });
    }
});

/**
 * DELETE /api/auth/avatar
 * Remove profile picture
 */
router.delete('/avatar', requireAuth, (req, res) => {
    try {
        ensureAvatarDir();
        const userId = req.user.userId;
        const existing = db.prepare('SELECT avatar_url FROM users WHERE id = ?').get(userId);

        if (existing && existing.avatar_url) {
            const oldPath = path.join(AVATAR_DIR, existing.avatar_url);
            if (fs.existsSync(oldPath)) {
                try { fs.unlinkSync(oldPath); } catch (e) { /* ignore */ }
            }
        }

        db.prepare('UPDATE users SET avatar_url = NULL WHERE id = ?').run(userId);
        res.json({ message: 'Avatar removed' });
    } catch (error) {
        console.error('Avatar delete error:', error);
        res.status(500).json({ error: 'Failed to remove avatar' });
    }
});

/**
 * GET /api/auth/avatar/:filename
 * Serve avatar image (public within authenticated context)
 */
router.get('/avatar/:filename', (req, res) => {
    ensureAvatarDir();
    const filePath = path.join(AVATAR_DIR, path.basename(req.params.filename));
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Avatar not found' });
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(filePath);
});

module.exports = router;
