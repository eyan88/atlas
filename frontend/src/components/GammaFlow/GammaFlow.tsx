import { useEffect, useState } from 'react';
import { useAppStore, toSeconds } from '../../store/useAppStore';
import { gammaFlowApi, type GammaStrike, type NetFlowData, type GammaFlowResponse } from '../../api/gammaFlowClient';
import { GammaBarChart } from './GammaBarChart';
import { NetFlowChart } from './NetFlowChart';
import { GammaHeatmap } from './GammaHeatmap';
import styles from './GammaFlow.module.css';

const REFRESH_INTERVAL_MS = 5000;
const AVAILABLE_TICKERS = ["SPY", "QQQ", "IWM", "NVDA", "AAPL", "TSLA", "MSFT"];
const MAX_WIDGETS = 8;

type ViewMode = 'dashboard' | 'focus';
type ChartType = 'heatmap' | 'net_flow' | 'bar_chart';
type LinkGroup = 'A' | 'B' | 'C' | 'none';

interface Widget {
  id: string;
  ticker: string;
  type: ChartType;
  group: LinkGroup;
  strikeCount?: number;
  metric?: 'gex' | 'rel_pm';
}

const DEFAULT_WIDGETS: Widget[] = [
  { id: 'w1', ticker: 'QQQ', type: 'heatmap', group: 'A', strikeCount: 12, metric: 'gex' },
  { id: 'w2', ticker: 'QQQ', type: 'net_flow', group: 'A' },
  { id: 'w3', ticker: 'SPY', type: 'heatmap', group: 'B', strikeCount: 12, metric: 'gex' },
  { id: 'w4', ticker: 'SPY', type: 'net_flow', group: 'B' },
];

