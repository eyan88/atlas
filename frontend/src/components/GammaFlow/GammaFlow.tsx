import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { gammaFlowApi, type GammaStrike, type NetFlowData } from '../../api/gammaFlowClient';
import { GammaBarChart } from './GammaBarChart';
import { NetFlowChart } from './NetFlowChart';
import styles from './GammaFlow.module.css';

const REFRESH_INTERVAL_MS = 5000;

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

  const [currentTicker, setCurrentTicker] = useState(activeTicker);
  const [spot, setSpot] = useState<number>(0);
  const [strikes, setStrikes] = useState<GammaStrike[]>([]);
  const [netFlow, setNetFlow] = useState<NetFlowData | null>(null);
  const [netFlowHistory, setNetFlowHistory] = useState<NetFlowData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Sync with main app store active ticker if it changes
  useEffect(() => {
    if (openTickers.includes(activeTicker)) {
      setCurrentTicker(activeTicker);
    }
  }, [activeTicker, openTickers]);

  useEffect(() => {
    let active = true;
    let timerId: any = null;

    const fetchData = async () => {
      try {
        const data = await gammaFlowApi.getCurrentGamma(currentTicker);
        if (!active) return;
        setSpot(data.price);
        setStrikes(data.strikes);
        setNetFlow(data.net_flow);
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
        const historyData = await gammaFlowApi.getHistoricalNetFlow(currentTicker);
        if (!active) return;
        setNetFlowHistory(historyData.history);
      } catch (err) {
        console.error('Failed to load net flow history:', err);
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
  }, [currentTicker]);

  const handleTickerChange = (ticker: string) => {
    setCurrentTicker(ticker);
    setTicker(ticker);
  };

  const isNetPremiumPositive = netFlow ? netFlow.net_premium >= 0 : false;
  const isNetVolumePositive = netFlow ? netFlow.net_volume >= 0 : false;

  return (
    <div className={styles.container}>
      {/* Sidebar Controls */}
      <aside className={styles.sidebar}>
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
            <p className={styles.errorHint}>
              Verify that the external Gamma Flow API service is running and accessible at:
              <br />
              <code>VITE_API_BASE_URL/api/v1/gamma-flow</code>
            </p>
          </div>
        ) : (
          <div className={styles.chartsGrid}>
            {/* Top: Dealer GEX Bar Chart */}
            <section className={styles.chartWrapper}>
              <div className={styles.chartHeader}>
                <h2 className={styles.chartTitle}>Dealer Gamma Exposure — {currentTicker}</h2>
                <span className={styles.spotBadge}>Spot price: ${spot.toFixed(2)}</span>
              </div>
              <div className={styles.chartBody}>
                <GammaBarChart strikes={strikes} spot={spot} />
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
        )}
      </main>
    </div>
  );
}
export default GammaFlow;
