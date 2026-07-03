import type { HeatmapSnapshot, Metric, ReplayTimeline, TickerInfo } from '../types';

const BASE = '/api/v1';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText} on ${path}`);
  }
  return res.json() as Promise<T>;
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const api = {
  /** GET /api/v1/tickers — list of supported symbols */
  getTickers: () => get<{ tickers: TickerInfo[] }>('/tickers'),

  /** GET /api/v1/heatmap/{ticker}?metric=&timestamp= */
  getHeatmap: (
    ticker: string,
    opts: { metric?: Metric; timestamp?: string; strikeCount?: number } = {},
  ): Promise<HeatmapSnapshot> => {
    const params = new URLSearchParams();
    if (opts.metric)    params.set('metric', opts.metric);
    if (opts.timestamp) params.set('timestamp', opts.timestamp);
    if (opts.strikeCount !== undefined) params.set('strikeCount', String(opts.strikeCount));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return get<HeatmapSnapshot>(`/heatmap/${ticker}${qs}`);
  },

  /** GET /api/v1/replay/timeline/{ticker}?date=YYYY-MM-DD */
  getTimeline: (ticker: string, date: string): Promise<ReplayTimeline> =>
    get<ReplayTimeline>(`/replay/timeline/${ticker}?date=${date}`),

  /** GET /api/v1/heatmap/{ticker}/history?date=YYYY-MM-DD&metric=&strikeCount= */
  getHeatmapHistory: (
    ticker: string,
    opts: { date: string; metric?: Metric; strikeCount?: number }
  ): Promise<{ ticker: string; date: string; history: Record<number, HeatmapSnapshot> }> => {
    const params = new URLSearchParams();
    params.set('date', opts.date);
    if (opts.metric) params.set('metric', opts.metric);
    if (opts.strikeCount !== undefined) params.set('strikeCount', String(opts.strikeCount));
    return get<{ ticker: string; date: string; history: Record<number, HeatmapSnapshot> }>(
      `/heatmap/${ticker}/history?${params.toString()}`
    );
  },
};

// ─── Mock data for development (no backend required) ─────────────────────────

const EXPIRATIONS = ['2026-07-01', '2026-07-05', '2026-07-12', '2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18'];

export function generateMockHeatmap(
  ticker = 'SPY',
  metric: Metric = 'net_gex',
  strikeCount = 20,
): HeatmapSnapshot {
  void metric; // metric label is informational; mock data is generic
  const centerStrike = 542;
  const startStrike = centerStrike + Math.floor(strikeCount / 2);
  const STRIKES = Array.from({ length: strikeCount }, (_, i) => startStrike - i);
  const data = STRIKES.map(() =>
    EXPIRATIONS.map(() => (Math.random() - 0.4) * 5e9),
  );
  return {
    ticker,
    timestamp: new Date().toISOString(),
    spot_price: 542.12,
    gamma_flip: 540.0,
    call_wall: 545.0,
    put_wall: 535.0,
    columns: EXPIRATIONS,
    rows: STRIKES,
    data,
  };
}

export function generateMockTimeline(
  ticker = 'SPY',
  metric: Metric = 'net_gex',
  strikeCount = 20,
): { timestamps: number[]; snapshots: Record<number, HeatmapSnapshot> } {
  void metric;
  const count = 50; // 50 snapshots representing a trading session
  const startTime = Math.floor(new Date('2026-07-02T09:30:00-05:00').getTime() / 1000);
  const interval = 5 * 60; // 5 minutes in seconds

  const centerStrike = 542;
  const startStrike = centerStrike + Math.floor(strikeCount / 2);
  const STRIKES = Array.from({ length: strikeCount }, (_, i) => startStrike - i);

  const timestamps: number[] = [];
  const snapshots: Record<number, HeatmapSnapshot> = {};

  // Seed the initial data at step 0
  const baseData = STRIKES.map((strike) => {
    return EXPIRATIONS.map((exp) => {
      // Call Wall seed (around 545 strike)
      if (strike === 545) return 2.5e9;
      // Put Wall seed (around 535 strike)
      if (strike === 535) return -2.0e9;
      // Migrating node seed (starts at 540)
      if (strike === 540) return 1.5e9;
      // General random seed
      const seedFactor = Math.sin(strike) * Math.cos(exp.charCodeAt(exp.length - 1) || 1) * 5e8;
      return seedFactor;
    });
  });

  let spotPrice = 542.12;

  for (let i = 0; i < count; i++) {
    const ts = startTime + i * interval;
    timestamps.push(ts);

    // Evolve spot price
    spotPrice += (Math.random() - 0.45) * 0.4; // slight upward drift

    // Evolve matrix data
    const data = STRIKES.map((strike, r) => {
      return EXPIRATIONS.map((_exp, c) => {
        let val = baseData[r][c];

        // Evolve Call Wall (make it grow)
        if (strike === 545) {
          val = 2.5e9 * (1 + 0.015 * i);
        }
        // Evolve Put Wall (make it decay then stabilize)
        else if (strike === 535) {
          val = -2.0e9 * (1 + Math.sin(i / 10) * 0.2);
        }
        // Evolve Migrating node: fades out from 540, fades in on 542
        else if (strike === 540) {
          val = 1.5e9 * Math.max(0, 1 - i / 30);
        }
        else if (strike === 542) {
          val = 2.0e9 * Math.min(1, i / 30);
        }
        else {
          // general random walk
          val += (Math.random() - 0.5) * 8e7;
        }

        // Save back to baseData for cumulative evolution
        baseData[r][c] = val;
        return val;
      });
    });

    // Determine walls dynamically
    let callWall = 545.0;
    let putWall = 535.0;
    let maxGex = -Infinity;
    let minGex = Infinity;

    STRIKES.forEach((strike, r) => {
      let sum = 0;
      data[r].forEach((v) => { sum += v; });
      if (sum > maxGex) {
        maxGex = sum;
        callWall = strike;
      }
      if (sum < minGex) {
        minGex = sum;
        putWall = strike;
      }
    });

    const gammaFlip = (callWall + putWall) / 2;

    snapshots[ts] = {
      ticker,
      timestamp: new Date(ts * 1000).toISOString(),
      spot_price: spotPrice,
      gamma_flip: gammaFlip,
      call_wall: callWall,
      put_wall: putWall,
      columns: EXPIRATIONS,
      rows: STRIKES,
      data,
    };
  }

  return { timestamps, snapshots };
}

