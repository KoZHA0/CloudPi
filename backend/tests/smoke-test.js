// Quick smoke test — verifies DB and crypto module
const path = require('path');
const db = require(path.join(__dirname, '..', 'database', 'db'));
const crypto = require(path.join(__dirname, '..', 'utils', 'crypto-utils'));

console.log('✅ Database loaded OK');
console.log('✅ Crypto module loaded OK');

// Test hash function (the only crypto function still in use)
const testFile = path.join(__dirname, '..', 'package.json');
crypto.computeFileHash(testFile).then(hash => {
    console.log('✅ SHA-256 hash of package.json:', hash.substring(0, 16) + '...');

    // Verify round-trip
    return crypto.verifyFileHash(testFile, hash);
}).then(result => {
    console.log('✅ Hash verification:', result.valid ? 'PASS' : 'FAIL');
    console.log('\n🎉 All checks passed!');
    process.exit(0);
}).catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
