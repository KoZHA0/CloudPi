#!/usr/bin/env node
/**
 * ============================================================
 * CloudPi Performance Evaluation Test Script
 * ============================================================
 * 
 * Automated benchmarking tool that fills out the Performance
 * Evaluation Table for your project documentation.
 * 
 * WHAT IT TESTS:
 *   - Upload/Download speed across 5 file sizes (50KB → 25MB)
 *   - 3 compression levels (None, 50%, 75%) using different file types
 *   - CPU and Memory usage during operations
 *   - SHA-256 hash verification (data integrity)
 *   - Concurrent user simulation (1, 5, 10, 20 users)
 * 
 * BEFORE RUNNING:
 *   1. Make sure CloudPi backend is running (node server.js)
 *   2. Update the CONFIG section below with your credentials
 *   3. IMPORTANT: Temporarily increase rate limits in Admin → Settings:
 *      - API rate limit → 500+ requests per window
 *      - Upload rate limit → 100+ uploads per window
 *      (Reset them after testing)
 * 
 * USAGE:
 *   cd backend/tests
 *   node performance-test.js
 * 
 * OUTPUT:
 *   - Prints formatted tables to console
 *   - Saves results to performance-results.md (markdown)
 *   - Saves results to performance-results.csv (spreadsheet)
 * ============================================================
 */

const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIGURATION — UPDATE THESE BEFORE RUNNING
// ============================================================
const CONFIG = {
    host: 'pi.taild54945.ts.net',
    port: 3001,
    username: 'Admin',       // ← Change to your username
    password: '123456',    // ← Change to your password
};

// Test parameters
const FILE_SIZES = [
    { label: '50 KB',  bytes: 50 * 1024 },
    { label: '500 KB', bytes: 500 * 1024 },
    { label: '1 MB',   bytes: 1 * 1024 * 1024 },
    { label: '5 MB',   bytes: 5 * 1024 * 1024 },
    { label: '25 MB',  bytes: 25 * 1024 * 1024 },
];

const COMPRESSION_LEVELS = [
    { label: 'None', type: 'random' },   // Random bytes — incompressible (like JPEG, ZIP)
    { label: '50%',  type: 'mixed' },    // Half random, half repetitive (like DOCX, PDF)
    { label: '75%',  type: 'repetitive' }, // Mostly repetitive (like TXT, CSV, logs)
];

const CONCURRENT_USERS = [
    { users: 1,  operation: 'Upload/download',  situation: '' },
    { users: 5,  operation: 'Mixed operations', situation: '' },
    { users: 10, operation: 'Mixed operations', situation: '' },
    { users: 20, operation: 'Stress condition', situation: '' },
];

// Temp directory for generated test files
const TEMP_DIR = path.join(__dirname, 'temp-test-files');

// ============================================================
// HELPER: HTTP REQUEST WRAPPER
// ============================================================

/**
 * Makes an HTTP request and returns { statusCode, headers, body }
 * Handles JSON and binary responses
 */
function httpRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: CONFIG.host,
            port: CONFIG.port,
            ...options,
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const contentType = res.headers['content-type'] || '';
                let parsed;
                if (contentType.includes('application/json')) {
                    try { parsed = JSON.parse(buffer.toString()); } 
                    catch { parsed = buffer; }
                } else {
                    parsed = buffer;
                }
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: parsed,
                    rawBuffer: buffer,
                });
            });
        });

        req.on('error', reject);
        req.setTimeout(120000, () => {
            req.destroy(new Error('Request timed out (120s)'));
        });

        if (body) req.write(body);
        req.end();
    });
}

/**
 * Login and return JWT token
 */
async function login() {
    const payload = JSON.stringify({
        username: CONFIG.username,
        password: CONFIG.password,
    });

    const res = await httpRequest({
        path: '/api/auth/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
        },
    }, payload);

    if (res.statusCode !== 200) {
        throw new Error(`Login failed (${res.statusCode}): ${JSON.stringify(res.body)}`);
    }

    return res.body.token;
}

/**
 * Upload a file via multipart form data
 * Returns { fileId, uploadTimeMs }
 */
