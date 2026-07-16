import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { gammaFlowApi, type GammaStrike, type NetFlowData } from '../../api/gammaFlowClient';
import { GammaBarChart } from './GammaBarChart';
import { NetFlowChart } from './NetFlowChart';
import { GammaHeatmap } from './GammaHeatmap';
import styles from './GammaFlow.module.css';

const REFRESH_INTERVAL_MS = 5000;
const DASHBOARD_TICKERS = ["SPY", "QQQ", "IWM", "NVDA", "AAPL", "TSLA", "MSFT"];

type ViewMode = 'dashboard' | 'focus';

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

  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [currentTicker, setCurrentTicker] = useState(activeTicker);

  // States for Focus view
  const [spot, setSpot] = useState<number>(0);
  const [netFlow, setNetFlow] = useState<NetFlowData | null>(null);
  const [netFlowHistory, setNetFlowHistory] = useState<NetFlowData[]>([]);
  const [gammaHistory, setGammaHistory] = useState<GammaStrike[]>([]);
  const [isMockDataActive, setIsMockDataActive] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // States for Grid Dashboard view
  const [dashboardData, setDashboardData] = useState<Record<string, {
    spot: number;
    strikes: GammaStrike[];
    netFlow: NetFlowData | null;
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
          gammaFlowApi.getHistoricalNetFlow(currentTicker),
          gammaFlowApi.getHistoricalGamma(currentTicker),
        ]);
        if (!active) return;
        setNetFlowHistory(netFlowData.history);
        setGammaHistory(gammaData.history);
      } catch (err) {
        console.error('Failed to load history:', err);
      }
    };

    setLoading(true);
    fetchData();
    fetchHistory();

    // Start polling loop
    timerId = setInterval(fetchData, REFRESH_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timerId);
    };
  }, [currentTicker, viewMode]);

  // Fetch Dashboard Grid Data
  useEffect(() => {
    if (viewMode !== 'dashboard') return;

    let active = true;
    let timerId: any = null;

    const fetchAllDashboardData = async () => {
      try {
        const results: typeof dashboardData = {};
        let mockActive = false;

        await Promise.all(DASHBOARD_TICKERS.map(async (ticker) => {
          try {
            const data = await gammaFlowApi.getCurrentGamma(ticker);
            results[ticker] = {
              spot: data.price,
              strikes: data.strikes,
              netFlow: data.net_flow,
            };
            if (data.isMock) mockActive = true;
          } catch (err) {
            console.error(`Failed to fetch dashboard data for ${ticker}:`, err);
          }
        }));

        if (!active) return;
        setDashboardData(results);
        setIsMockDataActive(mockActive);
        setError(null);
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
  }, [viewMode]);

  const handleTickerChange = (ticker: string) => {
    setCurrentTicker(ticker);
    setTicker(ticker);
  };

  const handleCardClick = (ticker: string) => {
    setCurrentTicker(ticker);
    setTicker(ticker);
    setViewMode('focus');
  };

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
                Displaying real-time feed updates for index ETFs and major tech equities. Click any card in the grid to drill down.
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
              {/* Top: Dealer GEX Bar Chart */}
              <section className={styles.chartWrapper}>
                <div className={styles.chartHeader}>
                  <h2 className={styles.chartTitle}>Dealer Gamma Exposure Profile (Intraday Heatmap) — {currentTicker}</h2>
                  <span className={styles.spotBadge}>Spot price: ${spot.toFixed(2)}</span>
                </div>
                <div className={styles.chartBody}>
                  <GammaHeatmap history={gammaHistory} />
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
                  <NetFlowChart history={netFlowHistory} />
                </div>
              </section>
            </div>
          ) : (
            /* Grid Dashboard View Content */
            <div className={styles.dashboardGrid}>
              {DASHBOARD_TICKERS.map((ticker) => {
                const data = dashboardData[ticker];
                if (!data) return null;
                const netPrem = data.netFlow?.net_premium ?? 0;
                const isPositive = netPrem >= 0;

                return (
                  <div
                    key={ticker}
                    className={styles.dashboardCard}
                    onClick={() => handleCardClick(ticker)}
                  >
                    <div className={styles.cardHeader}>
                      <span className={styles.cardTicker}>{ticker}</span>
                      <span className={styles.cardSpot}>${data.spot.toFixed(2)}</span>
                    </div>
                    
                    <div className={styles.cardChartBody}>
                      <GammaBarChart strikes={data.strikes} spot={data.spot} />
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
