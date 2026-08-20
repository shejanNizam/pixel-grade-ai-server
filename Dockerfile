# ---- Build stage ----
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Production stage ----
FROM node:22-alpine AS production
WORKDIR /app

# Run as non-root user
# Install system fonts for sharp/librsvg SVG text rendering on Linux
RUN apk add --no-cache fontconfig font-dejavu ttf-freefont

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Copy email templates (already handled by build script, but dist/templates must exist)
RUN mkdir -p logs

USER appuser

EXPOSE 5000

CMD ["node", "dist/server.js"]
