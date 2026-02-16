#!/usr/bin/env node
/**
 * CLOUDPI PASSWORD RESET CLI
 * ==========================
 * Emergency tool to reset a user's password from the command line.
 * Use this when you're locked out and backup code is unavailable.
 * 
 * USAGE:
 *   node reset-password.js <username> <newPassword>
 * 
 * EXAMPLES:
 *   node reset-password.js admin MyNewPassword123
 *   node reset-password.js kozha newSecurePass
 */

const bcrypt = require('bcrypt');
const path = require('path');
const Database = require('better-sqlite3');

const SALT_ROUNDS = 10;

async function main() {
    const args = process.argv.slice(2);

    if (args.length < 2) {
        console.log('');
        console.log('  CloudPi Password Reset Tool');
        console.log('  ===========================');
        console.log('');
        console.log('  Usage: node reset-password.js <username> <newPassword>');
        console.log('');
        console.log('  Examples:');
        console.log('    node reset-password.js admin MyNewPassword123');
        console.log('    node reset-password.js kozha newSecurePass');
        console.log('');
        process.exit(1);
    }

    const [username, newPassword] = args;

    if (newPassword.length < 6) {
        console.error('❌ Error: Password must be at least 6 characters');
        process.exit(1);
    }

    // Connect to database directly
    const dbPath = path.join(__dirname, 'cloudpi.db');
    let db;
    
    try {
        db = new Database(dbPath);
    } catch (error) {
        console.error('❌ Error: Could not open database at', dbPath);
        console.error('   Make sure you run this script from the backend directory.');
        process.exit(1);
    }

    // Find user
    const user = db.prepare('SELECT id, username, is_admin FROM users WHERE username = ?').get(username);

    if (!user) {
        console.error(`❌ Error: User "${username}" not found`);
        
        // Show available usernames
        const users = db.prepare('SELECT username FROM users').all();
        if (users.length > 0) {
            console.log('');
            console.log('Available users:');
            users.forEach(u => console.log(`  - ${u.username}`));
        }
        db.close();
        process.exit(1);
    }

    // Only allow resetting the Super Admin password
    if (user.id !== 1) {
        console.error('❌ Error: This tool can only reset the Super Admin password');
        console.error('   Other users should ask the Super Admin to reset their password.');
        db.close();
        process.exit(1);
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

    // Update password and invalidate old tokens
    const tokenVersion = (user.token_version || 1) + 1;
    db.prepare(
        'UPDATE users SET password = ?, token_version = ? WHERE id = ?'
    ).run(hashedPassword, tokenVersion, user.id);

    console.log('');
    console.log(`✅ Password reset successfully for "${user.username}"`);
    console.log(`   Admin: ${user.is_admin ? 'Yes' : 'No'}`);
    console.log(`   All existing sessions have been invalidated.`);
    console.log('');

    db.close();
}

main().catch(error => {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
});