function formatUSD(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function GammaFlow() {
  const activeTicker = useAppStore((s) => s.activeTicker);
  const openTickers = useAppStore((s) => s.openTickers);
  const setTicker = useAppStore((s) => s.setTicker);
  const selectedDate = useAppStore((s) => s.selectedDate);
  const currentTimestamp = useAppStore((s) => s.currentTimestamp);
  const setTimelineData = useAppStore((s) => s.setTimelineData);
  const colorTheme = useAppStore((s) => s.colorTheme);

  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [currentTicker, setCurrentTicker] = useState(() => {
    return localStorage.getItem('atlas_gamma_flow_current_ticker') || activeTicker || 'SPY';
  });

  // Focus View specific GEX heatmap strike count and metric setting
  const [focusStrikeCount, setFocusStrikeCount] = useState<number>(() => {
    const saved = localStorage.getItem('atlas_gamma_flow_focus_strike_count');
    return saved ? Number(saved) : 12;
  });
  const [focusMetric, setFocusMetric] = useState<'gex' | 'rel_pm'>(() => {
    return (localStorage.getItem('atlas_gamma_flow_focus_metric') as 'gex' | 'rel_pm') || 'gex';
  });

  useEffect(() => {
    localStorage.setItem('atlas_gamma_flow_focus_metric', focusMetric);
  }, [focusMetric]);

  // Widget state for Dashboard Grid
  const [widgets, setWidgets] = useState<Widget[]>(() => {
    const saved = localStorage.getItem('atlas_gamma_flow_widgets');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse saved widgets, using defaults:', e);
      }
    }
    return DEFAULT_WIDGETS;
  });

  // States for Focus view
  const [spot, setSpot] = useState<number>(0);
  const [netFlow, setNetFlow] = useState<NetFlowData | null>(null);
  const [netFlowHistory, setNetFlowHistory] = useState<NetFlowData[]>([]);
  const [gammaHistory, setGammaHistory] = useState<GammaStrike[]>([]);
  const [isMockDataActive, setIsMockDataActive] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Drag and Drop States
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  // States for Grid Dashboard view data cache
  const [dashboardData, setDashboardData] = useState<Record<string, {
    spot: number;
    strikes: GammaStrike[];
    netFlow: NetFlowData | null;
    netFlowHistory: NetFlowData[];
    gammaHistory: GammaStrike[];
  }>>({});

  // Sync state values to localStorage for persistence
  useEffect(() => {
    localStorage.setItem('atlas_gamma_flow_view_mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('atlas_gamma_flow_current_ticker', currentTicker);
  }, [currentTicker]);

  useEffect(() => {
    localStorage.setItem('atlas_gamma_flow_focus_strike_count', String(focusStrikeCount));
  }, [focusStrikeCount]);

  useEffect(() => {
    localStorage.setItem('atlas_gamma_flow_widgets', JSON.stringify(widgets));
  }, [widgets]);

  // Sync with main app store active ticker if it changes
  useEffect(() => {
    if (openTickers.includes(activeTicker)) {
      setCurrentTicker(activeTicker);
    }
  }, [activeTicker, openTickers]);

  // Maximum history points kept in memory for constant O(1) memory footprint
  const MAX_HISTORY_POINTS = 500;
  const todayStr = new Date().toISOString().split('T')[0];
  const isToday = selectedDate === todayStr;

  // Fetch Focus View Data
  useEffect(() => {
    if (viewMode !== 'focus') return;

    let active = true;
    let timerId: any = null;

    // Always show loading spinner on date change or ticker switch
    setLoading(true);

    // 1. Fetch full historical baseline ONCE per ticker / date change
    const fetchHistory = async () => {
      try {
        const [netFlowData, gammaData] = await Promise.all([
          gammaFlowApi.getHistoricalNetFlow(currentTicker, { date: selectedDate }),
          gammaFlowApi.getHistoricalGamma(currentTicker, { date: selectedDate }),
        ]);
        if (!active) return;
        const normalizedNetFlow = netFlowData.history.map((h) => ({ ...h, timestamp: toSeconds(h.timestamp) }));
        const normalizedGamma = gammaData.history.map((h) => ({ ...h, timestamp: toSeconds(h.timestamp) }));
        setNetFlowHistory(normalizedNetFlow);
        setGammaHistory(normalizedGamma);

        // Feed timestamps into global playback controls
        const timestamps = Array.from(new Set(normalizedGamma.map((h) => h.timestamp))).sort((a, b) => a - b);
        const storeState = useAppStore.getState();
        const existingSnaps = storeState.snapshotsHistory[currentTicker] || {};
        setTimelineData(currentTicker, timestamps, existingSnaps);

        if (timestamps.length > 0) {
          const latestTs = timestamps[timestamps.length - 1];
          const isTodaySelected = selectedDate === todayStr;

          if (storeState.currentTimestamp === null && !isTodaySelected) {
            storeState.setTimestamp(latestTs);
          } else if (storeState.currentTimestamp !== null && !timestamps.includes(storeState.currentTimestamp)) {
            storeState.setTimestamp(latestTs);
          }
        }
      } catch (err) {
        console.error('Failed to load history:', err);
      } finally {
        if (active) setLoading(false);
      }
    };

    // 2. Fetch live single-snapshot tick and append to history buffer
    const fetchLiveTick = async () => {
      try {
        const data = await gammaFlowApi.getCurrentGamma(currentTicker);
        if (!active) return;
        setSpot(data.price);
        setNetFlow(data.net_flow);
        setIsMockDataActive(!!data.isMock);
        setError(null);

        // Append live tick to history if viewing today's live session
        if (isToday && data.net_flow) {
          const tickTs = toSeconds(data.net_flow.timestamp);
          const newTick = { ...data.net_flow, timestamp: tickTs };

          setNetFlowHistory((prev) => {
            if (prev.length === 0) return [newTick];
            const lastIdx = prev.length - 1;
            if (prev[lastIdx].timestamp === tickTs) {
              const next = [...prev];
              next[lastIdx] = newTick;
              return next;
            }
            const next = [...prev, newTick];
            return next.length > MAX_HISTORY_POINTS ? next.slice(next.length - MAX_HISTORY_POINTS) : next;
          });
        }
      } catch (err: any) {
        if (!active) return;
        setError(err.message || 'Failed to load live Gamma Flow data');
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchHistory();
    fetchLiveTick();

    // Only start polling if viewing today's active session
    if (isToday) {
      const startTimer = () => {
        if (!timerId) {
          timerId = setInterval(fetchLiveTick, REFRESH_INTERVAL_MS);
        }
      };
      const stopTimer = () => {
        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }
      };

      if (!document.hidden) startTimer();

      const handleVisibilityChange = () => {
        if (document.hidden) {
          stopTimer();
        } else {
          fetchLiveTick();
          startTimer();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        active = false;
        stopTimer();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    return () => {
      active = false;
    };
  }, [currentTicker, viewMode, selectedDate, isToday, setTimelineData]);

  // Extract unique sorted list of tickers to cache requests
  const uniqueTickersKey = Array.from(new Set(widgets.map((w) => w.ticker))).sort().join(',');

  // Fetch Dashboard Grid Data (Batch requests for active tickers)
  useEffect(() => {
    if (viewMode !== 'dashboard') return;

    let active = true;
    let timerId: any = null;

    // 1. Initial 1-time historical load for all unique dashboard tickers
    const fetchDashboardHistory = async () => {
      try {
        const uniqueTickers = Array.from(new Set(widgets.map((w) => w.ticker)));
        const results: typeof dashboardData = { ...dashboardData };
        let mockActive = false;
        let mainTimestamps: number[] = [];

        await Promise.all(
          uniqueTickers.map(async (ticker) => {
            try {
              const [currentData, netFlowHist, gammaHist] = await Promise.all([
                gammaFlowApi.getCurrentGamma(ticker),
                gammaFlowApi.getHistoricalNetFlow(ticker, { date: selectedDate }),
                gammaFlowApi.getHistoricalGamma(ticker, { date: selectedDate }),
              ]);

              const normalizedNetFlow = netFlowHist.history.map((h) => ({ ...h, timestamp: toSeconds(h.timestamp) }));
              const normalizedGamma = gammaHist.history.map((h) => ({ ...h, timestamp: toSeconds(h.timestamp) }));
              results[ticker] = {
                spot: currentData.price,
                strikes: currentData.strikes,
                netFlow: currentData.net_flow,
                netFlowHistory: normalizedNetFlow,
                gammaHistory: normalizedGamma,
              };
              if (currentData.isMock) mockActive = true;

              if (ticker === uniqueTickers[0]) {
                mainTimestamps = Array.from(new Set(normalizedGamma.map((h) => h.timestamp))).sort((a, b) => a - b);
              }
            } catch (err) {
              console.error(`Failed to fetch dashboard data for ${ticker}:`, err);
            }
          })
        );

        if (!active) return;
        setDashboardData(results);
        setIsMockDataActive(mockActive);
        setError(null);

        if (mainTimestamps.length > 0) {
          const storeState = useAppStore.getState();
          const existingSnaps = storeState.snapshotsHistory[uniqueTickers[0]] || {};
          setTimelineData(uniqueTickers[0], mainTimestamps, existingSnaps);
          const latestTs = mainTimestamps[mainTimestamps.length - 1];
          const isTodaySelected = selectedDate === todayStr;

          if (storeState.currentTimestamp === null && !isTodaySelected) {
            storeState.setTimestamp(latestTs);
          } else if (storeState.currentTimestamp !== null && !mainTimestamps.includes(storeState.currentTimestamp)) {
            storeState.setTimestamp(latestTs);
          }
        }
      } catch (err: any) {
        if (!active) return;
        setError('Failed to load dashboard data');
      } finally {
        if (active) setLoading(false);
      }
    };

    // 2. Poll lightweight getCurrentGamma for live dashboard ticks
    const fetchLiveDashboardTick = async () => {
      try {
        const uniqueTickers = Array.from(new Set(widgets.map((w) => w.ticker)));
        const updates: Record<string, GammaFlowResponse> = {};

        await Promise.all(
          uniqueTickers.map(async (ticker) => {
            try {
              const currentData = await gammaFlowApi.getCurrentGamma(ticker);
              updates[ticker] = currentData;
            } catch (err) {
              console.error(`Failed live tick for ${ticker}:`, err);
            }
          })
        );

        if (!active || Object.keys(updates).length === 0) return;

        setDashboardData((prev) => {
          const next = { ...prev };
          for (const [ticker, currentData] of Object.entries(updates)) {
            const existing = next[ticker] || {
              spot: currentData.price,
              strikes: currentData.strikes,
              netFlow: currentData.net_flow,
              netFlowHistory: [],
              gammaHistory: [],
            };

            let updatedNetFlowHistory = existing.netFlowHistory;
            if (isToday && currentData.net_flow) {
              const tickTs = toSeconds(currentData.net_flow.timestamp);
              const newTick = { ...currentData.net_flow, timestamp: tickTs };
              if (updatedNetFlowHistory.length === 0) {
                updatedNetFlowHistory = [newTick];
              } else {
                const lastIdx = updatedNetFlowHistory.length - 1;
                if (updatedNetFlowHistory[lastIdx].timestamp === tickTs) {
                  updatedNetFlowHistory = [...updatedNetFlowHistory];
                  updatedNetFlowHistory[lastIdx] = newTick;
                } else {
                  updatedNetFlowHistory = [...updatedNetFlowHistory, newTick];
                  if (updatedNetFlowHistory.length > MAX_HISTORY_POINTS) {
                    updatedNetFlowHistory = updatedNetFlowHistory.slice(updatedNetFlowHistory.length - MAX_HISTORY_POINTS);
                  }
                }
              }
            }

            next[ticker] = {
              ...existing,
              spot: currentData.price,
              strikes: currentData.strikes,
              netFlow: currentData.net_flow,
              netFlowHistory: updatedNetFlowHistory,
            };
          }
          return next;
        });
      } catch (err) {
        console.error('Failed to poll dashboard ticks:', err);
      }
    };

    setLoading(true);
    fetchDashboardHistory();

    if (isToday) {
      const startTimer = () => {
        if (!timerId) {
          timerId = setInterval(fetchLiveDashboardTick, REFRESH_INTERVAL_MS);
        }
      };
      const stopTimer = () => {
        if (timerId) {
          clearInterval(timerId);
          timerId = null;
        }
      };

      if (!document.hidden) startTimer();

      const handleVisibilityChange = () => {
        if (document.hidden) {
          stopTimer();
        } else {
          fetchLiveDashboardTick();
          startTimer();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);
      return () => {
        active = false;
        stopTimer();
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }

    return () => {
      active = false;
    };
  }, [viewMode, uniqueTickersKey, selectedDate, isToday, setTimelineData]);

  const handleTickerChange = (ticker: string) => {
    setCurrentTicker(ticker);
    setTicker(ticker);
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
    setDraggedIdx(index);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIdx !== index) {
      setDragOverIdx(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIdx(null);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex = Number(e.dataTransfer.getData('text/plain'));
    setDraggedIdx(null);
    setDragOverIdx(null);
    
    if (isNaN(sourceIndex) || sourceIndex === targetIndex) return;

    const updated = [...widgets];
    const [draggedWidget] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, draggedWidget);
    setWidgets(updated);
  };

  // Update Widget Ticker (with Link Group propagation support)
  const handleWidgetTickerChange = (id: string, nextTicker: string) => {
    setWidgets((current) => {
      const target = current.find((w) => w.id === id);
      const targetGroup = target?.group ?? 'none';

      return current.map((w) => {
        if (w.id === id) {
          return { ...w, ticker: nextTicker };
        }
        if (targetGroup !== 'none' && w.group === targetGroup) {
          return { ...w, ticker: nextTicker };
        }
        return w;
      });
    });
  };

  // Update Chart Type
  const handleWidgetTypeChange = (id: string, nextType: ChartType) => {
    setWidgets((current) =>
      current.map((w) => (w.id === id ? { ...w, type: nextType } : w))
    );
  };

  // Update Strike Count for a specific widget card
  const handleWidgetStrikeCountChange = (id: string, count: number) => {
    setWidgets((current) =>
      current.map((w) => (w.id === id ? { ...w, strikeCount: count === 0 ? undefined : count } : w))
    );
  };

  // Update Metric for a specific widget card (Absolute GEX vs Relative Per Minute)
  const handleWidgetMetricChange = (id: string, metric: 'gex' | 'rel_pm') => {
    setWidgets((current) =>
      current.map((w) => (w.id === id ? { ...w, metric } : w))
    );
  };

  // Update Link Group Color channel for a specific widget
  const handleWidgetGroupChange = (id: string, nextGroup: LinkGroup) => {
    setWidgets((current) =>
      current.map((w) => (w.id === id ? { ...w, group: nextGroup } : w))
    );
  };

  // Add Widget Selector Change (max 8 widgets total)
  const handleAddWidgetSelect = (ticker: string) => {
    if (widgets.length >= MAX_WIDGETS || !ticker) return;
    const newId = `w_${Date.now()}`;
    const nextWidget: Widget = {
      id: newId,
      ticker: ticker,
      type: 'heatmap',
      group: 'none', // Default new widgets to independent (No Group Link)
      strikeCount: 12, // Default to 12 strikes for medium zoom
    };
    setWidgets((current) => [...current, nextWidget]);
  };

  // Delete Widget
  const handleDeleteWidget = (id: string) => {
    setWidgets((current) => current.filter((w) => w.id !== id));
  };

  const handleCardClick = (ticker: string) => {
    setCurrentTicker(ticker);
    setTicker(ticker);
    setViewMode('focus');
  };

  // No local filtering needed anymore since canvas graphs render up to currentTimestamp natively

  const isNetPremiumPositive = netFlow ? netFlow.net_premium >= 0 : false;

  const cycleGroup = (current: LinkGroup): LinkGroup => {
    if (current === 'none') return 'A';
    if (current === 'A') return 'B';
    if (current === 'B') return 'C';
    return 'none';
  };

  const getCardGroupBorderClass = (group: LinkGroup) => {
    if (group === 'A') return styles.cardGroupA;
    if (group === 'B') return styles.cardGroupB;
    if (group === 'C') return styles.cardGroupC;
    return '';
  };

  const getGroupDotColor = (group: LinkGroup) => {
    if (group === 'A') return '#38bdf8';
    if (group === 'B') return '#c084fc';
    if (group === 'C') return '#4ade80';
    return 'rgba(255, 255, 255, 0.3)';
  };

  // Helper to resolve CSS classes for group select color badges
  const getGroupSelectClass = (group: LinkGroup) => {
    if (group === 'A') return `${styles.cardGroupSelector} ${styles.groupA}`;
    if (group === 'B') return `${styles.cardGroupSelector} ${styles.groupB}`;
    if (group === 'C') return `${styles.cardGroupSelector} ${styles.groupC}`;
    return `${styles.cardGroupSelector} ${styles.groupNone}`;
  };

  return (
    <div className={styles.container}>
      {/* Top Banner indicating Mock Data */}
      {isMockDataActive && (
        <div className={styles.mockBanner}>
          <span>💡 Live Feeder Offline — Showing Simulated Options Flow & Gamma Profile (Interactable preview)</span>
        </div>
      )}

      {/* Main Container Wrapper */}
      <div className={styles.tabContentWrapper}>
        
        {/* Workspace occupies full width */}
        <main className={styles.workspace}>
          
          {/* Top Bar for View Toggles and Ticker Add controls */}
          <div className={styles.topBar}>
            
            {/* View Toggle Pill Group / Back Button */}
            {viewMode === 'focus' ? (
              <button
                className={styles.backBtn}
                onClick={() => setViewMode('dashboard')}
              >
                ← Back to Grid
              </button>
            ) : (
              <div className={styles.viewToggleGroup}>
                <button
                  className={`${styles.viewToggleBtn} ${styles.viewToggleBtnActive}`}
                  onClick={() => setViewMode('dashboard')}
                >
                  Grid Board
                </button>
                <button
                  className={styles.viewToggleBtn}
                  onClick={() => setViewMode('focus')}
                >
                  Detail Focus
                </button>
              </div>
            )}

            {/* Dashboard Specific Top Controls */}
            {viewMode === 'dashboard' && (
              <div className={styles.topControlGroup}>
                <span className={styles.topControlLabel}>Add Ticker Widget:</span>
                <select
                  className={styles.cardSelector}
                  value=""
                  onChange={(e) => handleAddWidgetSelect(e.target.value)}
                  disabled={widgets.length >= MAX_WIDGETS}
                >
                  <option value="" disabled>Select Ticker ({widgets.length}/{MAX_WIDGETS})</option>
                  {AVAILABLE_TICKERS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Focus View Ticker Pill Group */}
            {viewMode === 'focus' && (
              <>
                <div className={styles.topControlGroup}>
                  <span className={styles.topControlLabel}>Focus Ticker:</span>
                  <div className={styles.tickerList}>
                    {openTickers.map((t) => (
                      <button
                        key={t}
                        className={`${styles.tickerBtn} ${t === currentTicker ? styles.tickerBtnActive : ''}`}
                        onClick={() => handleTickerChange(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Focus View strikes range control */}
                <div className={styles.topControlGroup}>
                  <span className={styles.topControlLabel}>Strikes:</span>
                  <select
                    className={styles.cardSelector}
                    value={focusStrikeCount ?? 0}
                    onChange={(e) => setFocusStrikeCount(Number(e.target.value) === 0 ? 0 : Number(e.target.value))}
                  >
                    <option value={6}>6 strikes</option>
                    <option value={12}>12 strikes</option>
                    <option value={20}>20 strikes</option>
                    <option value={0}>All strikes</option>
                  </select>
                </div>

                {/* Focus View Metric selector control */}
                <div className={styles.topControlGroup}>
                  <span className={styles.topControlLabel}>Metric:</span>
                  <select
                    className={styles.cardSelector}
                    value={focusMetric}
                    onChange={(e) => setFocusMetric(e.target.value as 'gex' | 'rel_pm')}
                  >
                    <option value="gex">Abs GEX ($)</option>
                    <option value="rel_pm">Rel / Min ($/m)</option>
                  </select>
                </div>
              </>
            )}

            {/* Focus View Compact Live Stats Panel */}
            {viewMode === 'focus' && netFlow && (
              <div className={styles.topStatsPanel}>
                <div className={styles.statMetric}>
                  <span className={styles.statLabel}>Net Call Prem</span>
                  <span className={styles.statVal} style={{ color: '#00e676' }}>▲ {formatUSD(netFlow.net_call_prem)}</span>
                </div>
                <div className={styles.statMetric}>
                  <span className={styles.statLabel}>Net Put Prem</span>
                  <span className={styles.statVal} style={{ color: colorTheme === 'classic' ? '#ff3d00' : '#c084fc' }}>▼ {formatUSD(netFlow.net_put_prem)}</span>
                </div>
                <div className={styles.statMetric}>
                  <span className={styles.statLabel}>Net Premium</span>
                  <span className={styles.statVal} style={{ color: isNetPremiumPositive ? '#00e676' : (colorTheme === 'classic' ? '#ff3d00' : '#c084fc') }}>
                    {isNetPremiumPositive ? '▲ +' : '▼ '}{formatUSD(netFlow.net_premium)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Core Content Area */}
          {loading ? (
            <div className={styles.loaderContainer}>
              <div className={styles.spinner} />
              <p>Fetching GEX Strikes & Net Flow...</p>
            </div>
          ) : error ? (
            <div className={styles.errorContainer}>
              <p className={styles.errorMsg}>⚠️ {error}</p>
            </div>
          ) : viewMode === 'focus' ? (
            /* Focus View Content */
            <div className={styles.chartsGrid}>
              {/* Top: GEX Heatmap Chart */}
              <section className={styles.chartWrapper}>
                <div className={styles.chartHeader}>
                  <h2 className={styles.chartTitle}>Dealer Gamma Exposure Profile ({focusMetric === 'rel_pm' ? 'Relative Per Minute' : 'Intraday Heatmap'}) — {currentTicker}</h2>
                  <span className={styles.spotBadge}>Spot price: ${spot.toFixed(2)}</span>
                </div>
                <div className={styles.chartBody}>
                  <GammaHeatmap history={gammaHistory} currentTimestamp={currentTimestamp} strikeCount={focusStrikeCount === 0 ? undefined : focusStrikeCount} metric={focusMetric} />
                </div>
              </section>

              {/* Bottom: Net Premium Time Series */}
              <section className={styles.chartWrapper}>
                <div className={styles.chartHeader}>
                  <h2 className={styles.chartTitle}>Cumulative Option Premium Flow (Intraday)</h2>
                  <div className={styles.legend}>
                    <span className={styles.legendItem}>
                      <span className={styles.dot} style={{ background: '#00e676' }} /> Call Premium
                    </span>
                    <span className={styles.legendItem}>
                      <span className={styles.dot} style={{ background: colorTheme === 'classic' ? '#ff3d00' : '#c084fc' }} /> Put Premium
                    </span>
                    <span className={styles.legendItem}>
                      <span className={styles.dot} style={{ background: '#f59e0b', borderRadius: '0', width: '8px', height: '2px' }} /> Spot Price
                    </span>
                  </div>
                </div>
                <div className={styles.chartBody}>
                  <NetFlowChart history={netFlowHistory} currentTimestamp={currentTimestamp} />
                </div>
              </section>
            </div>
          ) : (
            /* Grid Dashboard View Content */
            <div className={styles.dashboardGrid}>
              {widgets.map((widget, index) => {
                const data = dashboardData[widget.ticker];
                const netPrem = data?.netFlow?.net_premium ?? 0;
                const isPositive = netPrem >= 0;

                 // No local grid filtering needed since canvas components handle currentTimestamp directly

                return (
                  <div
                    key={widget.id}
                    className={`${styles.dashboardCard} ${getCardGroupBorderClass(widget.group)} ${draggedIdx === index ? styles.draggedCard : ''} ${dragOverIdx === index ? styles.dragOverCard : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, index)}
                  >
                    {/* Card Header with Interactive Dropdown Controls */}
                    <div className={styles.cardHeader}>
                      <div className={styles.cardLeftControls}>
                        {/* Drag Handle */}
                        <span
                          className={styles.cardGrip}
                          onClick={(e) => e.stopPropagation()}
                        >
                          ☰
                        </span>
                        
                        {/* Ticker Dropdown Selector */}
                        <select
                          className={styles.cardSelector}
                          value={widget.ticker}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleWidgetTickerChange(widget.id, e.target.value);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {AVAILABLE_TICKERS.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>

                        {/* Chart Type Dropdown Selector */}
                        <select
                          className={styles.cardSelector}
                          value={widget.type}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleWidgetTypeChange(widget.id, e.target.value as ChartType);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="heatmap">Heatmap</option>
                          <option value="net_flow">Net Flow</option>
                          <option value="bar_chart">Bar Chart</option>
                        </select>

                        {/* strikes and metric setting dropdowns (only visible on heatmap types) */}
                        {widget.type === 'heatmap' && (
                          <>
                            <select
                              className={styles.cardSelector}
                              value={widget.strikeCount ?? 12}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleWidgetStrikeCountChange(widget.id, Number(e.target.value));
                              }}
                              onClick={(e) => e.stopPropagation()}
                              title="Adjust visible strike counts on the GEX Heatmap"
                            >
                              <option value={6}>6 Strk</option>
                              <option value={12}>12 Strk</option>
                              <option value={20}>20 Strk</option>
                              <option value={0}>All Strk</option>
                            </select>
                            <select
                              className={styles.cardSelector}
                              value={widget.metric ?? 'gex'}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleWidgetMetricChange(widget.id, e.target.value as 'gex' | 'rel_pm');
                              }}
                              onClick={(e) => e.stopPropagation()}
                              title="Select Heatmap Metric (Abs GEX vs Relative Per Minute)"
                            >
                              <option value="gex">Abs GEX</option>
                              <option value="rel_pm">Rel / Min</option>
                            </select>
                          </>
                        )}
                        {/* Link Group Channel Color Cycle Toggle Button */}
                        <button
                          type="button"
                          className={getGroupSelectClass(widget.group)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleWidgetGroupChange(widget.id, cycleGroup(widget.group));
                          }}
                          title={`Link Channel: ${widget.group === 'none' ? 'Unlinked' : 'Group ' + widget.group} (Click to cycle)`}
                        >
                          <span className={styles.groupDot} style={{ background: getGroupDotColor(widget.group) }} />
                          <span>{widget.group === 'none' ? 'Unlinked' : `Group ${widget.group}`}</span>
                        </button>
                      </div>

                      <div className={styles.cardRightControls}>
                        {/* Spot Price Badge always at top right */}
                        <span className={styles.cardSpot}>
                          {data ? `$${data.spot.toFixed(2)}` : 'Loading...'}
                        </span>
                        
                        {/* Open Focus View Expand Button */}
                        <button
                          type="button"
                          className={styles.cardFocusBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCardClick(widget.ticker);
                          }}
                          title="Open detailed focus view for this ticker"
                          disabled={!data}
                        >
                          ⤢
                        </button>

                        {/* Delete Widget X Button */}
                        {widgets.length > 1 && (
                          <button
                            type="button"
                            className={styles.cardDeleteBtn}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteWidget(widget.id);
                            }}
                            title="Remove Widget"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                    
                    {/* Conditional Chart Rendering based on Widget Type */}
                    <div className={styles.cardChartBody}>
                      {!data ? (
                        <div className={styles.cardLoading}>
                          <div className={styles.cardSpinner} />
                          <span>Fetching {widget.ticker} data...</span>
                        </div>
                      ) : widget.type === 'heatmap' ? (
                        <GammaHeatmap history={data.gammaHistory || []} currentTimestamp={currentTimestamp} strikeCount={widget.strikeCount} metric={widget.metric ?? 'gex'} />
                      ) : widget.type === 'net_flow' ? (
                        <NetFlowChart history={data.netFlowHistory || []} currentTimestamp={currentTimestamp} />
                      ) : (
                        <GammaBarChart strikes={data.strikes || []} spot={data.spot ?? 0} />
                      )}
                    </div>

                    <div className={styles.cardFooter}>
                      <div className={styles.footerLabel}>Net Premium</div>
                      <div
                        className={styles.footerVal}
                        style={{ color: !data ? undefined : (isPositive ? '#00e676' : (colorTheme === 'classic' ? '#ff3d00' : '#c084fc')) }}
                      >
                        {data ? `${isPositive ? '▲ +' : '▼ '}${formatUSD(netPrem)}` : '--'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default GammaFlow;
