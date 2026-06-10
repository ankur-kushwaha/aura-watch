# Stage 1: Build the frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Build the backend and prepare production node_modules
FROM node:20-bookworm-slim AS backend-builder
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
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

# Stage 3: Production runner
FROM node:20-bookworm-slim AS runner
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl ffmpeg libgomp1 python3 python3-venv python3-pip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

ENV NODE_ENV=production

# Copy root package.json for root scripts
COPY package*.json ./

# Copy backend files
COPY --from=backend-builder /app/backend/package*.json ./backend/
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=backend-builder /app/backend/node_modules ./backend/node_modules
COPY --from=backend-builder /app/backend/prisma ./backend/prisma
COPY --from=backend-builder /app/backend/models ./backend/models

# ReID worker — venv must be built in this image (copied venvs break interpreter symlinks)
COPY backend/requirements-reid.txt ./backend/
COPY backend/scripts/setup-reid-venv.sh ./backend/scripts/
RUN chmod +x backend/scripts/setup-reid-venv.sh && sh backend/scripts/setup-reid-venv.sh
ENV REID_PYTHON=/app/backend/.venv-reid/bin/python

# Copy built frontend assets
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port (default port is 5000)
EXPOSE 5000

# Start the application
CMD ["npm", "run", "start"]
