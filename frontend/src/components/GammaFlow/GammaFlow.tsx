import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { gammaFlowApi, type GammaStrike, type NetFlowData } from '../../api/gammaFlowClient';
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
}

const DEFAULT_WIDGETS: Widget[] = [
  { id: 'w1', ticker: 'QQQ', type: 'heatmap', group: 'A', strikeCount: 12 },
  { id: 'w2', ticker: 'QQQ', type: 'net_flow', group: 'A' },
  { id: 'w3', ticker: 'SPY', type: 'heatmap', group: 'B', strikeCount: 12 },
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

  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [currentTicker, setCurrentTicker] = useState(activeTicker);

  // Focus View specific GEX heatmap strike count setting
  const [focusStrikeCount, setFocusStrikeCount] = useState<number>(12);

  // Widget state for Dashboard Grid
  const [widgets, setWidgets] = useState<Widget[]>(DEFAULT_WIDGETS);

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

  // Sync with main app store active ticker if it changes
  useEffect(() => {
    if (openTickers.includes(activeTicker)) {
      setCurrentTicker(activeTicker);
    }
  }, [activeTicker, openTickers]);

  // Fetch Focus View Data
  useEffect(() => {
    if (viewMode !== 'focus') return;

    let active = true;
    let timerId: any = null;

    const fetchData = async () => {
      try {
        const data = await gammaFlowApi.getCurrentGamma(currentTicker);
        if (!active) return;
        setSpot(data.price);
        setNetFlow(data.net_flow);
        setIsMockDataActive(!!data.isMock);
        setError(null);
      } catch (err: any) {
        if (!active) return;
        setError(err.message || 'Failed to load live Gamma Flow data');
      } finally {
        if (active) setLoading(false);
      }
    };

    const fetchHistory = async () => {
      try {
        const [netFlowData, gammaData] = await Promise.all([
          gammaFlowApi.getHistoricalNetFlow(currentTicker, { date: selectedDate }),
          gammaFlowApi.getHistoricalGamma(currentTicker, { date: selectedDate }),
        ]);
        if (!active) return;
        setNetFlowHistory(netFlowData.history);
        setGammaHistory(gammaData.history);

        // Feed timestamps into global playback controls
        const timestamps = Array.from(new Set(gammaData.history.map((h) => h.timestamp))).sort((a, b) => a - b);
        setTimelineData(currentTicker, timestamps, {});
      } catch (err) {
        console.error('Failed to load history:', err);
      }
    };

    setLoading(true);
    fetchData();
    fetchHistory();

    timerId = setInterval(fetchData, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timerId);
    };
  }, [currentTicker, viewMode, selectedDate, setTimelineData]);

  // Extract unique sorted list of tickers to cache requests
  const uniqueTickersKey = Array.from(new Set(widgets.map((w) => w.ticker))).sort().join(',');

  // Fetch Dashboard Grid Data (Batch requests for active tickers)
  useEffect(() => {
    if (viewMode !== 'dashboard') return;

    let active = true;
    let timerId: any = null;

    const fetchAllDashboardData = async () => {
      try {
        const uniqueTickers = Array.from(new Set(widgets.map((w) => w.ticker)));
        const results: typeof dashboardData = { ...dashboardData };
        let mockActive = false;
        let mainTimestamps: number[] = [];

        await Promise.all(uniqueTickers.map(async (ticker) => {
          try {
            const [currentData, netFlowHist, gammaHist] = await Promise.all([
              gammaFlowApi.getCurrentGamma(ticker),
              gammaFlowApi.getHistoricalNetFlow(ticker, { date: selectedDate }),
              gammaFlowApi.getHistoricalGamma(ticker, { date: selectedDate }),
            ]);

            results[ticker] = {
              spot: currentData.price,
              strikes: currentData.strikes,
              netFlow: currentData.net_flow,
              netFlowHistory: netFlowHist.history,
              gammaHistory: gammaHist.history,
            };
            if (currentData.isMock) mockActive = true;

            // Pick one ticker timestamps to drive timeline controls
            if (ticker === uniqueTickers[0]) {
              mainTimestamps = Array.from(new Set(gammaHist.history.map((h) => h.timestamp))).sort((a, b) => a - b);
            }
          } catch (err) {
            console.error(`Failed to fetch dashboard data for ${ticker}:`, err);
          }
        }));

        if (!active) return;
        setDashboardData(results);
        setIsMockDataActive(mockActive);
        setError(null);

        // Align global playback slider with widgets timeline
        if (mainTimestamps.length > 0) {
          setTimelineData(uniqueTickers[0], mainTimestamps, {});
        }
      } catch (err: any) {
        if (!active) return;
        setError('Failed to load dashboard data');
      } finally {
        if (active) setLoading(false);
      }
    };

    // Only trigger full-screen loading spinner if we don't have any cached data yet
    if (Object.keys(dashboardData).length === 0) {
      setLoading(true);
    }
    
    fetchAllDashboardData();

    timerId = setInterval(fetchAllDashboardData, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timerId);
    };
  }, [viewMode, uniqueTickersKey, selectedDate, setTimelineData]);

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

  // Apply timeline playback scrubbing filter to datasets with fallback to prevent blank loads
  let filteredGammaHistory = gammaHistory;
  if (currentTimestamp && gammaHistory.length > 0) {
    const filtered = gammaHistory.filter((h) => h.timestamp <= currentTimestamp);
    filteredGammaHistory = filtered.length > 0 ? filtered : gammaHistory.slice(0, 1);
  }

  let filteredNetFlowHistory = netFlowHistory;
  if (currentTimestamp && netFlowHistory.length > 0) {
    const filtered = netFlowHistory.filter((h) => h.timestamp <= currentTimestamp);
    filteredNetFlowHistory = filtered.length > 0 ? filtered : netFlowHistory.slice(0, Math.min(2, netFlowHistory.length));
  }

  const isNetPremiumPositive = netFlow ? netFlow.net_premium >= 0 : false;

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
              </>
            )}

            {/* Focus View Compact Live Stats Panel */}
            {viewMode === 'focus' && netFlow && (
              <div className={styles.topStatsPanel}>
                <div className={styles.statMetric}>
                  <span className={styles.statLabel}>Net Call Prem</span>
                  <span className={`${styles.statVal} ${styles.positive}`}>▲ {formatUSD(netFlow.net_call_prem)}</span>
                </div>
                <div className={styles.statMetric}>
                  <span className={styles.statLabel}>Net Put Prem</span>
                  <span className={`${styles.statVal} ${styles.negative}`}>▼ {formatUSD(netFlow.net_put_prem)}</span>
                </div>
                <div className={styles.statMetric}>
                  <span className={styles.statLabel}>Net Premium</span>
                  <span className={`${styles.statVal} ${isNetPremiumPositive ? styles.positive : styles.negative}`}>
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
                  <h2 className={styles.chartTitle}>Dealer Gamma Exposure Profile (Intraday Heatmap) — {currentTicker}</h2>
                  <span className={styles.spotBadge}>Spot price: ${spot.toFixed(2)}</span>
                </div>
                <div className={styles.chartBody}>
                  <GammaHeatmap history={filteredGammaHistory} strikeCount={focusStrikeCount === 0 ? undefined : focusStrikeCount} />
                </div>
              </section>

              {/* Bottom: Net Premium Time Series */}
              <section className={styles.chartWrapper}>
                <div className={styles.chartHeader}>
                  <h2 className={styles.chartTitle}>Cumulative Option Premium Flow (Intraday)</h2>
                  <div className={styles.legend}>
                    <span className={styles.legendItem}><span className={`${styles.dot} ${styles.bgPositive}`} /> Call Premium</span>
                    <span className={styles.legendItem}><span className={`${styles.dot} ${styles.bgNegative}`} /> Put Premium</span>
                    <span className={styles.legendItem}><span className={`${styles.dot}`} style={{ background: '#f59e0b', borderRadius: '0', width: '8px', height: '2px' }} /> Spot Price</span>
                  </div>
                </div>
                <div className={styles.chartBody}>
                  <NetFlowChart history={filteredNetFlowHistory} />
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

                 // Scrub historical grid data if loaded with dynamic fallback bounds
                 let widgetGammaHistory = data ? data.gammaHistory : [];
                 if (data && currentTimestamp) {
                   const filtered = data.gammaHistory.filter((h) => h.timestamp <= currentTimestamp);
                   widgetGammaHistory = filtered.length > 0 ? filtered : data.gammaHistory.slice(0, 1);
                 }

                 let widgetNetFlowHistory = data ? data.netFlowHistory : [];
                 if (data && currentTimestamp) {
                   const filtered = data.netFlowHistory.filter((h) => h.timestamp <= currentTimestamp);
                   widgetNetFlowHistory = filtered.length > 0 ? filtered : data.netFlowHistory.slice(0, Math.min(2, data.netFlowHistory.length));
                 }

                return (
                  <div
                    key={widget.id}
                    className={`${styles.dashboardCard} ${draggedIdx === index ? styles.draggedCard : ''} ${dragOverIdx === index ? styles.dragOverCard : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, index)}
                    onClick={() => data && handleCardClick(widget.ticker)}
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

                        {/* strikes setting dropdown (only visible on heatmap types) */}
                        {widget.type === 'heatmap' && (
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
                        )}
                      </div>

                      <div className={styles.cardRightControls}>
                        <span className={styles.cardSpot}>
                          {data ? `$${data.spot.toFixed(2)}` : 'Loading...'}
                        </span>
                        
                        {/* Link Group Channel Color Selector (🔵, 🟣, 🟢 or ⚪) */}
                        <select
                          className={getGroupSelectClass(widget.group)}
                          value={widget.group}
                          onChange={(e) => {
                            e.stopPropagation();
                            handleWidgetGroupChange(widget.id, e.target.value as LinkGroup);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          title="Assign Link Channel Color to sync tickers"
                        >
                          <option value="none">⚪ Unlinked</option>
                          <option value="A">🔵 Blue</option>
                          <option value="B">🟣 Purple</option>
                          <option value="C">🟢 Green</option>
                        </select>

                        {/* Close/Delete Card Button */}
                        <button
                          type="button"
                          className={styles.cardDeleteBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteWidget(widget.id);
                          }}
                        >
                          ×
                        </button>
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
                        <GammaHeatmap history={widgetGammaHistory} strikeCount={widget.strikeCount} />
                      ) : widget.type === 'net_flow' ? (
                        <NetFlowChart history={widgetNetFlowHistory} />
                      ) : (
                        <GammaBarChart strikes={data.strikes} spot={data.spot} />
                      )}
                    </div>

                    <div className={styles.cardFooter}>
                      <div className={styles.footerLabel}>Net Premium</div>
                      <div className={`${styles.footerVal} ${!data ? '' : isPositive ? styles.positive : styles.negative}`}>
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
