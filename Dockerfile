# Dockerfile

# ---- Stage 1: The Builder ----
FROM node:20-alpine AS builder
WORKDIR /data/app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build


# ---- Stage 2: The Runner ----
FROM node:20-alpine
WORKDIR /data/app
COPY package*.json ./
RUN npm i --omit=dev
COPY --from=builder /data/app/dist ./dist
EXPOSE 3000

CMD ["nodemon", "dist/index.js"]