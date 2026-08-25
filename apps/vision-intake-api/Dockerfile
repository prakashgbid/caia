# CAIA Vision Intake API — production image
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN groupadd -r vintake && useradd -r -g vintake -u 10170 vintake
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
COPY openapi.yaml .
USER vintake
EXPOSE 9170
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD python -c "import urllib.request as u; import sys; sys.exit(0 if u.urlopen('http://127.0.0.1:9170/health').getcode()==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "9170"]
