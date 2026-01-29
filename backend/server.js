/**
 * CLOUDPI BACKEND SERVER
 * ======================
 * Main entry point for the Express.js API server
 * 
 * WHAT THIS FILE DOES:
 * 1. Sets up Express with middleware (cors, json parsing)
 * 2. Imports the database connection (which creates tables)
 * 3. Mounts route handlers (will add more later)
 * 4. Starts the server on port 3001
 */

const express = require('express');
const cors = require('cors');
const path = require('path');

// Import database - this also initializes all tables!
const db = require('./database/db');

// Create Express app
const app = express();

/**
 * MIDDLEWARE SETUP
 * ----------------
 * Middleware are functions that run on every request before your routes
 */

// CORS: Allows your Next.js frontend (port 3000) to call this API (port 3001)
// Without this, browsers block cross-origin requests for security
app.use(cors({
  origin: 'http://localhost:3000',  // Your frontend URL
  credentials: true                  // Allow cookies if needed later
}));

// Parse JSON bodies - lets you read req.body when frontend sends JSON
app.use(express.json());

// Serve uploaded files statically
// Example: GET /uploads/myfile.jpg will serve backend/uploads/myfile.jpg
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/**
 * TEST ENDPOINT
 * -------------
 * Simple endpoint to verify the server is running
 * Test it: http://localhost:3001/api/test
 */
app.get('/api/test', (req, res) => {
  res.json({
    message: 'CloudPi Backend is running!',
    database: 'Connected',
    timestamp: new Date().toISOString()
  });
});

/**
 * ROUTES SETUP
 * ------------
 * Import and mount route handlers
 */

// Auth routes (login, setup, get current user)
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Admin routes (user management - admin only)
const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

// Future routes will go here:
// const fileRoutes = require('./routes/files');
// app.use('/api/files', fileRoutes);

// Start server
const PORT = 3001;
app.listen(PORT, () => {
  console.log('');
  console.log('🚀 CloudPi Backend Server Started!');
  console.log(`   URL: http://localhost:${PORT}`);
  console.log(`   Test: http://localhost:${PORT}/api/test`);
  console.log('');
});