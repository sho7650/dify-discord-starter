# Stage 1: Build the application
FROM node:22-slim AS builder

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies (reproducible, prod-only; typescript is a prod dep so build works)
RUN npm ci --omit=dev

# Copy the rest of the application code
COPY . .

# Build the TypeScript application
RUN npm run build

# Stage 2: Create the production image
FROM node:22-slim AS production

# Set working directory
WORKDIR /app

# Copy only the necessary files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Expose the port if your bot needs to run on one
EXPOSE 3000

# Command to run the bot
CMD ["node", "dist/index.js"]
