# ==============================================================
# CloudPi — Multi-stage Dockerfile
# ==============================================================
# Stage 1: Build the frontend (Vite + React)
# Stage 2: Production backend (Node.js + Express)
# Stage 3: Nginx to serve frontend + proxy to backend
# ==============================================================

# ── Stage 1: Build Frontend ─────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /build

# Copy frontend package files first (better layer caching)
COPY frontend/package.json frontend/package-lock.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build the production bundle
RUN npm run build


# ── Stage 2: Backend ────────────────────────────────────────
FROM node:20-alpine AS backend

# Install sqlite3 build tools (needed for better-sqlite3 native compilation)
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app/backend

# Copy backend package files first (better layer caching)
COPY backend/package.json backend/package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy backend source
COPY backend/ ./

# Remove dev/test files from the image
RUN rm -rf tests walkthroughs .env .env.example

# Create directories for persistent data
RUN mkdir -p uploads storage

EXPOSE 3001

CMD ["node", "server.js"]


# ── Stage 3: Nginx (serves frontend + proxies API) ──────────
FROM nginx:alpine AS nginx

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy the built frontend
COPY --from=frontend-build /build/dist /usr/share/nginx/html

# Nginx config will be mounted via docker-compose

EXPOSE 80 443
