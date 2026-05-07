/**
 * AUTH CONFIG
 * ===========
 * Centralized authentication configuration.
 * All route files import JWT_SECRET from here instead of hardcoding it.
 *
 * The secret is read from the JWT_SECRET environment variable.
 * If not set, a default is used for local development only.
 */

const DEFAULT_JWT_SECRET = 'cloudpi-secret-key-change-this-in-production';
// .trim() handles Windows CRLF in .env (Docker may include \r in values)
const JWT_SECRET = (process.env.JWT_SECRET || DEFAULT_JWT_SECRET).trim();
const SALT_ROUNDS = 10;

if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error('JWT_SECRET must be set to a strong value in production');
}

module.exports = { JWT_SECRET, SALT_ROUNDS };
