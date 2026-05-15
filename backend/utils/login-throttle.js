'use strict';

const net = require('net');

const LOGIN_THROTTLE_POLICY = Object.freeze({
    action: 'auth.login',
    attemptWindowMs: 60 * 60 * 1000,
    baseDelayMs: 100,
    maxDelayMs: 25 * 1000,
    blockWindowMs: 30 * 60 * 1000,
    blockThreshold: 20,
});

function getDefaultDb() {
    return require('../database/db');
}

function normalizeIp(rawIp) {
    let ip = String(rawIp || '').trim();
    if (!ip) return 'unknown';

    ip = ip.split(',')[0].trim();
    if (ip.startsWith('[')) {
        const end = ip.indexOf(']');
        if (end !== -1) ip = ip.slice(1, end);
    }

    if (net.isIP(ip) === 0 && ip.includes('.') && ip.indexOf(':') === ip.lastIndexOf(':')) {
        ip = ip.split(':')[0];
    }

    if (ip.toLowerCase().startsWith('::ffff:')) {
        const v4 = ip.slice(7);
        if (net.isIP(v4) === 4) return v4;
    }

    return ip || 'unknown';
}

function expandIPv6(ip) {
    let address = String(ip || '').toLowerCase().split('%')[0];
    if (net.isIP(address) !== 6) return null;

    if (address.includes('.')) {
        const lastColon = address.lastIndexOf(':');
        const v4 = address.slice(lastColon + 1);
        const octets = v4.split('.').map(Number);
        if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
            return null;
        }
        const hi = ((octets[0] << 8) | octets[1]).toString(16);
        const lo = ((octets[2] << 8) | octets[3]).toString(16);
        address = `${address.slice(0, lastColon)}:${hi}:${lo}`;
    }

    const halves = address.split('::');
    if (halves.length > 2) return null;

    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    const missing = 8 - head.length - tail.length;
    if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;

    const full = [...head, ...Array(missing).fill('0'), ...tail].map((part) => {
        if (!/^[0-9a-f]{0,4}$/.test(part)) return null;
        const parsed = parseInt(part || '0', 16);
        return Number.isFinite(parsed) ? parsed.toString(16).padStart(4, '0') : null;
    });

    return full.includes(null) || full.length !== 8 ? null : full;
}

function normalizeSourceSubnet(rawIp) {
    const ip = normalizeIp(rawIp);
    const ipType = net.isIP(ip);

    if (ipType === 4) {
        const parts = ip.split('.');
        return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
    }

    if (ipType === 6) {
        const full = expandIPv6(ip);
        if (!full) return 'unknown';
        return `${full.slice(0, 4).join(':')}:0000:0000:0000:0000/64`;
    }

    return 'unknown';
}

function getClientIp(req) {
    return normalizeIp(req?.ip || req?.socket?.remoteAddress || 'unknown');
}

function getUserAgent(req) {
    const userAgent = req?.get ? req.get('user-agent') : req?.headers?.['user-agent'];
    return String(userAgent || '').slice(0, 512);
}

function normalizeUsername(username) {
    return String(username || '').trim().slice(0, 255);
}

function calculateDelayMs(failureCount, policy = LOGIN_THROTTLE_POLICY) {
    if (!Number.isFinite(failureCount) || failureCount <= 0) return 0;
    const exponent = Math.min(Math.floor(failureCount) - 1, 20);
    return Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** exponent));
}

function getFailureCount(dbHandle, action, ipSubnet, sinceIso) {
    const row = dbHandle.prepare(`
        SELECT COUNT(*) AS count
        FROM security_attempts
        WHERE action = ?
          AND ip_subnet = ?
          AND result = 'failure'
          AND occurred_at >= ?
    `).get(action, ipSubnet, sinceIso);
    return row?.count || 0;
}

function getHardBlock(dbHandle, action, ipSubnet, nowMs, policy = LOGIN_THROTTLE_POLICY) {
    const sinceIso = new Date(nowMs - policy.blockWindowMs).toISOString();
    const row = dbHandle.prepare(`
        SELECT COUNT(*) AS count, MIN(occurred_at) AS first_attempt_at
        FROM security_attempts
        WHERE action = ?
          AND ip_subnet = ?
          AND result = 'failure'
          AND occurred_at >= ?
    `).get(action, ipSubnet, sinceIso);

    if (!row || row.count < policy.blockThreshold || !row.first_attempt_at) return null;

    const firstAttemptMs = new Date(row.first_attempt_at).getTime();
    if (!Number.isFinite(firstAttemptMs)) return null;

    const blockUntilMs = firstAttemptMs + policy.blockWindowMs;
    if (blockUntilMs <= nowMs) return null;

    return {
        retryAfterSeconds: Math.max(1, Math.ceil((blockUntilMs - nowMs) / 1000)),
        blockedUntil: new Date(blockUntilMs).toISOString(),
        failureCount: row.count,
    };
}

