# ===== Base Image =====
FROM node:20-alpine

# ===== Create app directory =====
WORKDIR /app

# ===== Copy package files =====
COPY package*.json ./

# ===== Install only production dependencies =====
RUN npm install --omit=dev

# ===== Copy source code =====
COPY . .

# ===== Environment =====
ENV NODE_ENV=production

# ===== Expose port (Fly/Render sẽ override bằng PORT) =====
EXPOSE 5000

# ===== Start app =====
CMD ["npm", "start"]