/**
 * AUTH CONFIG
 * ===========
 * Centralized authentication configuration.
 * All route files import JWT_SECRET from here instead of hardcoding it.
 *
 * The secret is read from the JWT_SECRET environment variable.
 * If not set, a default is used (fine for local Pi usage).
 */

const JWT_SECRET = process.env.JWT_SECRET || 'cloudpi-secret-key-change-this-in-production';
const SALT_ROUNDS = 10;

module.exports = { JWT_SECRET, SALT_ROUNDS };
