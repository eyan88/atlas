import { create } from 'zustand';
import type { CellDetail, HeatmapSnapshot, Metric, EvolutionWindow, WsPatchPayload } from '../types';

const MAX_OPEN_TICKERS = 5;

export function toSeconds(ts: number): number {
  if (!ts) return 0;
  return ts > 1e11 ? Math.floor(ts / 1000) : ts;
}

export function strToDateStr(d: string): string {
  if (!d) return '';
  return String(d).split('T')[0];
}

export function getEasternDateStr(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export function findClosestSnapshot(
  history: Record<number, HeatmapSnapshot> | undefined,
  targetTs: number | null
): HeatmapSnapshot | null {
  if (!history || targetTs === null) return null;
  if (history[targetTs]) return history[targetTs];

  const keys = Object.keys(history).map(Number).sort((a, b) => a - b);
  if (keys.length === 0) return null;

  let closest: number | null = null;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] <= targetTs + 30) {
      closest = keys[i];
    } else {
      break;
    }
  }
  if (closest === null && keys.length > 0) {
    closest = keys[0];
  }
  return closest !== null ? history[closest] ?? null : null;
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

  // Highlight significant gamma nodes & dim noise cells
  highlightSignificantNodes: boolean;

  // Color theme settings: 'atlas' (vibrant theme) or 'classic' (red/green)
  colorTheme: 'atlas' | 'classic';

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
  setSelectedDate: (date: string) => void;
  setIsLoadingHistory: (loading: boolean) => void;
  toggleSidebar: () => void;
  toggleHighlightSignificantNodes: () => void;
  setColorTheme: (theme: 'atlas' | 'classic') => void;
  setHoveredCell: (cell: CellDetail | null) => void;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>((set) => ({
  activeTab: 'heatmap',
  activeTicker: '',
  openTickers: [],
  selectedMetric: 'net_gex',
  highlightSignificantNodes: false,
  colorTheme: (localStorage.getItem('atlas_color_theme') as 'atlas' | 'classic') || 'atlas',
  strikeCount: 40,
  evolutionWindow: '1m',
  snapshotsHistory: {},
  timelineTimestamps: [],
  selectedDate: getEasternDateStr(),
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
  toggleHighlightSignificantNodes: () => set((state) => ({ highlightSignificantNodes: !state.highlightSignificantNodes })),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setColorTheme: (theme) => {
    localStorage.setItem('atlas_color_theme', theme);
    set({ colorTheme: theme });
  },

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
      snapshotsHistory:
        snapshots && Object.keys(snapshots).length > 0
          ? { ...state.snapshotsHistory, [ticker]: snapshots }
          : state.snapshotsHistory,
    })),

  setTimestamp: (ts) =>
    set((state) => {
      const nextHeatmaps = { ...state.heatmapsByTicker };
      state.openTickers.forEach((t) => {
        const tHistory = state.snapshotsHistory[t];
        const snap = findClosestSnapshot(tHistory, ts);
        if (snap) {
          nextHeatmaps[t] = snap;
        }
      });

      const activeHist = state.snapshotsHistory[state.activeTicker];
      const nextHeatmap = ts === null
        ? state.heatmap
        : (findClosestSnapshot(activeHist, ts) ?? state.heatmap);

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

      const spotPrice = payload.spot_price ?? (current ? current.spot_price : null);
      const strikeCount = state.strikeCount || 20;

      // Collect all rows and columns dynamically from both current heatmap and incoming payload diffs
      const rSet = new Set<number>(current ? current.rows.map(Number) : []);
      const cSet = new Set<string>(current ? current.columns.map(strToDateStr) : []);
      payload.diffs.forEach(d => {
        rSet.add(Number(d.k));
        cSet.add(strToDateStr(d.e));
      });

      let allStrikes = Array.from(rSet);
      
      // Trim strikes to strikeCount centered around spotPrice to prevent far OTM strikes from bloating grid
      if (allStrikes.length > strikeCount && spotPrice !== null) {
        const sortedByDist = [...allStrikes].sort((a, b) => Math.abs(a - spotPrice) - Math.abs(b - spotPrice));
        allStrikes = sortedByDist.slice(0, strikeCount);
      }

      const rows = allStrikes.sort((a, b) => b - a); // descending
      const columns = Array.from(cSet).sort();

      const rowMap = new Map(rows.map((r, i) => [Number(r), i]));
      const colMap = new Map(columns.map((c, i) => [strToDateStr(c), i]));

      let nextData: number[][] = Array(rows.length).fill(0).map(() => Array(columns.length).fill(0));

      // Carry forward existing heatmap cell data into expanded matrix
      if (current) {
        current.rows.forEach((r, oldR) => {
          const newR = rowMap.get(Number(r));
          if (newR === undefined) return;
          current.columns.forEach((c, oldC) => {
            const newC = colMap.get(strToDateStr(c));
            if (newC !== undefined && current.data[oldR] && current.data[oldR][oldC] !== undefined) {
              nextData[newR][newC] = current.data[oldR][oldC];
            }
          });
        });
      }

      let hasValidDiffs = false;
      payload.diffs.forEach((diff) => {
        const rIdx = rowMap.get(Number(diff.k));
        const cIdx = colMap.get(strToDateStr(diff.e));
        if (rIdx !== undefined && cIdx !== undefined) {
          let val = diff.g; 
          if (state.selectedMetric === 'net_dex') val = diff.d ?? diff.oi; 
          else if (state.selectedMetric === 'vanna') val = diff.va ?? (diff.g * 0.001);
          else if (state.selectedMetric === 'charm') val = diff.ch ?? (-diff.oi * 0.0005);
          else if (state.selectedMetric === 'call_oi') val = diff.coi ?? diff.oi;
          else if (state.selectedMetric === 'put_oi') val = diff.poi ?? diff.oi;
          else if (state.selectedMetric === 'volume') val = diff.v;

          if (val !== 0) hasValidDiffs = true;
          nextData[rIdx][cIdx] = val;
        }
      });

      // If the incoming diff payload was completely zeroed out (e.g. off-hours polling), keep current heatmap intact
      if (!hasValidDiffs && current && current.data && current.data.some(row => row.some(v => v !== 0))) {
        nextData = current.data;
      }

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

      const ms = payload.timestamp ? new Date(payload.timestamp).getTime() : NaN;
      const secKey = !isNaN(ms) ? toSeconds(ms) : 0;

      const tickerHist = state.snapshotsHistory[payload.ticker] ?? {};
      const updatedTickerHist = secKey > 0
        ? { ...tickerHist, [secKey]: nextSnapshot }
        : tickerHist;

      let updatedTimeline = state.timelineTimestamps;
      if (secKey > 0 && payload.ticker === state.activeTicker && !updatedTimeline.includes(secKey)) {
        updatedTimeline = [...updatedTimeline, secKey].sort((a, b) => a - b);
      }

      return {
        heatmap: payload.ticker === state.activeTicker ? nextSnapshot : state.heatmap,
        heatmapsByTicker: { ...state.heatmapsByTicker, [payload.ticker]: nextSnapshot },
        snapshotsHistory: { ...state.snapshotsHistory, [payload.ticker]: updatedTickerHist },
        timelineTimestamps: updatedTimeline,
        spotPrice: payload.ticker === state.activeTicker ? nextSnapshot.spot_price : state.spotPrice,
        gammaFlip: payload.ticker === state.activeTicker ? nextSnapshot.gamma_flip : state.gammaFlip,
        callWall: payload.ticker === state.activeTicker ? nextSnapshot.call_wall : state.callWall,
        putWall: payload.ticker === state.activeTicker ? nextSnapshot.put_wall : state.putWall,
      };
    }),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  setHoveredCell: (cell: CellDetail | null) => set({ hoveredCell: cell }),
}));

