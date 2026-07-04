// ─── Supported Metrics ───────────────────────────────────────────────────────

export type Metric =
  | 'net_gex'
  | 'net_dex'
  | 'vanna'
  | 'charm'
  | 'call_oi'
  | 'put_oi'
  | 'volume';

export const METRIC_LABELS: Record<Metric, string> = {
  net_gex: 'Net GEX',
  net_dex: 'Net DEX',
  vanna: 'Vanna',
  charm: 'Charm',
  call_oi: 'Call OI',
  put_oi: 'Put OI',
  volume: 'Volume',
};

// ─── Ticker ───────────────────────────────────────────────────────────────────

export interface TickerInfo {
  symbol: string;
  name: string;
  min_date: string | null;
  max_date: string | null;
}

// ─── Heatmap Snapshot ─────────────────────────────────────────────────────────

/** Full heatmap REST payload — mirroring GET /api/v1/heatmap/{ticker} */
export interface HeatmapSnapshot {
  ticker: string;
  timestamp: string;         // ISO 8601
  spot_price: number | null;
  gamma_flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  /** Expiration dates, ISO strings, one per column */
  columns: string[];
  /** Strike prices, one per row (descending) */
  rows: number[];
  /** data[rowIdx][colIdx] — raw metric value for each cell */
  data: number[][];
}

// ─── Cell Detail (for Sidebar) ────────────────────────────────────────────────

export interface CellDetail {
  ticker: string;
  strike: number;
  expiration: string;
  value: number;
  metric: Metric;
  pctChange: number;
  /** Column index in the matrix */
  colIdx: number;
  /** Row index in the matrix */
  rowIdx: number;
}

// ─── WebSocket Messages ───────────────────────────────────────────────────────

export interface WsInitMessage {
  type: 'INIT';
  payload: HeatmapSnapshot;
}

export interface CellDiff {
  k: number;   // strike
  e: string;   // expiration date ISO
  g: number;   // net_gex
  oi: number;  // total OI
  v: number;   // volume
}

export interface WsPatchPayload {
  ticker: string;
  timestamp: string;
  spot_price: number;
  gamma_flip: number | null;
  call_wall: number | null;
  put_wall: number | null;
  diffs: CellDiff[];
}

export interface WsPatchMessage {
  type: 'PATCH';
  payload: WsPatchPayload;
}

export type WsMessage = WsInitMessage | WsPatchMessage;

// ─── Replay Timeline ──────────────────────────────────────────────────────────

export interface ReplayTimeline {
  ticker: string;
  date: string;
  timestamps: number[];  // Unix seconds
}

// ─── Evolution Settings ───────────────────────────────────────────────────────

export type EvolutionWindow =
  | 'prev_snapshot'
  | '5m'
  | '15m'
  | '1h'
  | 'open'
  | 'prev_day';

export const EVOLUTION_WINDOW_LABELS: Record<EvolutionWindow, string> = {
  prev_snapshot: 'Prev Snapshot',
  '5m': 'Last 5 Minutes',
  '15m': 'Last 15 Minutes',
  '1h': 'Last Hour',
  open: 'Since Open',
  prev_day: 'Prev Day',
};

