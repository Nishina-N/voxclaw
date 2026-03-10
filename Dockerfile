FROM node:20-slim

# Install docker CLI and native module build tools (required by better-sqlite3)
RUN apt-get update && \
    apt-get install -y docker.io python3 make g++ && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy source code and configuration files
COPY . .

# Build step is not strictly necessary since we use tsx, but we will run via tsx directly
CMD ["npm", "start"]
