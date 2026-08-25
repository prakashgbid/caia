FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN groupadd -r vintake && useradd -r -g vintake -u 10171 vintake
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
USER vintake
CMD ["python", "-m", "app.main"]
