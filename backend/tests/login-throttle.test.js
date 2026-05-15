const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    calculateDelayMs,
    clearLoginFailuresForSource,
    enforceLoginThrottle,
    LOGIN_THROTTLE_POLICY,
    normalizeSourceSubnet,
    recordFailedLoginAttempt,
} = require('../utils/login-throttle');

function createDb() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE security_attempts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            ip_address TEXT,
            ip_subnet TEXT NOT NULL,
            username_attempted TEXT,
            user_agent TEXT,
            result TEXT NOT NULL,
            occurred_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_security_attempts_action_subnet_time
            ON security_attempts(action, ip_subnet, occurred_at);
    `);
    return db;
}

function createReq(ip) {
    return {
        ip,
        headers: { 'user-agent': 'cloudpi-test-agent' },
        get(name) {
            return this.headers[String(name).toLowerCase()];
        },
    };
}

async function run() {
    assert.equal(normalizeSourceSubnet('192.168.1.42'), '192.168.1.0/24');
    assert.equal(normalizeSourceSubnet('::ffff:10.0.2.99'), '10.0.2.0/24');
    assert.equal(
        normalizeSourceSubnet('2001:db8:abcd:12:ffff:ffff:ffff:ffff'),
        '2001:0db8:abcd:0012:0000:0000:0000:0000/64',
    );
    assert.equal(normalizeSourceSubnet('not-an-ip'), 'unknown');

    assert.equal(calculateDelayMs(0), 0);
    assert.equal(calculateDelayMs(1), LOGIN_THROTTLE_POLICY.baseDelayMs);
    assert.equal(calculateDelayMs(2), LOGIN_THROTTLE_POLICY.baseDelayMs * 2);
    assert.equal(calculateDelayMs(20), LOGIN_THROTTLE_POLICY.maxDelayMs);

    const originalWarn = console.warn;
    console.warn = () => {};

    const db = createDb();
    const req = createReq('100.64.12.34');
    const nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const slept = [];

    let throttle = await enforceLoginThrottle(req, 'admin', {
        dbHandle: db,
        nowMs,
        sleepFn: (ms) => {
            slept.push(ms);
            return Promise.resolve();
        },
    });
    assert.equal(throttle.blocked, false);
    assert.equal(throttle.delayMs, 0);
    assert.deepEqual(slept, []);

    recordFailedLoginAttempt(req, 'admin', throttle, { dbHandle: db, nowMs });
    assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM security_attempts WHERE result = 'failure'").get().count,
        1,
    );

    throttle = await enforceLoginThrottle(req, 'admin', {
        dbHandle: db,
        nowMs: nowMs + 1000,
        sleepFn: (ms) => {
            slept.push(ms);
            return Promise.resolve();
        },
    });
    assert.equal(throttle.blocked, false);
    assert.equal(throttle.delayMs, 100);
    assert.equal(slept.at(-1), 100);

    for (let i = 1; i < LOGIN_THROTTLE_POLICY.blockThreshold; i += 1) {
        recordFailedLoginAttempt(req, `admin-${i}`, throttle, {
            dbHandle: db,
            nowMs: nowMs + i * 1000,
        });
    }

    throttle = await enforceLoginThrottle(req, 'admin', {
        dbHandle: db,
        nowMs: nowMs + LOGIN_THROTTLE_POLICY.blockThreshold * 1000,
        sleepFn: () => {
            throw new Error('blocked requests must not delay via sleep');
        },
    });
    assert.equal(throttle.blocked, true);
    assert.equal(throttle.retryAfterSeconds > 0, true);
    assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM security_attempts WHERE result = 'blocked'").get().count,
        1,
    );

    throttle = await enforceLoginThrottle(req, 'admin', {
        dbHandle: db,
        nowMs: nowMs + LOGIN_THROTTLE_POLICY.blockWindowMs + 21 * 1000,
        sleepFn: (ms) => {
            slept.push(ms);
            return Promise.resolve();
        },
    });
    assert.equal(throttle.blocked, false);
    assert.equal(throttle.delayMs, LOGIN_THROTTLE_POLICY.maxDelayMs);

    clearLoginFailuresForSource(req, throttle, { dbHandle: db });
    assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM security_attempts WHERE result = 'failure'").get().count,
        0,
    );

    db.close();
    console.warn = originalWarn;
}

run()
    .then(() => {
        console.log('login-throttle tests passed');
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