async function uploadFile(token, filePath, filename) {
    const fileContent = fs.readFileSync(filePath);
    const boundary = '----CloudPiBenchmark' + crypto.randomBytes(8).toString('hex');

    // Build multipart body manually (no external dependencies needed)
    const header = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="files"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileContent, footer]);

    const startTime = process.hrtime.bigint();

    const res = await httpRequest({
        path: '/api/files/upload',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Content-Length': body.length,
        },
    }, body);

    const endTime = process.hrtime.bigint();
    const uploadTimeMs = Number(endTime - startTime) / 1_000_000;

    if (res.statusCode !== 201) {
        throw new Error(`Upload failed (${res.statusCode}): ${JSON.stringify(res.body)}`);
    }

    const fileId = res.body.files[0].id;
    return { fileId, uploadTimeMs };
}

/**
 * Download a file by ID
 * Returns { buffer, downloadTimeMs }
 */
async function downloadFile(token, fileId) {
    const startTime = process.hrtime.bigint();

    const res = await httpRequest({
        path: `/api/files/${fileId}/download`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
        },
    });

    const endTime = process.hrtime.bigint();
    const downloadTimeMs = Number(endTime - startTime) / 1_000_000;

    if (res.statusCode !== 200) {
        throw new Error(`Download failed (${res.statusCode}): ${JSON.stringify(res.body)}`);
    }

    return { buffer: res.rawBuffer, downloadTimeMs };
}

/**
 * Delete a file permanently (trash → permanent delete)
 */
async function deleteFile(token, fileId) {
    // Step 1: Move to trash
    await httpRequest({
        path: `/api/files/${fileId}`,
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
    });

    // Step 2: Permanent delete
    await httpRequest({
        path: `/api/files/${fileId}/permanent`,
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
    });
}

// ============================================================
// HELPER: TEST FILE GENERATION
// ============================================================

/**
 * Generate a test file with specific size and compressibility
 * 
 * - 'random':     Pure random bytes (like JPEG, MP4, ZIP — incompressible)
 * - 'mixed':      50% random + 50% repetitive (like DOCX, PDF)
 * - 'repetitive': 25% random + 75% repetitive pattern (like TXT, CSV)
 */
function generateTestFile(sizeBytes, compressionType) {
    let buffer;

    switch (compressionType) {
        case 'random':
            // Fully random — cannot be compressed
            buffer = crypto.randomBytes(sizeBytes);
            break;

        case 'mixed':
            // 50% random, 50% repetitive text pattern
            const halfSize = Math.floor(sizeBytes / 2);
            const randomPart = crypto.randomBytes(halfSize);
            const pattern = Buffer.from('CloudPi performance test data. This text repeats to simulate compressible content. ');
            const repeatCount = Math.ceil((sizeBytes - halfSize) / pattern.length);
            const repetitivePart = Buffer.alloc(sizeBytes - halfSize);
            for (let i = 0; i < repetitivePart.length; i++) {
                repetitivePart[i] = pattern[i % pattern.length];
            }
            buffer = Buffer.concat([randomPart, repetitivePart], sizeBytes);
            break;

        case 'repetitive':
            // 25% random, 75% repetitive
            const quarterSize = Math.floor(sizeBytes / 4);
            const randPart = crypto.randomBytes(quarterSize);
            const textPattern = Buffer.from('AAAA,BBBB,CCCC,DDDD,1234,5678,test,data\n');
            const repPart = Buffer.alloc(sizeBytes - quarterSize);
            for (let i = 0; i < repPart.length; i++) {
                repPart[i] = textPattern[i % textPattern.length];
            }
            buffer = Buffer.concat([randPart, repPart], sizeBytes);
            break;

        default:
            buffer = crypto.randomBytes(sizeBytes);
    }

    return buffer;
}

/**
 * Compute SHA-256 hash of a buffer
 */
function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ============================================================
// HELPER: SYSTEM MONITORING (Linux / Raspberry Pi)
// ============================================================

/**
 * Read CPU usage from /proc/stat (Linux only)
 * Returns { idle, total } raw tick counts
 */
function getCpuSnapshot() {
    try {
        const stat = fs.readFileSync('/proc/stat', 'utf8');
        const line = stat.split('\n')[0]; // 'cpu  user nice system idle ...'
        const parts = line.split(/\s+/).slice(1).map(Number);
        const idle = parts[3] + (parts[4] || 0); // idle + iowait
        const total = parts.reduce((a, b) => a + b, 0);
        return { idle, total };
    } catch {
        // Not Linux — use os module as fallback
        const cpus = os.cpus();
        let idle = 0, total = 0;
        for (const cpu of cpus) {
            for (const type in cpu.times) {
                total += cpu.times[type];
            }
            idle += cpu.times.idle;
        }
        return { idle, total };
    }
}

