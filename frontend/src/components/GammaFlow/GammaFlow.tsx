import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { gammaFlowApi, type GammaStrike, type NetFlowData } from '../../api/gammaFlowClient';
import { GammaBarChart } from './GammaBarChart';
import { NetFlowChart } from './NetFlowChart';
import { GammaHeatmap } from './GammaHeatmap';
import styles from './GammaFlow.module.css';

const REFRESH_INTERVAL_MS = 5000;
const AVAILABLE_TICKERS = ["SPY", "QQQ", "IWM", "NVDA", "AAPL", "TSLA", "MSFT"];

type ViewMode = 'dashboard' | 'focus';
type ChartType = 'heatmap' | 'net_flow' | 'bar_chart';

interface Widget {
  id: string;
  ticker: string;
  type: ChartType;
}

const DEFAULT_WIDGETS: Widget[] = [
  { id: 'w1', ticker: 'QQQ', type: 'heatmap' },
  { id: 'w2', ticker: 'QQQ', type: 'net_flow' },
  { id: 'w3', ticker: 'SPY', type: 'heatmap' },
  { id: 'w4', ticker: 'SPY', type: 'net_flow' },
  { id: 'w5', ticker: 'NVDA', type: 'heatmap' },
  { id: 'w6', ticker: 'TSLA', type: 'bar_chart' },
];

