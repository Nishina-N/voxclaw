FROM node:20-slim

# Install build tools required by better-sqlite3 native module
RUN apt-get update && \
    apt-get install -y python3 python3-pip make g++ curl && \
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
