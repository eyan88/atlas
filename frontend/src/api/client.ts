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
