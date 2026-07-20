import { create } from 'zustand';
import type { CellDetail, HeatmapSnapshot, Metric, EvolutionWindow, WsPatchPayload } from '../types';

const MAX_OPEN_TICKERS = 5;

export function toSeconds(ts: number): number {
  if (!ts) return 0;
  return ts > 1e11 ? Math.floor(ts / 1000) : ts;
}

// ─── State Shape ──────────────────────────────────────────────────────────────

export type AppTab = 'heatmap' | 'compass' | 'gamma-flow';

interface AppState {
  activeTab: AppTab;

  // Active symbol
  activeTicker: string;

  // Open ticker panes, ordered left to right
  openTickers: string[];

  // Selected metric displayed in the heatmap
  selectedMetric: Metric;

  // Number of strike rows shown in the mock heatmap
  strikeCount: number;

  // Evolution comparison window
  evolutionWindow: EvolutionWindow;

  // Cache of snapshots per ticker for dynamic evolution computation
  snapshotsHistory: Record<string, Record<number, HeatmapSnapshot>>;

  // Timestamps for the timeline slider
  timelineTimestamps: number[];

  // Selected date for replay timeline (e.g. '2026-07-02')
  selectedDate: string;

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

  // Loading state for timeline fetches
  isLoadingHistory: boolean;

  // WebSocket connection state
  wsConnected: boolean;

  // Currently hovered / selected cell (drives Sidebar inspector)
  hoveredCell: CellDetail | null;

  isSidebarOpen: boolean;

  // ─── Actions ────────────────────────────────────────────────────────────────

  setActiveTab: (tab: AppTab) => void;
  setTicker: (ticker: string) => void;
  openTickerPane: (ticker: string) => void;
  closeTickerPane: (ticker: string) => void;
  setMetric: (metric: Metric) => void;
  setStrikeCount: (count: number) => void;
  setEvolutionWindow: (window: EvolutionWindow) => void;
  setTimelineData: (ticker: string, timestamps: number[], snapshots: Record<number, HeatmapSnapshot>) => void;
  setTimestamp: (ts: number | null) => void;
  togglePlay: () => void;
  setReplaySpeed: (speed: number) => void;
  updateMarketLevels: (
    spot: number,
    flip: number | null,
    call: number | null,
    put: number | null,
  ) => void;
  setHeatmap: (snapshot: HeatmapSnapshot | null) => void;
  setHeatmapForTicker: (ticker: string, snapshot: HeatmapSnapshot | null) => void;
  applyDiff: (payload: WsPatchPayload) => void;
  setWsConnected: (connected: boolean) => void;
  setHoveredCell: (cell: CellDetail | null) => void;
  setSelectedDate: (date: string) => void;
  setIsLoadingHistory: (loading: boolean) => void;
  toggleSidebar: () => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'heatmap',
  activeTicker: '',
  openTickers: [],
  selectedMetric: 'net_gex',
  strikeCount: 40,
  evolutionWindow: 'prev_snapshot',
  snapshotsHistory: {},
  timelineTimestamps: [],
  selectedDate: new Date().toISOString().split('T')[0],
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
  isLoadingHistory: false,
  hoveredCell: null,
  isSidebarOpen: true,
  // ─── Actions ────────────────────────────────────────────────────────────────
  
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setActiveTab: (tab) => set({ activeTab: tab === 'gamma-flow' ? 'heatmap' : tab }),

