// Quick smoke test — verifies DB, crypto module, and encryption key generation
const path = require('path');
const db = require(path.join(__dirname, '..', 'database', 'db'));
const crypto = require(path.join(__dirname, '..', 'utils', 'crypto-utils'));

console.log('✅ Database loaded OK');
console.log('✅ Crypto module loaded OK');

const key = crypto.getEncryptionKey();
console.log('✅ Encryption key:', key.length, 'bytes');
console.log('✅ Encryption enabled:', crypto.isEncryptionEnabled(db));

// Test hash function
const fs = require('fs');
const testFile = path.join(__dirname, '..', 'package.json');
crypto.computeFileHash(testFile).then(hash => {
    console.log('✅ SHA-256 hash of package.json:', hash.substring(0, 16) + '...');
    console.log('\n🎉 All checks passed!');
    process.exit(0);
}).catch(err => {
    console.error('❌ Hash error:', err.message);
    process.exit(1);
});
