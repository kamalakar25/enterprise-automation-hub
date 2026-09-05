FROM node:20-bookworm-slim

# Install Python 3 and basic build tools for headless scripts
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy application files
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Create storage directories
RUN mkdir -p storage/uploads storage/reports storage/logs

EXPOSE 4000

CMD ["node", "src/server.js"]
