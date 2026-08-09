# Stage 1: Build python dependencies
FROM python:3.12-slim as builder

WORKDIR /app

# Install system utilities needed to compile wheel packages (e.g. psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Force fresh install (bust Docker layer cache)
ARG CACHEBUST=4
RUN pip install --no-cache-dir --user -r requirements.txt

# Stage 2: Final runtime container
FROM python:3.12-slim as runner

WORKDIR /app

# Install system runtime dependencies (Default Java JRE for ThetaTerminal, curl, libpq5)
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless \
    curl \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy user-installed packages from builder stage
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Copy source code files and official ThetaTerminal v3 JAR
COPY . .

# Make start.sh executable
RUN chmod +x /app/start.sh

# Expose port and run container startup script
EXPOSE 8000
CMD ["/app/start.sh"]
