FROM node:20-slim

# Install docker CLI so that dockerode can use the socket efficiently and for nested commands if needed
RUN apt-get update && \
    apt-get install -y docker.io && \
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