function formatUSD(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function formatVolume(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
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

  // Fetch Dashboard Grid Data (Batch requests for active tickers)
  useEffect(() => {
    if (viewMode !== 'dashboard') return;

    let active = true;
    let timerId: any = null;

    const fetchAllDashboardData = async () => {
      try {
        const uniqueTickers = Array.from(new Set(widgets.map((w) => w.ticker)));
        const results: typeof dashboardData = {};
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

    setLoading(true);
    fetchAllDashboardData();

    timerId = setInterval(fetchAllDashboardData, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timerId);
    };
  }, [viewMode, widgets, selectedDate, setTimelineData]);

  const handleTickerChange = (ticker: string) => {
    setCurrentTicker(ticker);
    setTicker(ticker);
  };

  // Drag and Drop handlers
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex = Number(e.dataTransfer.getData('text/plain'));
    if (isNaN(sourceIndex) || sourceIndex === targetIndex) return;

    const updated = [...widgets];
    const [draggedWidget] = updated.splice(sourceIndex, 1);
    updated.splice(targetIndex, 0, draggedWidget);
    setWidgets(updated);
  };

  const handleWidgetTickerChange = (id: string, nextTicker: string) => {
    setWidgets((current) =>
      current.map((w) => (w.id === id ? { ...w, ticker: nextTicker } : w))
    );
  };

  const handleWidgetTypeChange = (id: string, nextType: ChartType) => {
    setWidgets((current) =>
      current.map((w) => (w.id === id ? { ...w, type: nextType } : w))
    );
  };

  // Apply timeline playback scrubbing filter to datasets
  const filteredGammaHistory = currentTimestamp
    ? gammaHistory.filter((h) => h.timestamp <= currentTimestamp)
    : gammaHistory;

  const filteredNetFlowHistory = currentTimestamp
    ? netFlowHistory.filter((h) => h.timestamp <= currentTimestamp)
    : netFlowHistory;

  const isNetPremiumPositive = netFlow ? netFlow.net_premium >= 0 : false;
  const isNetVolumePositive = netFlow ? netFlow.net_volume >= 0 : false;

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
        {/* Sidebar Controls */}
        <aside className={styles.sidebar}>
          <div className={styles.controlSection}>
            <h3 className={styles.sectionTitle}>Dashboard View</h3>
            <div className={styles.viewToggleGroup}>
              <button
                className={`${styles.viewToggleBtn} ${viewMode === 'dashboard' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setViewMode('dashboard')}
              >
                Grid Board
              </button>
              <button
                className={`${styles.viewToggleBtn} ${viewMode === 'focus' ? styles.viewToggleBtnActive : ''}`}
                onClick={() => setViewMode('focus')}
              >
                Detail Focus
              </button>
            </div>
          </div>

          {viewMode === 'focus' && (
            <>
              <div className={styles.controlSection}>
                <h3 className={styles.sectionTitle}>Active Ticker</h3>
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

              {/* Live Net Flow Summary */}
              <div className={styles.controlSection}>
                <h3 className={styles.sectionTitle}>Live Net Flow</h3>
                {netFlow ? (
                  <div className={styles.flowMetrics}>
                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>Net Call Premium</div>
                      <div className={`${styles.metricVal} ${styles.positive}`}>
                        ▲ {formatUSD(netFlow.net_call_prem)}
                      </div>
                    </div>

                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>Net Put Premium</div>
                      <div className={`${styles.metricVal} ${styles.negative}`}>
                        ▼ {formatUSD(netFlow.net_put_prem)}
                      </div>
                    </div>

                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>Net Premium Flow</div>
                      <div className={`${styles.metricVal} ${isNetPremiumPositive ? styles.positive : styles.negative}`}>
                        {isNetPremiumPositive ? '▲ +' : '▼ '}{formatUSD(netFlow.net_premium)}
                      </div>
                    </div>

                    <div className={styles.metricCard}>
                      <div className={styles.metricLabel}>Net Volume Flow</div>
                      <div className={`${styles.metricVal} ${isNetVolumePositive ? styles.positive : styles.negative}`}>
                        {isNetVolumePositive ? '▲ +' : '▼ '}{formatVolume(netFlow.net_volume)} contracts
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className={styles.placeholderText}>Awaiting live flow updates...</p>
                )}
              </div>
            </>
          )}

          {viewMode === 'dashboard' && (
            <div className={styles.controlSection}>
              <h3 className={styles.sectionTitle}>Tickers Tracked</h3>
              <p className={styles.sidebarHint}>
                Drag and drop widget cards to rearrange. Customize ticker or chart type directly using the dropdown selectors on each card header.
              </p>
            </div>
          )}
        </aside>

        {/* Main Charts Workspace */}
        <main className={styles.workspace}>
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
              {/* Top: Dealer GEX Heatmap Chart */}
              <section className={styles.chartWrapper}>
                <div className={styles.chartHeader}>
                  <h2 className={styles.chartTitle}>Dealer Gamma Exposure Profile (Intraday Heatmap) — {currentTicker}</h2>
                  <span className={styles.spotBadge}>Spot price: ${spot.toFixed(2)}</span>
                </div>
                <div className={styles.chartBody}>
                  <GammaHeatmap history={filteredGammaHistory} />
                </div>
              </section>

              {/* Bottom: Net Premium Time Series */}
              <section className={styles.chartWrapper}>
                <div className={styles.chartHeader}>
                  <h2 className={styles.chartTitle}>Cumulative Option Premium Flow (Intraday)</h2>
                  <div className={styles.legend}>
                    <span className={styles.legendItem}><span className={`${styles.dot} ${styles.bgPositive}`} /> Call Premium</span>
                    <span className={styles.legendItem}><span className={`${styles.dot} ${styles.bgNegative}`} /> Put Premium</span>
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
                if (!data) return null;
                const netPrem = data.netFlow?.net_premium ?? 0;
                const isPositive = netPrem >= 0;

                // Scrub historical grid data
                const widgetGammaHistory = currentTimestamp
                  ? data.gammaHistory.filter((h) => h.timestamp <= currentTimestamp)
                  : data.gammaHistory;

                const widgetNetFlowHistory = currentTimestamp
                  ? data.netFlowHistory.filter((h) => h.timestamp <= currentTimestamp)
                  : data.netFlowHistory;

                return (
                  <div
                    key={widget.id}
                    className={styles.dashboardCard}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => handleDrop(e, index)}
                  >
                    {/* Card Header with Interactive Dropdown Controls */}
                    <div className={styles.cardHeader}>
                      <div className={styles.cardLeftControls}>
                        <span className={styles.cardGrip}>☰</span>
                        
                        {/* Ticker Dropdown Selector */}
                        <select
                          className={styles.cardSelector}
                          value={widget.ticker}
                          onChange={(e) => handleWidgetTickerChange(widget.id, e.target.value)}
                        >
                          {AVAILABLE_TICKERS.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>

                        {/* Chart Type Dropdown Selector */}
                        <select
                          className={styles.cardSelector}
                          value={widget.type}
                          onChange={(e) => handleWidgetTypeChange(widget.id, e.target.value as ChartType)}
                        >
                          <option value="heatmap">Heatmap</option>
                          <option value="net_flow">Net Flow</option>
                          <option value="bar_chart">Bar Chart</option>
                        </select>
                      </div>

                      <span className={styles.cardSpot}>${data.spot.toFixed(2)}</span>
                    </div>
                    
                    {/* Conditional Chart Rendering based on Widget Type */}
                    <div className={styles.cardChartBody}>
                      {widget.type === 'heatmap' ? (
                        <GammaHeatmap history={widgetGammaHistory} />
                      ) : widget.type === 'net_flow' ? (
                        <NetFlowChart history={widgetNetFlowHistory} />
                      ) : (
                        <GammaBarChart strikes={data.strikes} spot={data.spot} />
                      )}
                    </div>

                    <div className={styles.cardFooter}>
                      <div className={styles.footerLabel}>Net Premium</div>
                      <div className={`${styles.footerVal} ${isPositive ? styles.positive : styles.negative}`}>
                        {isPositive ? '▲ +' : '▼ '}{formatUSD(netPrem)}
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
