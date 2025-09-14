FROM caddy:2.7-alpine
ARG FRONTEND_BUILD_DIR=dist
COPY Caddyfile /etc/caddy/Caddyfile
COPY frontend/${FRONTEND_BUILD_DIR}/ /usr/share/caddy/