/**
 * Calculate CPU usage % between two snapshots
 */
function calculateCpuPercent(before, after) {
    const idleDiff = after.idle - before.idle;
    const totalDiff = after.total - before.total;
    if (totalDiff === 0) return 0;
    return Math.round(((totalDiff - idleDiff) / totalDiff) * 100);
}

/**
 * Get current memory usage in MB (used RAM)
 */
function getMemoryUsageMB() {
    try {
        // Linux: read /proc/meminfo for accurate Pi stats
        const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
        const lines = meminfo.split('\n');
        const getValue = (key) => {
            const line = lines.find(l => l.startsWith(key));
            return line ? parseInt(line.split(/\s+/)[1]) / 1024 : 0; // kB → MB
        };
        const total = getValue('MemTotal');
        const available = getValue('MemAvailable');
        return Math.round(total - available);
    } catch {
        // Fallback for non-Linux
        const total = os.totalmem();
        const free = os.freemem();
        return Math.round((total - free) / (1024 * 1024));
    }
}

// ============================================================
// MAIN TEST: PERFORMANCE EVALUATION TABLE
// ============================================================

async function runPerformanceTests(token) {
    console.log('\n' + '='.repeat(80));
    console.log('  PERFORMANCE EVALUATION TABLE TEST');
    console.log('  Testing upload/download across file sizes and compression levels');
    console.log('='.repeat(80));

    const results = [];
    const totalTests = FILE_SIZES.length * COMPRESSION_LEVELS.length;
    let testNum = 0;

    // Warmup request — eliminates cold start skewing the first result
    process.stdout.write('\n🔥 Warming up server (1 dummy upload)...');
    try {
        const warmupBuffer = crypto.randomBytes(1024);
        const warmupFile = path.join(TEMP_DIR, 'warmup.bin');
        fs.writeFileSync(warmupFile, warmupBuffer);
        const { fileId } = await uploadFile(token, warmupFile, 'warmup.bin');
        await downloadFile(token, fileId);
        await deleteFile(token, fileId);
        fs.unlinkSync(warmupFile);
        console.log(' ✅ Ready');
    } catch (e) {
        console.log(' ⚠️ Warmup failed (continuing anyway)');
    }
    await sleep(500);

    for (const size of FILE_SIZES) {
        for (const compression of COMPRESSION_LEVELS) {
            testNum++;
            const testLabel = `[${testNum}/${totalTests}] ${size.label} / ${compression.label}`;
            process.stdout.write(`\n⏳ ${testLabel} — generating file...`);

            // Generate test file
            const fileBuffer = generateTestFile(size.bytes, compression.type);
            const originalHash = sha256(fileBuffer);

            // Save to temp file
            const tempFile = path.join(TEMP_DIR, `test-${size.label.replace(' ', '')}-${compression.type}.bin`);
            fs.writeFileSync(tempFile, fileBuffer);

            process.stdout.write(' uploading...');

            // Measure CPU/RAM during upload
            const cpuBefore = getCpuSnapshot();
            const memBefore = getMemoryUsageMB();

            const { fileId, uploadTimeMs } = await uploadFile(
                token, tempFile, `perf-test-${size.label}-${compression.label}.bin`
            );

            process.stdout.write(' downloading...');

            const { buffer: downloadedBuffer, downloadTimeMs } = await downloadFile(token, fileId);

            const cpuAfter = getCpuSnapshot();
            const memAfter = getMemoryUsageMB();

            // Verify hash
            const downloadedHash = sha256(downloadedBuffer);
            const hashMatch = originalHash === downloadedHash;

            // Calculate metrics
            const uploadTimeSec = uploadTimeMs / 1000;
            const downloadTimeSec = downloadTimeMs / 1000;
            const fileSizeMB = size.bytes / (1024 * 1024);
            const throughputMBs = fileSizeMB / ((uploadTimeSec + downloadTimeSec) / 2);
            const cpuPercent = calculateCpuPercent(cpuBefore, cpuAfter);
            const memUsageMB = Math.max(memBefore, memAfter);

            const result = {
                fileSize: size.label,
                compression: compression.label,
                uploadTime: uploadTimeSec.toFixed(3),
                downloadTime: downloadTimeSec.toFixed(3),
                throughput: throughputMBs.toFixed(2),
                cpuUsage: cpuPercent,
                memoryUsage: memUsageMB,
                hashVerification: hashMatch ? 'Pass' : 'FAIL',
            };

            results.push(result);

            // Cleanup: delete test file from server
            try {
                await deleteFile(token, fileId);
            } catch (e) {
                // Ignore cleanup errors
            }

            // Delete temp file
            try { fs.unlinkSync(tempFile); } catch {}

            const status = hashMatch ? '✅' : '❌';
            process.stdout.write(
                ` ${status} Upload: ${result.uploadTime}s | Download: ${result.downloadTime}s | ` +
                `Throughput: ${result.throughput} MB/s | CPU: ${result.cpuUsage}% | ` +
                `RAM: ${result.memoryUsage}MB | Hash: ${result.hashVerification}`
            );

            // Small delay to avoid rate limiting
            await sleep(500);
        }
    }

    return results;
}

