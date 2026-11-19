# ==============================================================================
# Multi-stage Production Dockerfile for LMS Backend
# ==============================================================================

# Stage 1: Build & Dependencies
FROM node:22-alpine AS builder

WORKDIR /usr/src/app

# Install build dependencies
RUN apk add --no-cache openssl python3 make g++

# Copy package manifests
COPY package*.json ./

# Install all dependencies (including devDependencies for build and prisma)
RUN npm ci

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy source code and build config
COPY tsconfig*.json ./
COPY src ./src/

# Compile TypeScript
RUN npm run build

# Remove development dependencies to keep production image lean
RUN npm prune --omit=dev

# ------------------------------------------------------------------------------
# Stage 2: Minimal Production Runtime
# ------------------------------------------------------------------------------
FROM node:22-alpine AS runner

WORKDIR /usr/src/app

# Install openssl for Prisma runtime
RUN apk add --no-cache openssl

ENV NODE_ENV=production
ENV PORT=3000

# Create non-root system group and user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs

# Copy runtime files from builder stage
COPY --chown=appuser:nodejs package*.json ./
COPY --chown=appuser:nodejs --from=builder /usr/src/app/node_modules ./node_modules
COPY --chown=appuser:nodejs --from=builder /usr/src/app/dist ./dist
COPY --chown=appuser:nodejs --from=builder /usr/src/app/prisma ./prisma

# Switch to non-root user
USER appuser

EXPOSE 3000

# Start production application
CMD ["node", "dist/src/main.js"]
