const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const fs = require('fs');
const childProcess = require('child_process');

const dashboardRoute = require('../routes/dashboard');
const {
  getCpuUsage,
  getDiskUsage,
  getCpuTemperature,
  getNetworkInfo,
  resetCpuBaseline
} = dashboardRoute.__test__;

test('getCpuUsage returns baseline 0 on first call then computes usage', () => {
  const originalCpus = os.cpus;
  let callCount = 0;

  os.cpus = () => {
    callCount += 1;
    if (callCount === 1) {
      return [{ times: { user: 50, nice: 0, sys: 0, idle: 50, irq: 0 } }];
    }
    return [{ times: { user: 140, nice: 0, sys: 0, idle: 60, irq: 0 } }];
  };

  try {
    resetCpuBaseline();
    assert.equal(getCpuUsage(), 0);
    assert.equal(getCpuUsage(), 90);
  } finally {
    os.cpus = originalCpus;
    resetCpuBaseline();
  }
});

test('getDiskUsage parses linux df output', () => {
  const originalExecSync = childProcess.execSync;
  childProcess.execSync = () => 'rootfs 1000 250 750 25% /\n';

  try {
    const usage = getDiskUsage();
    assert.equal(usage.total, 1000);
    assert.equal(usage.used, 250);
    assert.equal(usage.free, 750);
    assert.equal(usage.percentage, 25);
  } finally {
    childProcess.execSync = originalExecSync;
  }
});

test('getDiskUsage returns zeroed values when command fails', () => {
  const originalExecSync = childProcess.execSync;
  childProcess.execSync = () => {
    throw new Error('df failed');
  };

  try {
    const usage = getDiskUsage();
    assert.deepEqual(usage, { total: 0, used: 0, free: 0, percentage: 0 });
  } finally {
    childProcess.execSync = originalExecSync;
  }
});

test('getCpuTemperature returns null when thermal file is unavailable', () => {
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = () => {
    throw new Error('missing');
  };

  try {
    assert.equal(getCpuTemperature(), null);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});

test('getNetworkInfo prioritizes local network ranges and falls back to loopback', () => {
  const originalNetworkInterfaces = os.networkInterfaces;

  try {
    os.networkInterfaces = () => ({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [{ address: '10.0.0.8', family: 'IPv4', internal: false }],
      wlan0: [{ address: '192.168.1.12', family: 'IPv4', internal: false }],
    });
    assert.equal(getNetworkInfo(), '192.168.1.12');

    os.networkInterfaces = () => ({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      eth0: [{ address: '172.20.1.15', family: 'IPv4', internal: false }],
    });
    assert.equal(getNetworkInfo(), '172.20.1.15');

    os.networkInterfaces = () => ({
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    });
    assert.equal(getNetworkInfo(), '127.0.0.1');
  } finally {
    os.networkInterfaces = originalNetworkInterfaces;
  }
});