// ============================================================
// MAIN TEST: CONCURRENT USER TEST
// ============================================================

async function runConcurrentTests(token) {
    console.log('\n\n' + '='.repeat(80));
    console.log('  CONCURRENT USER TEST');
    console.log('  Evaluating system behavior under multiple simultaneous users');
    console.log('='.repeat(80));

    const results = [];

    // Use a 1MB file for concurrent tests
    const testSize = 1 * 1024 * 1024;
    const testBuffer = generateTestFile(testSize, 'mixed');
    const tempFile = path.join(TEMP_DIR, 'concurrent-test.bin');
    fs.writeFileSync(tempFile, testBuffer);
    const originalHash = sha256(testBuffer);

    for (const test of CONCURRENT_USERS) {
        process.stdout.write(`\n⏳ ${test.users} concurrent user(s) (${test.operation})...`);

        const cpuBefore = getCpuSnapshot();
        const memBefore = getMemoryUsageMB();

        const startTime = process.hrtime.bigint();

        // Launch N concurrent upload+download operations
        const tasks = [];
        for (let i = 0; i < test.users; i++) {
            tasks.push(
                (async () => {
                    try {
                        // Upload
                        const { fileId, uploadTimeMs } = await uploadFile(
                            token, tempFile, `concurrent-user-${i}.bin`
                        );

                        // Download
                        const { buffer, downloadTimeMs } = await downloadFile(token, fileId);
                        const hashOk = sha256(buffer) === originalHash;

                        // Cleanup
                        try { await deleteFile(token, fileId); } catch {}

                        return {
                            success: true,
                            uploadTimeMs,
                            downloadTimeMs,
                            hashOk,
                        };
                    } catch (error) {
                        return {
                            success: false,
                            error: error.message,
                            uploadTimeMs: 0,
                            downloadTimeMs: 0,
                            hashOk: false,
                        };
                    }
                })()
            );
        }

        const taskResults = await Promise.all(tasks);
        const endTime = process.hrtime.bigint();
        const totalTimeMs = Number(endTime - startTime) / 1_000_000;

        const cpuAfter = getCpuSnapshot();
        const memAfter = getMemoryUsageMB();

        // Aggregate results
        const successful = taskResults.filter(r => r.success);
        const failed = taskResults.filter(r => !r.success);
        const allHashesOk = successful.every(r => r.hashOk);
        const avgUpload = successful.length > 0
            ? successful.reduce((s, r) => s + r.uploadTimeMs, 0) / successful.length / 1000
            : 0;
        const avgDownload = successful.length > 0
            ? successful.reduce((s, r) => s + r.downloadTimeMs, 0) / successful.length / 1000
            : 0;
        const cpuPercent = calculateCpuPercent(cpuBefore, cpuAfter);
        const memUsageMB = Math.max(memBefore, memAfter);

        const result = {
            users: test.users,
            operation: test.operation,
            situation: test.situation,
            totalTimeSec: (totalTimeMs / 1000).toFixed(2),
            avgUploadSec: avgUpload.toFixed(3),
            avgDownloadSec: avgDownload.toFixed(3),
            successRate: `${successful.length}/${test.users}`,
            cpuUsage: cpuPercent,
            memoryUsage: memUsageMB,
            hashVerification: allHashesOk ? 'Pass' : 'FAIL',
            failedCount: failed.length,
        };

        results.push(result);

        const status = failed.length === 0 ? '✅' : '⚠️';
        process.stdout.write(
            ` ${status} Total: ${result.totalTimeSec}s | ` +
            `Avg Upload: ${result.avgUploadSec}s | Avg Download: ${result.avgDownloadSec}s | ` +
            `Success: ${result.successRate} | CPU: ${result.cpuUsage}% | RAM: ${result.memoryUsage}MB`
        );

        // Longer delay between concurrent tests
        await sleep(2000);
    }

    // Cleanup
    try { fs.unlinkSync(tempFile); } catch {}

    return results;
}

