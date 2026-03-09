FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pipeline/requirements.txt /app/pipeline/requirements.txt
RUN pip install --no-cache-dir -r /app/pipeline/requirements.txt

COPY pipeline /app/pipeline

# Azure Web App health probes can hit /health on WEBSITES_PORT.
ENV WEBSITES_PORT=8000
EXPOSE 8000

CMD ["python", "-m", "pipeline.worker"]
