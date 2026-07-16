# Deployment Guide: Railway Cloud Deployment

This guide explains how to deploy the Atlas Options Platform (React Frontend, FastAPI Backend, TimescaleDB, and Redis) to the cloud using [Railway](https://railway.app/).

---

## Architecture Overview on Railway

We will provision four separate services inside a single Railway project:
1.  **PostgreSQL with TimescaleDB**: Handles raw option quotes and dealer metrics storage.
2.  **Redis**: Handles GEX heatmap caching and live WebSocket pub/sub diffs.
3.  **FastAPI Backend**: Runs the Python calculation engine, background publisher, and websocket router.
4.  **React Frontend**: Serves the Vite single-page application.

```
                  +-------------------------+
                  |     React Frontend      | <--- Mapped to public domain
                  +------------+------------+
                               | API Requests & WebSockets
                               v
                  +-------------------------+
                  |     FastAPI Backend     | <--- Mapped to public domain
                  +---+-----------------+---+
                      |                 |
                      v (SQL)           v (Pub/Sub & Caches)
              +-------+-------+  +------+------+
              |  TimescaleDB  |  |    Redis    |
              +---------------+  +-------------+
```

---

## Step 1: Provision Database & Cache Services

1.  Log in to [Railway](https://railway.app/) and click **New Project** -> **Start from Template**.
2.  **Add Redis**:
    *   Search for **Redis** and provision it.
    *   Railway will automatically assign a private `REDIS_URL` (e.g., `redis://default:password@host:port`).
3.  **Add PostgreSQL with TimescaleDB**:
    *   To support hypertables, we need a PostgreSQL container running the TimescaleDB extension.
    *   Click **New** -> **Docker Image**.
    *   Enter the official TimescaleDB image: `timescale/timescaledb:latest-pg15`.
    *   Add the following variables to this database service:
        *   `POSTGRES_DB`: `atlas`
        *   `POSTGRES_USER`: `postgres`
        *   `POSTGRES_PASSWORD`: `select_a_secure_password`
    *   Click **Save**. Railway will run the container and expose a private host and port.

---

## Step 2: Deploy the FastAPI Backend

1.  Click **New** -> **GitHub Repo** and select your `atlas` repository.
2.  Under the Service **Settings**:
    *   Rename the service to `atlas-backend`.
    *   Set the **Root Directory** to `backend`.
    *   Set the **Build Command** to: (Railway will auto-detect the `Dockerfile` in `backend` and build it).
3.  Under the Service **Variables**, add:
    *   `PORT`: `8000` (FastAPI listener port)
    *   `DATABASE_URL`: `postgresql://postgres:select_a_secure_password@<timescaledb-service-private-domain>:5432/atlas`
    *   `REDIS_URL`: `${{Redis.REDIS_URL}}` (Railway template syntax linking directly to the Redis service variables)
    *   `POLYGON_API_KEY`: `your_polygon_api_key`
4.  Under **Settings**, click **Generate Domain** to assign a public HTTP address (e.g., `atlas-backend.up.railway.app`).

---

## Step 3: Deploy the React Frontend

1.  Click **New** -> **GitHub Repo** and select your `atlas` repository.
2.  Under the Service **Settings**:
    *   Rename the service to `atlas-frontend`.
    *   Set the **Root Directory** to `frontend`.
3.  Under the Service **Variables**, add:
    *   `VITE_API_BASE_URL`: `https://atlas-backend.up.railway.app` (The public domain URL generated for the backend in Step 2)
4.  Under **Settings**, click **Generate Domain** to assign a public frontend address (e.g., `atlas.up.railway.app`).

---

## Step 4: Verify Connectivity

1.  Open your public frontend URL (`https://atlas.up.railway.app`).
2.  Inspect the page network requests to verify that the frontend bootstraps by pulling configurations and snapshot histories from `https://atlas-backend.up.railway.app/api/v1/heatmap/SPY/history`.
3.  Click **"GO LIVE"**:
    *   Verify that a connection opens to `wss://atlas-backend.up.railway.app/api/v1/ws/SPY`.
    *   Check that the pulsing green connection indicator turns on and cell-level diffs are streamed successfully via Redis!