function recordSecurityAttempt({
    dbHandle = getDefaultDb(),
    req,
    action = LOGIN_THROTTLE_POLICY.action,
    username,
    result,
    occurredAt = new Date().toISOString(),
    ipAddress = getClientIp(req),
    ipSubnet = normalizeSourceSubnet(ipAddress),
}) {
    const usernameAttempted = normalizeUsername(username);
    const userAgent = getUserAgent(req);

    dbHandle.prepare(`
        INSERT INTO security_attempts (
            action, ip_address, ip_subnet, username_attempted, user_agent, result, occurred_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(action, ipAddress, ipSubnet, usernameAttempted || null, userAgent || null, result, occurredAt);

    console.warn(`[SECURITY_LOGIN] ${JSON.stringify({
        timestamp: occurredAt,
        ip_address: ipAddress,
        ip_subnet: ipSubnet,
        action,
        username_attempted: usernameAttempted,
        user_agent: userAgent,
        result,
    })}`);
}

async function enforceLoginThrottle(req, username, options = {}) {
    const dbHandle = options.dbHandle || getDefaultDb();
    const policy = options.policy || LOGIN_THROTTLE_POLICY;
    const nowMs = options.nowMs || Date.now();
    const sleepFn = options.sleepFn || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const ipAddress = getClientIp(req);
    const ipSubnet = normalizeSourceSubnet(ipAddress);

    const hardBlock = getHardBlock(dbHandle, policy.action, ipSubnet, nowMs, policy);
    if (hardBlock) {
        const occurredAt = new Date(nowMs).toISOString();
        recordSecurityAttempt({
            dbHandle,
            req,
            action: policy.action,
            username,
            result: 'blocked',
            occurredAt,
            ipAddress,
            ipSubnet,
        });
        return {
            blocked: true,
            ipAddress,
            ipSubnet,
            retryAfterSeconds: hardBlock.retryAfterSeconds,
            blockedUntil: hardBlock.blockedUntil,
            failureCount: hardBlock.failureCount,
        };
    }

    const sinceIso = new Date(nowMs - policy.attemptWindowMs).toISOString();
    const failureCount = getFailureCount(dbHandle, policy.action, ipSubnet, sinceIso);
    const delayMs = calculateDelayMs(failureCount, policy);

    if (delayMs > 0) {
        await sleepFn(delayMs);
    }

    return {
        blocked: false,
        delayMs,
        failureCount,
        ipAddress,
        ipSubnet,
    };
}

function sendLoginThrottleBlock(res, throttle) {
    res.set('Retry-After', String(throttle.retryAfterSeconds));
    return res.status(429).json({
        error: `Too many invalid login attempts. Try again in ${throttle.retryAfterSeconds} second(s).`,
        retry_after_seconds: throttle.retryAfterSeconds,
        blocked_until: throttle.blockedUntil,
    });
}

function recordFailedLoginAttempt(req, username, throttleContext = {}, options = {}) {
    const nowMs = options.nowMs || Date.now();
    recordSecurityAttempt({
        dbHandle: options.dbHandle || getDefaultDb(),
        req,
        action: options.action || LOGIN_THROTTLE_POLICY.action,
        username,
        result: 'failure',
        occurredAt: new Date(nowMs).toISOString(),
        ipAddress: throttleContext.ipAddress || getClientIp(req),
        ipSubnet: throttleContext.ipSubnet || normalizeSourceSubnet(getClientIp(req)),
    });
}

function clearLoginFailuresForSource(req, throttleContext = {}, options = {}) {
    const dbHandle = options.dbHandle || getDefaultDb();
    const action = options.action || LOGIN_THROTTLE_POLICY.action;
    const ipSubnet = throttleContext.ipSubnet || normalizeSourceSubnet(getClientIp(req));

    dbHandle.prepare(`
        DELETE FROM security_attempts
        WHERE action = ?
          AND ip_subnet = ?
          AND result = 'failure'
    `).run(action, ipSubnet);
}

module.exports = {
    LOGIN_THROTTLE_POLICY,
    calculateDelayMs,
    clearLoginFailuresForSource,
    enforceLoginThrottle,
    getClientIp,
    getHardBlock,
    normalizeIp,
    normalizeSourceSubnet,
    recordFailedLoginAttempt,
    recordSecurityAttempt,
    sendLoginThrottleBlock,
};