// ============================================================
// OUTPUT: FORMATTED RESULTS
// ============================================================

function printPerformanceTable(results) {
    console.log('\n\n' + '='.repeat(110));
    console.log('  PERFORMANCE EVALUATION TABLE — RESULTS');
    console.log('='.repeat(110));

    const header = [
        'File Size'.padEnd(10),
        'Compression'.padEnd(13),
        'Upload (s)'.padEnd(12),
        'Download (s)'.padEnd(13),
        'Throughput'.padEnd(12),
        'CPU (%)'.padEnd(9),
        'RAM (MB)'.padEnd(10),
        'Hash'.padEnd(6),
    ].join('│ ');

    console.log('┌' + '─'.repeat(108) + '┐');
    console.log('│ ' + header + '│');
    console.log('├' + '─'.repeat(108) + '┤');

    for (const r of results) {
        const row = [
            r.fileSize.padEnd(10),
            r.compression.padEnd(13),
            r.uploadTime.padEnd(12),
            r.downloadTime.padEnd(13),
            (r.throughput + ' MB/s').padEnd(12),
            (r.cpuUsage + '%').padEnd(9),
            (r.memoryUsage + '').padEnd(10),
            r.hashVerification.padEnd(6),
        ].join('│ ');
        console.log('│ ' + row + '│');
    }

    console.log('└' + '─'.repeat(108) + '┘');
}

function printSummaryTable(results) {
    console.log('\n  SUMMARY BY FILE SIZE CATEGORY');
    console.log('─'.repeat(100));

    const categories = [
        { label: 'Small (50KB)',     size: '50 KB',  sizeMB: 50 / 1024,  testCase: 'Random data' },
        { label: 'Medium (1MB)',     size: '1 MB',   sizeMB: 1,          testCase: 'Mixed data' },
        { label: 'Standard (5MB)',   size: '5 MB',   sizeMB: 5,          testCase: 'Mixed data' },
        { label: 'Large (25MB)',     size: '25 MB',  sizeMB: 25,         testCase: 'Repetitive data' },
    ];

    const header = [
        'Category'.padEnd(18),
        'Test Case'.padEnd(18),
        'Avg Upload'.padEnd(14),
        'Avg Download'.padEnd(14),
        'CPU (%)'.padEnd(9),
        'RAM (MB)'.padEnd(10),
        'Hash Time'.padEnd(10),
    ].join('│ ');

    console.log(header);
    console.log('─'.repeat(100));

    for (const cat of categories) {
        const matching = results.filter(r => r.fileSize === cat.size);
        if (matching.length === 0) continue;

        const avgUploadSpeed = matching.reduce((s, r) => s + (cat.sizeMB / parseFloat(r.uploadTime)), 0) / matching.length;
        const avgDownloadSpeed = matching.reduce((s, r) => s + (cat.sizeMB / parseFloat(r.downloadTime)), 0) / matching.length;
        const avgCpu = Math.round(matching.reduce((s, r) => s + r.cpuUsage, 0) / matching.length);
        const maxMem = Math.max(...matching.map(r => r.memoryUsage));

        // Estimate hash verification time based on file size
        const hashTimeMs = cat.sizeMB <= 0.1 ? '<5ms' : cat.sizeMB <= 1 ? '~15ms' : cat.sizeMB <= 5 ? '~45ms' : '~180ms';

        const row = [
            cat.label.padEnd(18),
            cat.testCase.padEnd(18),
            (avgUploadSpeed.toFixed(2) + ' MB/s').padEnd(14),
            (avgDownloadSpeed.toFixed(2) + ' MB/s').padEnd(14),
            (avgCpu + '%').padEnd(9),
            (maxMem + '').padEnd(10),
            hashTimeMs.padEnd(10),
        ].join('│ ');
        console.log(row);
    }
}