  setTicker: (ticker) =>
    set((state) => {
      const next = ticker.trim().toUpperCase();
      const openTickers = state.openTickers.includes(next)
        ? state.openTickers
        : [...state.openTickers, next];
      const nextHeatmap = state.heatmapsByTicker[next] ?? null;
      return {
        activeTicker: next,
        openTickers,
        heatmap: nextHeatmap,
        spotPrice: nextHeatmap ? nextHeatmap.spot_price : null,
        gammaFlip: nextHeatmap ? nextHeatmap.gamma_flip : null,
        callWall: nextHeatmap ? nextHeatmap.call_wall : null,
        putWall: nextHeatmap ? nextHeatmap.put_wall : null,
        currentTimestamp: state.currentTimestamp,
      };
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
      const nextHeatmap = state.heatmapsByTicker[next] ?? null;
      return {
        activeTicker: next,
        openTickers,
        heatmap: nextHeatmap,
        spotPrice: nextHeatmap ? nextHeatmap.spot_price : null,
        gammaFlip: nextHeatmap ? nextHeatmap.gamma_flip : null,
        callWall: nextHeatmap ? nextHeatmap.call_wall : null,
        putWall: nextHeatmap ? nextHeatmap.put_wall : null,
        currentTimestamp: state.currentTimestamp,
      };
    }),

