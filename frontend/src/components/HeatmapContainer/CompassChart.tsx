import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { api } from '../../api/client';
import styles from './CompassChart.module.css';

const CHART_TICKERS = ['SPY', 'QQQ', 'IWM'];

// Standard TradingView exchange mappings for indexes/ETFs
const WIDGET_TICKER_MAP: Record<string, string> = {
  SPY: 'AMEX:SPY',
  QQQ: 'NASDAQ:QQQ',
  IWM: 'AMEX:IWM',
};

export function CompassChart() {
  // Zustand Store queries
  const snapshotsHistory = useAppStore((s) => s.snapshotsHistory);
  const currentTimestamp = useAppStore((s) => s.currentTimestamp);
  const colorTheme = useAppStore((s) => s.colorTheme);
  const selectedDate = useAppStore((s) => s.selectedDate);

  // Local chart ticker selection
  const [activeChartTicker, setActiveChartTicker] = useState('SPY');
  
  // State to track settled options levels from previous trading session EOD
  const [prevEodLevels, setPrevEodLevels] = useState<{
    date: string;
    call_wall: number | null;
    put_wall: number | null;
    gamma_flip: number | null;
  } | null>(null);

  // Utility to locate the previous active trading day
  const getPreviousTradingDay = (dateStr: string): string => {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    let offset = 1;
    if (day === 1) {
      offset = 3; // Monday -> Friday
    } else if (day === 0) {
      offset = 2; // Sunday -> Friday
    } else if (day === 6) {
      offset = 1; // Saturday -> Friday
    }
    const prev = new Date(d.getTime() - offset * 24 * 60 * 60 * 1000);
    return prev.toISOString().split('T')[0];
  };

  // Fetch previous session EOD settled levels dynamically when ticker/date changes
  useEffect(() => {
    let active = true;
    const fetchPrevEod = async () => {
      try {
        const prevDate = getPreviousTradingDay(selectedDate);
        const data = await api.getHeatmapHistory(activeChartTicker, {
          date: prevDate,
          strikeCount: 40,
        });
        if (!active) return;

        const keys = Object.keys(data.history).map(Number).sort((a, b) => a - b);
        if (keys.length > 0) {
          const latestSnap = data.history[keys[keys.length - 1]];
          setPrevEodLevels({
            date: prevDate,
            call_wall: latestSnap.call_wall,
            put_wall: latestSnap.put_wall,
            gamma_flip: latestSnap.gamma_flip,
          });
        } else {
          setPrevEodLevels(null);
        }
      } catch (err) {
        console.error("Failed to fetch previous EOD settled options levels:", err);
        if (active) setPrevEodLevels(null);
      }
    };

    fetchPrevEod();
    return () => {
      active = false;
    };
  }, [activeChartTicker, selectedDate]);

  // Handle active replay snapshot
  const tickerHistory = snapshotsHistory[activeChartTicker] ?? {};
  const historyTimestamps = Object.keys(tickerHistory).map(Number).sort((a, b) => a - b);
  
  const currentSnap = currentTimestamp ? tickerHistory[currentTimestamp] : null;
  const activeSnap = currentSnap || (historyTimestamps.length > 0 ? tickerHistory[historyTimestamps[historyTimestamps.length - 1]] : null);

  // Fallback to active date snap if previous EOD levels aren't loaded yet
  const spotPriceVal = activeSnap?.spot_price;
  const callWallVal = prevEodLevels?.call_wall ?? activeSnap?.call_wall;
  const putWallVal = prevEodLevels?.put_wall ?? activeSnap?.put_wall;
  const flipVal = prevEodLevels?.gamma_flip ?? activeSnap?.gamma_flip;

  // Initialize TradingView Advanced Real-Time Chart widget
  const containerId = `tv-advanced-chart-${activeChartTicker.toLowerCase()}`;
  
  useEffect(() => {
    // 1. Inject s3 script if not present
    let script = document.getElementById('tradingview-widget-script') as HTMLScriptElement | null;
    
    const initWidget = () => {
      if (typeof window !== 'undefined' && (window as any).TradingView) {
        new (window as any).TradingView.widget({
          autosize: true,
          symbol: WIDGET_TICKER_MAP[activeChartTicker] || activeChartTicker,
          interval: '5',
          timezone: 'America/New_York',
          theme: 'dark',
          style: '1',
          locale: 'en',
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: true,
          container_id: containerId,
          studies: [],
          show_popup_button: false,
          backgroundColor: '#0d1117',
          gridColor: 'rgba(255, 255, 255, 0.04)',
          loading_screen: {
            backgroundColor: '#0d1117',
          },
        });
      }
    };

    if (!script) {
      script = document.createElement('script');
      script.id = 'tradingview-widget-script';
      script.src = 'https://s3.tradingview.com/tv.js';
      script.async = true;
      script.onload = initWidget;
      document.head.appendChild(script);
    } else {
      // Small timeout to ensure DOM element is mounted
      const timer = setTimeout(initWidget, 80);
      return () => clearTimeout(timer);
    }
  }, [activeChartTicker, containerId]);

  return (
    <div className={styles.container}>
      {/* Widget Control Header */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <span className={styles.title}>Real-Time Chart</span>
          {prevEodLevels && (
            <span className={styles.subtitle}>
              GEX levels settled on {prevEodLevels.date}
            </span>
          )}
        </div>

        {/* Ticker selector tabs */}
        <div className={styles.tickerSelector}>
          {CHART_TICKERS.map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.tickerBtn} ${t === activeChartTicker ? styles.tickerBtnActive : ''}`}
              onClick={() => setActiveChartTicker(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Interactive TradingView frame viewport */}
      <div className={styles.chartArea}>
        <div className={styles.widgetContainer}>
          <div id={containerId} className={styles.widgetIframe} />
        </div>

        {/* Floating options levels indicator dashboard */}
        <div className={styles.overlay}>
          <div className={styles.statsGrid}>
            {spotPriceVal != null && (
              <div className={styles.statItem} style={{ borderLeft: '3px solid #f59e0b' }}>
                <span className={styles.statLabel}>Spot Price</span>
                <span className={styles.statVal}>${spotPriceVal.toFixed(2)}</span>
              </div>
            )}
            {callWallVal != null && (
              <div className={styles.statItem} style={{ borderLeft: '3px solid #34d399' }}>
                <span className={styles.statLabel}>Call Wall</span>
                <span className={styles.statVal}>${callWallVal.toFixed(0)}</span>
              </div>
            )}
            {putWallVal != null && (
              <div className={styles.statItem} style={{ borderLeft: `3px solid ${colorTheme === 'classic' ? '#f87171' : '#c084fc'}` }}>
                <span className={styles.statLabel}>Put Wall</span>
                <span className={styles.statVal}>${putWallVal.toFixed(0)}</span>
              </div>
            )}
            {flipVal != null && (
              <div className={styles.statItem} style={{ borderLeft: '3px solid #fbbf24' }}>
                <span className={styles.statLabel}>Gamma Flip</span>
                <span className={styles.statVal}>${flipVal.toFixed(0)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CompassChart;
