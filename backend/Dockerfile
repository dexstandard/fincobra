FROM node:22.19.0-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
COPY package*.json ./
# Install production dependencies inside the image so native modules
# are built against the Alpine base rather than the CI environment.
RUN npm ci --omit=dev && rm -rf dist
COPY dist ./dist
RUN mkdir -p /data && chown -R node:node /app /data
USER node
CMD ["npm", "start"]
