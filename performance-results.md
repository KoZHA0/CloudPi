# CloudPi Performance Evaluation Results

**Date:** 2026-05-12T22:25:21.358Z
**Device:** pi (arm64, 4 cores, 906MB RAM)
**OS:** linux 6.12.47+rpt-rpi-v8
**Node.js:** v20.19.2

## Performance Evaluation Table

| File Size | Compression Level | Upload Time (s) | Download Time (s) | Throughput (MB/s) | CPU Usage (%) | Memory Usage (MB) | Hash Verification |
|-----------|-------------------|------------------|--------------------|-------------------|---------------|-------------------|-----------|
| 50 KB | None | 0.051 | 0.032 | 1.31 | 33% | 370 | Pass |
| 50 KB | 50% | 0.047 | 0.029 | 1.35 | 30% | 370 | Pass |
| 50 KB | 75% | 0.067 | 0.082 | 1.16 | 32% | 370 | Pass |
| 500 KB | None | 0.143 | 0.111 | 4.41 | 24% | 368 | Pass |
| 500 KB | 50% | 0.102 | 0.096 | 4.93 | 27% | 369 | Pass |
| 500 KB | 75% | 0.091 | 0.090 | 5.48 | 28% | 369 | Pass |
| 1 MB | None | 0.168 | 0.153 | 6.32 | 25% | 375 | Pass |
| 1 MB | 50% | 0.413 | 0.155 | 3.57 | 24% | 377 | Pass |
| 1 MB | 75% | 0.238 | 0.156 | 5.56 | 26% | 379 | Pass |
| 5 MB | None | 1.184 | 0.779 | 5.10 | 23% | 402 | Pass |
| 5 MB | 50% | 1.146 | 0.835 | 5.14 | 23% | 403 | Pass |
| 5 MB | 75% | 1.041 | 0.880 | 5.25 | 22% | 399 | Pass |
| 25 MB | None | 5.494 | 4.408 | 5.09 | 22% | 477 | Pass |
| 25 MB | 50% | 5.691 | 3.896 | 5.23 | 22% | 521 | Pass |
| 25 MB | 75% | 7.008 | 4.022 | 4.55 | 19% | 519 | Pass |

## Summary by File Size Category

| File Size Category | Test Case | Avg. Upload Speed (MB/s) | Avg. Download Speed (MB/s) | CPU Usage (%) | RAM Usage (MB) | Hash Verification Time (ms) |
|-------------------|-----------|--------------------------|----------------------------|---------------|----------------|----------------------------|
| Small (50KB) | Random data | 0.9 | 1.3 | 32% | 370MB | <5ms |
| Medium (1MB) | Mixed data | 4.2 | 6.5 | 25% | 379MB | 15ms |
| Standard (5MB) | Mixed data | 4.5 | 6.0 | 23% | 403MB | 45ms |
| Large (25MB) | Repetitive data | 4.2 | 6.1 | 21% | 521MB | 180ms |

## Concurrent User Test

| Users | Operations | Total Time (s) | Avg Upload (s) | Avg Download (s) | Success Rate | CPU (%) | RAM (MB) |
|-------|-----------|----------------|-----------------|-------------------|--------------|---------|----------|
| 1 | Upload/download | 0.70 | 0.364 | 0.160 | 1/1 | 20% | 493 |
| 5 | Mixed operations | 2.68 | 1.370 | 0.432 | 5/5 | 25% | 488 |
| 10 | Mixed operations | 5.02 | 2.724 | 0.436 | 10/10 | 24% | 451 |
| 20 | Stress condition | 10.37 | 5.684 | 0.450 | 20/20 | 24% | 451 |