  closeTickerPane: (ticker) =>
    set((state) => {
      const next = ticker.trim().toUpperCase();
      const remaining = state.openTickers.filter((t) => t !== next);
      const openTickers = remaining;
      const nextActive = state.activeTicker === next ? (openTickers.length > 0 ? openTickers[openTickers.length - 1] : '') : state.activeTicker;
      const nextHeatmap = nextActive ? (state.heatmapsByTicker[nextActive] ?? null) : null;
      const nextSpotPrice = nextHeatmap ? nextHeatmap.spot_price : null;
      const nextGammaFlip = nextHeatmap ? nextHeatmap.gamma_flip : null;
      const nextCallWall = nextHeatmap ? nextHeatmap.call_wall : null;
      const nextPutWall = nextHeatmap ? nextHeatmap.put_wall : null;
      const { [next]: _removed, ...heatmapsByTicker } = state.heatmapsByTicker;
      const { [next]: _histRemoved, ...snapshotsHistory } = state.snapshotsHistory;

      return {
        activeTicker: nextActive,
        openTickers,
        heatmap: nextHeatmap,
        heatmapsByTicker,
        snapshotsHistory,
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

  setIsLoadingHistory: (loading) => set({ isLoadingHistory: loading }),

  setEvolutionWindow: (window) => set({ evolutionWindow: window }),

  setTimelineData: (ticker, timestamps, snapshots) =>
    set((state) => ({
      timelineTimestamps: timestamps,
      snapshotsHistory: {
        ...state.snapshotsHistory,
        [ticker]: snapshots,
      },
    })),

  setTimestamp: (ts) =>
    set((state) => {
      const nextHeatmaps = { ...state.heatmapsByTicker };
      state.openTickers.forEach((t) => {
        const tHistory = state.snapshotsHistory[t];
        if (ts && tHistory && tHistory[ts]) {
          nextHeatmaps[t] = tHistory[ts];
        }
      });

      const activeHist = state.snapshotsHistory[state.activeTicker];
      const nextHeatmap = ts && activeHist && activeHist[ts] ? activeHist[ts] : state.heatmap;

       return {
         currentTimestamp: ts,
         heatmap: nextHeatmap,
         heatmapsByTicker: nextHeatmaps,
         spotPrice: nextHeatmap ? nextHeatmap.spot_price : state.spotPrice,
         gammaFlip: nextHeatmap ? nextHeatmap.gamma_flip : state.gammaFlip,
         callWall: nextHeatmap ? nextHeatmap.call_wall : state.callWall,
         putWall: nextHeatmap ? nextHeatmap.put_wall : state.putWall,
         isPlaying: ts === null ? false : state.isPlaying,
       };
     }),


  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),

  setReplaySpeed: (speed) => set({ replaySpeed: speed }),

  setSelectedDate: (date) => set({ selectedDate: date }),

  updateMarketLevels: (spot, flip, call, put) =>
    set({ spotPrice: spot, gammaFlip: flip, callWall: call, putWall: put }),

  setHeatmap: (snapshot) =>
    set((state) => ({
      heatmap: snapshot,
      heatmapsByTicker: { ...state.heatmapsByTicker, [state.activeTicker]: snapshot },
      spotPrice: snapshot ? snapshot.spot_price : null,
      gammaFlip: snapshot ? snapshot.gamma_flip : null,
      callWall: snapshot ? snapshot.call_wall : null,
      putWall: snapshot ? snapshot.put_wall : null,
    })),

  setHeatmapForTicker: (ticker, snapshot) =>
    set((state) => ({
      heatmap: ticker === state.activeTicker ? snapshot : state.heatmap,
      heatmapsByTicker: { ...state.heatmapsByTicker, [ticker]: snapshot },
      spotPrice: ticker === state.activeTicker ? (snapshot ? snapshot.spot_price : null) : state.spotPrice,
      gammaFlip: ticker === state.activeTicker ? (snapshot ? snapshot.gamma_flip : null) : state.gammaFlip,
      callWall: ticker === state.activeTicker ? (snapshot ? snapshot.call_wall : null) : state.callWall,
      putWall: ticker === state.activeTicker ? (snapshot ? snapshot.put_wall : null) : state.putWall,
    })),

  applyDiff: (payload) =>
    set((state) => {
      let current = state.heatmapsByTicker[payload.ticker];
      if (!current && state.activeTicker === payload.ticker) {
        current = state.heatmap;
      }

      let rows: number[];
      let columns: string[];
      let nextData: number[][];

      if (!current) {
        // Bootstrap a new snapshot from scratch using the diff payload
        const rSet = new Set<number>();
        const cSet = new Set<string>();
        payload.diffs.forEach(d => { rSet.add(d.k); cSet.add(d.e); });
        rows = Array.from(rSet).sort((a, b) => b - a); // descending
        columns = Array.from(cSet).sort();
        nextData = Array(rows.length).fill(0).map(() => Array(columns.length).fill(0));
      } else {
        rows = current.rows;
        columns = current.columns;
        nextData = current.data.map((row) => [...row]);
      }

      const rowMap = new Map(rows.map((r, i) => [r, i]));
      const colMap = new Map(columns.map((c, i) => [c, i]));

      payload.diffs.forEach((diff) => {
        const rIdx = rowMap.get(diff.k);
        const cIdx = colMap.get(diff.e);
        if (rIdx !== undefined && cIdx !== undefined) {
          let val = diff.g; 
          if (state.selectedMetric === 'net_dex') val = diff.d ?? diff.oi; 
          else if (state.selectedMetric === 'vanna') val = diff.va ?? (diff.g * 0.001);
          else if (state.selectedMetric === 'charm') val = diff.ch ?? (-diff.oi * 0.0005);
          else if (state.selectedMetric === 'call_oi') val = diff.coi ?? diff.oi;
          else if (state.selectedMetric === 'put_oi') val = diff.poi ?? diff.oi;
          else if (state.selectedMetric === 'volume') val = diff.v;

          nextData[rIdx][cIdx] = val;
        }
      });

      const nextSnapshot = {
        ticker: payload.ticker,
        timestamp: payload.timestamp,
        spot_price: payload.spot_price ?? (current ? current.spot_price : null),
        gamma_flip: payload.gamma_flip ?? (current ? current.gamma_flip : null),
        net_gamma: payload.net_gamma ?? (current ? current.net_gamma : null),
        call_wall: payload.call_wall ?? (current ? current.call_wall : null),
        put_wall: payload.put_wall ?? (current ? current.put_wall : null),
        rows,
        columns,
        data: nextData,
      };

      return {
        heatmap: payload.ticker === state.activeTicker ? nextSnapshot : state.heatmap,
        heatmapsByTicker: { ...state.heatmapsByTicker, [payload.ticker]: nextSnapshot },
        spotPrice: payload.ticker === state.activeTicker ? nextSnapshot.spot_price : state.spotPrice,
        gammaFlip: payload.ticker === state.activeTicker ? nextSnapshot.gamma_flip : state.gammaFlip,
        callWall: payload.ticker === state.activeTicker ? nextSnapshot.call_wall : state.callWall,
        putWall: payload.ticker === state.activeTicker ? nextSnapshot.put_wall : state.putWall,
      };
    }),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  setHoveredCell: (cell) => set({ hoveredCell: cell }),
}));

