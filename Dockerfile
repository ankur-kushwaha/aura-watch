# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and prepare production node_modules
FROM node:20-alpine AS backend-builder
RUN apk add --no-cache openssl
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
# Generate Prisma Client (needed for build and runtime)
RUN npx prisma generate
# Compile TypeScript to JavaScript
RUN npm run build
# Prune devDependencies to keep the image slim
RUN npm prune --omit=dev

# Stage 3: ReID Python venv (ONNX Runtime only — no PyTorch)
FROM python:3.12-slim-bookworm AS reid-builder
WORKDIR /app/backend
COPY backend/requirements-reid.txt ./
COPY backend/models ./models
COPY backend/scripts/setup-reid-venv.sh scripts/
RUN chmod +x scripts/setup-reid-venv.sh && sh scripts/setup-reid-venv.sh

# Stage 4: Production runner
FROM node:20-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ffmpeg libgomp1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV NODE_ENV=production
ENV REID_PYTHON=/app/backend/.venv-reid/bin/python

# Copy root package.json for root scripts
COPY package*.json ./

# Copy backend files
COPY --from=backend-builder /app/backend/package*.json ./backend/
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/prisma ./backend/prisma
COPY --from=reid-builder /app/backend/.venv-reid ./backend/.venv-reid
COPY --from=backend-builder /app/backend/models ./backend/models

# Copy built frontend assets
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port (default port is 5000)
EXPOSE 5000

# Start the application
CMD ["npm", "run", "start"]
