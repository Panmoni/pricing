# Use a Node.js base image suitable for running TypeScript with ts-node
FROM node:18-alpine

# Set working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to leverage Docker cache
COPY package.json package-lock.json ./

# Install all dependencies, including devDependencies needed for ts-node
RUN npm install

# Copy application source code and TypeScript configuration
COPY src ./src
COPY tsconfig.json ./

# Expose the port the application listens on (defined in src/pricing-server.ts)
EXPOSE 4000

# Command to run the application using ts-node
# It expects the .env file to be mounted at /app/.env via the 'podman run' command
CMD ["npx", "ts-node", "src/pricing-server.ts"]