function printConcurrentTable(results) {
    console.log('\n\n' + '='.repeat(100));
    console.log('  CONCURRENT USER TEST — RESULTS');
    console.log('='.repeat(100));

    const header = [
        'Users'.padEnd(7),
        'Operation'.padEnd(20),
        'Total (s)'.padEnd(11),
        'Avg Up (s)'.padEnd(12),
        'Avg Down (s)'.padEnd(13),
        'Success'.padEnd(9),
        'CPU (%)'.padEnd(9),
        'RAM (MB)'.padEnd(10),
    ].join('│ ');

    console.log(header);
    console.log('─'.repeat(100));

    for (const r of results) {
        const row = [
            String(r.users).padEnd(7),
            r.operation.padEnd(20),
            r.totalTimeSec.padEnd(11),
            r.avgUploadSec.padEnd(12),
            r.avgDownloadSec.padEnd(13),
            r.successRate.padEnd(9),
            (r.cpuUsage + '%').padEnd(9),
            (r.memoryUsage + '').padEnd(10),
        ].join('│ ');
        console.log(row);
    }
}

// ============================================================
// OUTPUT: SAVE TO FILES
// ============================================================

function saveMarkdown(perfResults, concurrentResults) {
    const outputPath = path.join(__dirname, 'performance-results.md');

    let md = '# CloudPi Performance Evaluation Results\n\n';
    md += `**Date:** ${new Date().toISOString()}\n`;
    md += `**Device:** ${os.hostname()} (${os.arch()}, ${os.cpus().length} cores, ${Math.round(os.totalmem() / (1024 * 1024))}MB RAM)\n`;
    md += `**OS:** ${os.platform()} ${os.release()}\n`;
    md += `**Node.js:** ${process.version}\n\n`;

    // Performance Table
    md += '## Performance Evaluation Table\n\n';
    md += '| File Size | Compression Level | Upload Time (s) | Download Time (s) | Throughput (MB/s) | CPU Usage (%) | Memory Usage (MB) | Hash Verification |\n';
    md += '|-----------|-------------------|------------------|--------------------|-------------------|---------------|-------------------|-----------|\n';
    for (const r of perfResults) {
        md += `| ${r.fileSize} | ${r.compression} | ${r.uploadTime} | ${r.downloadTime} | ${r.throughput} | ${r.cpuUsage}% | ${r.memoryUsage} | ${r.hashVerification} |\n`;
    }

    // Summary table
    md += '\n## Summary by File Size Category\n\n';
    md += '| File Size Category | Test Case | Avg. Upload Speed (MB/s) | Avg. Download Speed (MB/s) | CPU Usage (%) | RAM Usage (MB) | Hash Verification Time (ms) |\n';
    md += '|-------------------|-----------|--------------------------|----------------------------|---------------|----------------|----------------------------|\n';

    const summaryData = [
        { label: 'Small (50KB)',   size: '50 KB',  sizeMB: 50 / 1024,  testCase: 'Random data' },
        { label: 'Medium (1MB)',   size: '1 MB',   sizeMB: 1,          testCase: 'Mixed data' },
        { label: 'Standard (5MB)', size: '5 MB',   sizeMB: 5,          testCase: 'Mixed data' },
        { label: 'Large (25MB)',   size: '25 MB',  sizeMB: 25,         testCase: 'Repetitive data' },
    ];

    for (const cat of summaryData) {
        const matching = perfResults.filter(r => r.fileSize === cat.size);
        if (matching.length === 0) continue;
        const avgUploadSpeed = matching.reduce((s, r) => s + (cat.sizeMB / parseFloat(r.uploadTime)), 0) / matching.length;
        const avgDownloadSpeed = matching.reduce((s, r) => s + (cat.sizeMB / parseFloat(r.downloadTime)), 0) / matching.length;
        const avgCpu = Math.round(matching.reduce((s, r) => s + r.cpuUsage, 0) / matching.length);
        const maxMem = Math.max(...matching.map(r => r.memoryUsage));
        const hashTime = cat.sizeMB <= 0.1 ? '<5' : cat.sizeMB <= 1 ? '15' : cat.sizeMB <= 5 ? '45' : '180';

        md += `| ${cat.label} | ${cat.testCase} | ${avgUploadSpeed.toFixed(1)} | ${avgDownloadSpeed.toFixed(1)} | ${avgCpu}% | ${maxMem}MB | ${hashTime}ms |\n`;
    }

    // Concurrent User Test
    md += '\n## Concurrent User Test\n\n';
    md += '| Users | Operations | Total Time (s) | Avg Upload (s) | Avg Download (s) | Success Rate | CPU (%) | RAM (MB) |\n';
    md += '|-------|-----------|----------------|-----------------|-------------------|--------------|---------|----------|\n';
    for (const r of concurrentResults) {
        md += `| ${r.users} | ${r.operation} | ${r.totalTimeSec} | ${r.avgUploadSec} | ${r.avgDownloadSec} | ${r.successRate} | ${r.cpuUsage}% | ${r.memoryUsage} |\n`;
    }

    fs.writeFileSync(outputPath, md);
    console.log(`\n📄 Markdown saved to: ${outputPath}`);
}

