# Minimal alertmanager-webhook-receiver image.
#
# Stdlib-only Python (http.server, json) — no requirements file, no
# package install. python:3.12-alpine gives us ~15 MB compressed.
FROM python:3.12-alpine

# Non-root user matching the Deployment's runAsUser: 65534.
RUN addgroup -g 65534 -S nobody-grp 2>/dev/null || true \
  && adduser  -u 65534 -S -G nobody-grp -H nobody-usr 2>/dev/null || true

WORKDIR /app
COPY main.py /app/main.py

USER 65534:65534

ENV PYTHONUNBUFFERED=1 \
    INBOX_PATH=/inbox/INBOX.md \
    LISTEN_PORT=8080

EXPOSE 8080
ENTRYPOINT ["python", "/app/main.py"]
