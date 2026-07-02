# Build context must be the repo root:
#   docker build -f worker-server/Dockerfile -t dj-wavy-worker .

FROM node:22-slim

# Install system ffmpeg + TLS certs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install worker dependencies (uses worker-server/package.json)
COPY worker-server/package.json ./
RUN npm install --omit=dev

# Copy shared library from repo root
COPY src/lib ./src/lib

# Copy worker entrypoint + tsconfig
COPY worker-server/src ./worker-server/src
COPY worker-server/tsconfig.json ./worker-server/tsconfig.json

# Use system ffmpeg (overrides ffmpeg-static fallback in decode.ts)
ENV FFMPEG_PATH=ffmpeg
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node_modules/.bin/tsx", "--tsconfig", "worker-server/tsconfig.json", "worker-server/src/server.ts"]
