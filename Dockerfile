# Globetrotter 2025 Atlas — static site container.
#
# Serves the pre-built site (data.js is committed, so there is no build step) with
# nginx on $PORT. Defaults to 8080, the port GCP containers (Cloud Run, App Engine
# flexible, GKE) inject and expect the process to listen on.
#
#   docker build -t globetrotter .
#   docker run --rm -p 8080:8080 globetrotter          # http://localhost:8080
#   docker run --rm -e PORT=3000 -p 3000:3000 globetrotter
FROM nginx:1.29-alpine

# Cloud Run sets PORT itself; this is the fallback for local runs and other hosts.
# NGINX_ENVSUBST_FILTER keeps the image's template renderer from eating nginx's own
# runtime variables ($uri, $host, …) — only ${PORT} is substituted.
ENV PORT=8080 \
    NGINX_ENVSUBST_FILTER=PORT

# The stock server block listens on 80 and would shadow ours at the same server_name.
RUN rm /etc/nginx/conf.d/default.conf

COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template

# Site payload, ordered least- to most-frequently changed for layer reuse.
COPY assets/ /usr/share/nginx/html/assets/
COPY media/ /usr/share/nginx/html/media/
COPY *.html *.js styles.css /usr/share/nginx/html/

EXPOSE 8080