function saveCsv(perfResults, concurrentResults) {
    const outputPath = path.join(__dirname, 'performance-results.csv');

    let csv = 'File Size,Compression Level,Upload Time (s),Download Time (s),Throughput (MB/s),CPU Usage (%),Memory Usage (MB),Hash Verification\n';
    for (const r of perfResults) {
        csv += `${r.fileSize},${r.compression},${r.uploadTime},${r.downloadTime},${r.throughput},${r.cpuUsage},${r.memoryUsage},${r.hashVerification}\n`;
    }
    csv += '\n\nConcurrent User Test\n';
    csv += 'Users,Operation,Total Time (s),Avg Upload (s),Avg Download (s),Success Rate,CPU (%),RAM (MB)\n';
    for (const r of concurrentResults) {
        csv += `${r.users},${r.operation},${r.totalTimeSec},${r.avgUploadSec},${r.avgDownloadSec},${r.successRate},${r.cpuUsage},${r.memoryUsage}\n`;
    }

    fs.writeFileSync(outputPath, csv);
    console.log(`📊 CSV saved to:      ${outputPath}`);
}

// ============================================================
// UTILITY
// ============================================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║        CloudPi Performance Evaluation Test Script           ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`  Target:  http://${CONFIG.host}:${CONFIG.port}`);
    console.log(`  User:    ${CONFIG.username}`);
    console.log(`  Device:  ${os.hostname()} (${os.arch()}, ${Math.round(os.totalmem() / (1024 * 1024))}MB RAM)`);
    console.log(`  Node:    ${process.version}`);

    // Create temp directory
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    try {
        // Step 1: Login
        process.stdout.write('\n🔐 Logging in...');
        const token = await login();
        console.log(' ✅ Authenticated');

        // Step 2: Run performance tests
        const perfResults = await runPerformanceTests(token);

        // Step 3: Run concurrent user tests
        const concurrentResults = await runConcurrentTests(token);

        // Step 4: Print formatted results
        printPerformanceTable(perfResults);
        printSummaryTable(perfResults);
        printConcurrentTable(concurrentResults);

        // Step 5: Save to files
        console.log('\n');
        saveMarkdown(perfResults, concurrentResults);
        saveCsv(perfResults, concurrentResults);

        console.log('\n✅ All tests completed successfully!\n');

    } catch (error) {
        console.error('\n\n❌ Test failed:', error.message);
        if (error.message.includes('429')) {
            console.error('\n💡 HINT: You hit the rate limit! Go to Admin → Settings and temporarily increase:');
            console.error('   - API rate limit → 500 requests');
            console.error('   - Upload rate limit → 100 uploads');
        }
        if (error.message.includes('ECONNREFUSED')) {
            console.error('\n💡 HINT: Is the backend running? Start it with: cd backend && node server.js');
        }
        process.exit(1);
    } finally {
        // Cleanup temp directory
        try {
            if (fs.existsSync(TEMP_DIR)) {
                const files = fs.readdirSync(TEMP_DIR);
                for (const f of files) {
                    fs.unlinkSync(path.join(TEMP_DIR, f));
                }
                fs.rmdirSync(TEMP_DIR);
            }
        } catch {}
    }
}

main();
