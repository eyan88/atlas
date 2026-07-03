import { create } from 'zustand';
import type { CellDetail, HeatmapSnapshot, Metric } from '../types';

const MAX_OPEN_TICKERS = 5;

// ─── State Shape ──────────────────────────────────────────────────────────────

interface AppState {
  // Active symbol
  activeTicker: string;

  // Open ticker panes, ordered left to right
  openTickers: string[];

  // Selected metric displayed in the heatmap
  selectedMetric: Metric;

  // Number of strike rows shown in the mock heatmap
  strikeCount: number;

  // Current replay timestamp (null = live)
  currentTimestamp: number | null;

  // Replay controls
  isPlaying: boolean;
  replaySpeed: number; // 1 | 5 | 10 | 60

  // Market level overlays
  spotPrice: number | null;
  gammaFlip: number | null;
  callWall: number | null;
  putWall: number | null;

  // Heatmap matrix data (null while loading)
  heatmap: HeatmapSnapshot | null;

  // Heatmap matrix data per open ticker pane
  heatmapsByTicker: Record<string, HeatmapSnapshot | null>;

  // WebSocket connection state
  wsConnected: boolean;

  // Currently hovered / selected cell (drives Sidebar inspector)
  hoveredCell: CellDetail | null;

  // ─── Actions ────────────────────────────────────────────────────────────────

  setTicker: (ticker: string) => void;
  openTickerPane: (ticker: string) => void;
  closeTickerPane: (ticker: string) => void;
  setMetric: (metric: Metric) => void;
  setStrikeCount: (count: number) => void;
  setTimestamp: (ts: number | null) => void;
  togglePlay: () => void;
  setReplaySpeed: (speed: number) => void;
  updateMarketLevels: (
    spot: number,
    flip: number | null,
    call: number | null,
    put: number | null,
  ) => void;
  setHeatmap: (snapshot: HeatmapSnapshot) => void;
  setHeatmapForTicker: (ticker: string, snapshot: HeatmapSnapshot) => void;
  applyDiff: (diffs: HeatmapSnapshot) => void;
  setWsConnected: (connected: boolean) => void;
  setHoveredCell: (cell: CellDetail | null) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set) => ({
  activeTicker: 'SPY',
  openTickers: ['SPY'],
  selectedMetric: 'net_gex',
  strikeCount: 20,
  currentTimestamp: null,
  isPlaying: false,
  replaySpeed: 1,
  spotPrice: null,
  gammaFlip: null,
  callWall: null,
  putWall: null,
  heatmap: null,
  heatmapsByTicker: {},
  wsConnected: false,
  hoveredCell: null,

  setTicker: (ticker) =>
    set((state) => {
      const next = ticker.trim().toUpperCase();
      const openTickers = state.openTickers.includes(next)
        ? state.openTickers
        : [...state.openTickers, next];
      return { activeTicker: next, openTickers, heatmap: null, currentTimestamp: null };
    }),

  openTickerPane: (ticker) =>
    set((state) => {
      const next = ticker.trim().toUpperCase();
      const isAlreadyOpen = state.openTickers.includes(next);
      if (!isAlreadyOpen && state.openTickers.length >= MAX_OPEN_TICKERS) {
        return state;
      }
      const openTickers = isAlreadyOpen
        ? state.openTickers
        : [next, ...state.openTickers];
      return { activeTicker: next, openTickers, heatmap: null, currentTimestamp: null };
    }),

  closeTickerPane: (ticker) =>
    set((state) => {
      const next = ticker.trim().toUpperCase();
      const remaining = state.openTickers.filter((t) => t !== next);
      const openTickers = remaining.length > 0 ? remaining : ['SPY'];
      const nextActive = state.activeTicker === next ? openTickers[openTickers.length - 1] : state.activeTicker;
      const nextHeatmap = nextActive === next ? null : state.heatmapsByTicker[nextActive] ?? null;
      const nextSpotPrice = nextActive === next ? null : state.spotPrice;
      const nextGammaFlip = nextActive === next ? null : state.gammaFlip;
      const nextCallWall = nextActive === next ? null : state.callWall;
      const nextPutWall = nextActive === next ? null : state.putWall;
      const { [next]: _removed, ...heatmapsByTicker } = state.heatmapsByTicker;

      return {
        activeTicker: nextActive,
        openTickers,
        heatmap: nextHeatmap,
        heatmapsByTicker,
        spotPrice: nextSpotPrice,
        gammaFlip: nextGammaFlip,
        callWall: nextCallWall,
        putWall: nextPutWall,
        hoveredCell: state.hoveredCell?.ticker === next ? null : state.hoveredCell,
        currentTimestamp: nextActive === next ? null : state.currentTimestamp,
      };
    }),

  setMetric: (metric) => set({ selectedMetric: metric }),

  setStrikeCount: (count) => set({ strikeCount: count }),

  setTimestamp: (ts) => set({ currentTimestamp: ts }),

  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  setReplaySpeed: (speed) => set({ replaySpeed: speed }),

  updateMarketLevels: (spot, flip, call, put) =>
    set({ spotPrice: spot, gammaFlip: flip, callWall: call, putWall: put }),

  setHeatmap: (snapshot) =>
    set((state) => ({
      heatmap: snapshot,
      heatmapsByTicker: { ...state.heatmapsByTicker, [state.activeTicker]: snapshot },
      spotPrice: snapshot.spot_price,
      gammaFlip: snapshot.gamma_flip,
      callWall: snapshot.call_wall,
      putWall: snapshot.put_wall,
    })),

  setHeatmapForTicker: (ticker, snapshot) =>
    set((state) => ({
      heatmap: ticker === state.activeTicker ? snapshot : state.heatmap,
      heatmapsByTicker: { ...state.heatmapsByTicker, [ticker]: snapshot },
      spotPrice: ticker === state.activeTicker ? snapshot.spot_price : state.spotPrice,
      gammaFlip: ticker === state.activeTicker ? snapshot.gamma_flip : state.gammaFlip,
      callWall: ticker === state.activeTicker ? snapshot.call_wall : state.callWall,
      putWall: ticker === state.activeTicker ? snapshot.put_wall : state.putWall,
    })),

  // Full snapshot replace (used during replay seek)
  applyDiff: (snapshot) =>
    set((state) => ({
      heatmap: snapshot,
      heatmapsByTicker: { ...state.heatmapsByTicker, [state.activeTicker]: snapshot },
      spotPrice: snapshot.spot_price,
      gammaFlip: snapshot.gamma_flip,
      callWall: snapshot.call_wall,
      putWall: snapshot.put_wall,
    })),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  setHoveredCell: (cell) => set({ hoveredCell: cell }),
}));
