# Atlas Options Positioning Analytics — Project Context & Handover Summary

**Date:** July 23, 2026  
**Git Repository:** `https://github.com/eyan88/atlas.git`  
**Active Branch:** `feature/base-provider`  
**Latest Commit:** `b6d0f67` ("fix: handle missing ThetaData EOD quotes gracefully and evaluate timezone correctly for today's market date")

---

## 1. Project Overview

**Atlas** is a real-time and replay-enabled Options Positioning & Dealer Gamma Analytics application. It tracks, visualizes, and analyzes market-maker gamma exposure (Net GEX), delta exposure (DEX), vanna, charm, and option open interest across major tickers (`SPY`, `QQQ`, `IWM`).

The application features three main views:
1. **Heatmap View**: Full strike vs. expiration exposure matrix with customizable color themes (Classic Red/Green vs. Sleek Atlas Teal/Purple), glassmorphic controls, and replay slider controls.
2. **Gamma Flow View**: Card-based grid visualization for tracking Net Flow premiums, net gamma shifts, and spot price positioning side-by-side.
3. **Compass View & Chart**: Interactive candlestick chart displaying actual 5-minute intraday price action overlayed with native options levels (**Call Wall**, **Put Wall**, **Gamma Flip**) and dynamic GEX magnitude bubbles.

---

## 2. Tech Stack

### Backend
- **Framework**: Python 3.10+ / FastAPI (Uvicorn server)
- **Database**: SQLite / TimescaleDB (`atlas.db`) via SQLAlchemy ORM
- **Cache & Pub/Sub**: Redis
- **Data Providers**: ThetaData Python SDK (`ThetaClient`) for historical & EOD options chain ingestion; Yahoo Finance API for historical 5m stock price action
- **Greeks Engine**: Local Rust Black-Scholes Greeks calculation module

### Frontend
- **Framework**: React 18 (TypeScript) with Vite build tool
- **State Management**: Zustand (`useAppStore.ts`)
- **Charting**: TradingView Lightweight Charts (`lightweight-charts` v5.2.0)
- **Styling**: Vanilla CSS Modules with glassmorphism, dynamic HSL dark mode palette, micro-animations, and modern typography

---

## 3. Key Components & Implementation Details

### A. Compass Candlestick Chart (`frontend/src/components/HeatmapContainer/CompassChart.tsx`)
- **Real Intraday Price Action**: Fetches actual 5-minute intraday stock price candles from `/api/v1/stock/{ticker}/candles?date=YYYY-MM-DD` (which proxies Yahoo Finance data).
- **Dynamic GEX Level Bubbles**:
  - Draws native canvas overlay circles for **Call Wall** (green), **Put Wall** (red/purple), and **Gamma Flip** (amber).
  - Bubbles dynamically scale in size (radius 3px to 8px) based on total GEX magnitude at that strike, capped to prevent visual intrusion over candlesticks.
- **Active vs. Prior Day GEX Toggle**:
  - **Active**: Maps options levels dynamically to the selected date's GEX snapshots (updating on replay playhead scrubber drag).
  - **Prior Day**: Locks options levels to the settled EOD values of the previous trading day (e.g. Monday close levels overlayed on Tuesday's session).
- **Playhead Marker**: Renders a dynamic marker bubble directly on the candle corresponding to the active replay timeline scrubber position.

### B. Heatmap & Replay Engine (`backend/app/api/endpoints/heatmap.py`)
- **`/api/v1/replay/timeline/{ticker}`**: Lists available timestamps for a given date. Uses US/Eastern timezone comparison (`America/New_York`) to avoid premature EOD backfilling on active trading dates.
- **`/api/v1/heatmap/{ticker}/history`**: Fetches full heatmap history for replay playback.
- **`/api/v1/stock/{ticker}/candles`**: Endpoints fetching actual 5m OHLC price candles.
- **`app/db/backfill_eod.py`**: Handles on-the-fly backfilling from ThetaData for historical dates with graceful exception handling when market quotes are not published yet.

---

## 4. Key File Map

| Path | Description |
| :--- | :--- |
| `frontend/src/components/HeatmapContainer/CompassChart.tsx` | Main Compass candlestick chart component using Lightweight Charts |
| `frontend/src/components/HeatmapContainer/CompassChart.module.css` | Glassmorphic styling & responsive layouts for Compass view |
| `frontend/src/store/useAppStore.ts` | Global Zustand state (snapshots, selected date, replay speed, color theme) |
| `frontend/src/api/client.ts` | API client helper methods for backend communication |
| `backend/app/main.py` | FastAPI backend entrypoint & route registration |
| `backend/app/api/endpoints/heatmap.py` | Core endpoints (timeline, heatmap history, stock candles) |
| `backend/app/db/backfill_eod.py` | ThetaData EOD historical data backfill script |
| `backend/app/core/config.py` | Environment configuration settings & supported tickers |

---

## 5. How to Run on a New Computer

### Prerequisites
- Python 3.10+
- Node.js 18+ & npm
- Git

### 1. Clone & Checkout Branch
```bash
git clone https://github.com/eyan88/atlas.git
cd atlas
git checkout feature/base-provider
```

### 2. Backend Setup
```bash
cd backend
python -m venv .venv
source .venv/bin/venv  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Start backend server
GRPC_DNS_RESOLVER=native ../.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

### 3. Frontend Setup
```bash
cd ../frontend
npm install

# Start Vite dev server
npm run dev
```

The web application will be accessible locally at `http://localhost:3000`.

---

## 6. Recent Git Commit Log

```
b6d0f67 fix: handle missing ThetaData EOD quotes gracefully and evaluate timezone correctly for today's market date
9bf59bf feat: revert GEX wall pills back to individual circles with capped max radius of 8px
291502e feat: render options levels as horizontal glassmorphic capsules to smooth and fill the chart timeline
d3d8613 feat: implement dynamic GEX wall size bubbles overlay canvas, remove Spot price-line, and add Active vs Prior Day GEX toggle
baa622d feat: align CompassChart GEX levels to map directly to active date snapshots, matching the heatmap grid values exactly
```
