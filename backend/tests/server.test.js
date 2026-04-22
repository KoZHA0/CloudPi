const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../database/db');
const { getSetting, createDynamicLimiter } = require('../server');

function upsertSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value, description)
    VALUES (?, ?, 'test setting')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function removeSetting(key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

function createRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    set(key, value) {
      this.headers[key] = value;
    }
  };
}

test('getSetting returns fallback for unknown key', () => {
  assert.equal(getSetting('test_nonexistent_setting', 42), 42);
});

test('dynamic limiter skips OPTIONS requests', () => {
  const limiter = createDynamicLimiter({
    maxKey: 'rate_limit_api_max',
    maxDefault: 1,
    windowKey: 'rate_limit_api_window',
    windowDefault: 1,
    errorPrefix: 'Too many requests.'
  });

  const req = { method: 'OPTIONS', path: '/api/files', ip: '127.0.0.1' };
  const res = createRes();
  let calledNext = false;

  limiter(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('dynamic limiter skips configured paths', () => {
  const limiter = createDynamicLimiter({
    maxKey: 'rate_limit_api_max',
    maxDefault: 1,
    windowKey: 'rate_limit_api_window',
    windowDefault: 1,
    errorPrefix: 'Too many requests.',
    skipPaths: ['/api/admin/settings']
  });

  const req = { method: 'GET', path: '/api/admin/settings/limits', ip: '127.0.0.1' };
  const res = createRes();
  let calledNext = false;

  limiter(req, res, () => {
    calledNext = true;
  });

  assert.equal(calledNext, true);
  assert.equal(res.statusCode, 200);
});

test('dynamic limiter allows within limit and blocks above limit', () => {
  const maxKey = 'test_rate_limit_max';
  const windowKey = 'test_rate_limit_window';
  upsertSetting(maxKey, 2);
  upsertSetting(windowKey, 1);

  const limiter = createDynamicLimiter({
    maxKey,
    maxDefault: 100,
    windowKey,
    windowDefault: 15,
    errorPrefix: 'Too many requests.'
  });

  const originalNow = Date.now;
  Date.now = () => 1_000_000;

  try {
    const req = { method: 'GET', path: '/api/test', ip: '10.0.0.1' };

    const firstRes = createRes();
    let firstNext = false;
    limiter(req, firstRes, () => { firstNext = true; });
    assert.equal(firstNext, true);
    assert.equal(firstRes.headers['RateLimit-Limit'], '2');
    assert.equal(firstRes.headers['RateLimit-Remaining'], '1');

    const secondRes = createRes();
    let secondNext = false;
    limiter(req, secondRes, () => { secondNext = true; });
    assert.equal(secondNext, true);
    assert.equal(secondRes.headers['RateLimit-Remaining'], '0');

    const blockedRes = createRes();
    let blockedNext = false;
    limiter(req, blockedRes, () => { blockedNext = true; });
    assert.equal(blockedNext, false);
    assert.equal(blockedRes.statusCode, 429);
    assert.match(blockedRes.body.error, /hit the limit of 2/);
  } finally {
    Date.now = originalNow;
    removeSetting(maxKey);
    removeSetting(windowKey);
  }
});
