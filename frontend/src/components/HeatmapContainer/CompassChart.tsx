import { useEffect, useRef, useState } from 'react';
import { createChart, LineStyle, IChartApi, CandlestickSeries, createSeriesMarkers, LineSeries } from 'lightweight-charts';
import { useAppStore } from '../../store/useAppStore';
import type { HeatmapSnapshot } from '../../types';
import styles from './CompassChart.module.css';

const CHART_TICKERS = ['SPY', 'QQQ', 'IWM'];

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  spot_price?: number;
  call_wall?: number | null;
  put_wall?: number | null;
  gamma_flip?: number | null;
}

export function CompassChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const seriesMarkersRef = useRef<any>(null);

  // Refs for continuous line series
  const callSeriesRef = useRef<any>(null);
  const putSeriesRef = useRef<any>(null);
  const flipSeriesRef = useRef<any>(null);

  // References for dynamic price lines to update on replay slider
  const spotLineRef = useRef<any>(null);

  // Zustand Store queries
  const snapshotsHistory = useAppStore((s) => s.snapshotsHistory);
  const currentTimestamp = useAppStore((s) => s.currentTimestamp);
  const colorTheme = useAppStore((s) => s.colorTheme);

  // Local chart ticker selection (defaults to SPY)
  const [activeChartTicker, setActiveChartTicker] = useState('SPY');
  const [hoveredCandle, setHoveredCandle] = useState<CandleData | null>(null);

  // Get snapshots history for active chart ticker
  const tickerHistory = snapshotsHistory[activeChartTicker] ?? {};
  const historyTimestamps = Object.keys(tickerHistory)
    .map(Number)
    .sort((a, b) => a - b);

  // Re-generate candlestick series data
  const candles: CandleData[] = [];
  if (historyTimestamps.length > 1) {
    // We have a full intraday snapshots history
    for (let i = 0; i < historyTimestamps.length; i++) {
      const ts = historyTimestamps[i];
      const snap = tickerHistory[ts];
      if (!snap || snap.spot_price == null) continue;

      const price = snap.spot_price;
      const prevPrice =
        i > 0
          ? tickerHistory[historyTimestamps[i - 1]]?.spot_price ?? price
          : price;

      const open = prevPrice;
      const close = price;
      const range = Math.abs(close - open);
      const noise = range > 0 ? range * 0.15 : price * 0.0003;
      const high = Math.max(open, close) + noise;
      const low = Math.min(open, close) - noise;

      candles.push({
        time: ts as any,
        open,
        high,
        low,
        close,
        spot_price: price,
        call_wall: snap.call_wall,
        put_wall: snap.put_wall,
        gamma_flip: snap.gamma_flip,
      });
    }
  } else if (historyTimestamps.length === 1) {
    // Only one snapshot (usually historical End-of-Day). Generate a simulated 78-candle trading day (9:30 AM to 4:00 PM Eastern, 5m bars)
    const T = historyTimestamps[0];
    const snap = tickerHistory[T];
    if (snap && snap.spot_price != null) {
      const EOD_price = snap.spot_price;
      const baseDate = new Date(T * 1000);
      const year = baseDate.getUTCFullYear();
      const month = baseDate.getUTCMonth();
      const day = baseDate.getUTCDate();

      // Session start standard UTC hour based on timezone shifts: 13:30 UTC / 14:30 UTC
      const startHour = baseDate.getUTCHours() < 14 ? 13 : 14;
      const startMin = 30;
      const minTimeDate = new Date(Date.UTC(year, month, day, startHour, startMin, 0));
      const minTime = Math.floor(minTimeDate.getTime() / 1000);

      // Generate 78 simulated 5-minute ticks
      const simulatedTimestamps: number[] = [];
      for (let j = 0; j < 78; j++) {
        simulatedTimestamps.push(minTime + j * 5 * 60);
      }

      // Simulated random walk ending exactly at EOD_price
      const priceRange = EOD_price * 0.012; // 1.2% maximum variance
      // Pseudo-random deterministic seed offset based on ticker to keep it stable
      const seedOffset = activeChartTicker === 'QQQ' ? 0.3 : activeChartTicker === 'IWM' ? -0.2 : 0.05;
      const startPrice = EOD_price - (0.5 + seedOffset) * priceRange;

      let lastPrice = startPrice;
      for (let j = 0; j < 78; j++) {
        const ts = simulatedTimestamps[j];
        const progress = j / 77;
        // Glide towards final EOD close price
        const target = startPrice + (EOD_price - startPrice) * progress;
        // Pseudo-random noise
        const walk = (Math.sin(j * 0.45) * 0.3 + Math.cos(j * 0.95) * 0.2) * (EOD_price * 0.0006);
        const close = j === 77 ? EOD_price : target + walk;

        const open = lastPrice;
        const range = Math.abs(close - open);
        const noise = range > 0 ? range * 0.12 : close * 0.00025;
        const high = Math.max(open, close) + noise;
        const low = Math.min(open, close) - noise;

        simulatedCandlesPushHelper(candles, ts, open, high, low, close, snap);
        lastPrice = close;
      }
    }
  }

  // Local helper function to satisfy TypeScript compiler
  function simulatedCandlesPushHelper(
    arr: CandleData[],
    time: number,
    open: number,
    high: number,
    low: number,
    close: number,
    snap: HeatmapSnapshot
  ) {
    arr.push({
      time: time as any,
      open,
      high,
      low,
      close,
      spot_price: close,
      call_wall: snap.call_wall,
      put_wall: snap.put_wall,
      gamma_flip: snap.gamma_flip,
    });
  }

  // Find currently active candle data matching the timeline slider playhead
  const activeCandle =
    candles.find((c) => c.time === currentTimestamp) ||
    candles[candles.length - 1] ||
    null;

  // Initialize Lightweight Chart instance
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create container element
    const container = chartContainerRef.current;

    const chart = createChart(container, {
      layout: {
        background: { color: '#080b10' },
        textColor: '#8b949e',
        fontSize: 10,
        fontFamily: "'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.04)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        textColor: '#8b949e',
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: {
          color: 'rgba(56, 189, 248, 0.4)',
          width: 1,
          style: 3, // Dotted
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: 3, // Dotted
        },
      },
      width: container.clientWidth,
      height: container.clientHeight || 400,
    });

    // Custom colors matching selected colorTheme (Atlas vs Classic)
    const isClassic = colorTheme === 'classic';
    const upColor = isClassic ? '#22c55e' : '#00e676';
    const downColor = isClassic ? '#ef4444' : '#c084fc';

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor,
      downColor,
      borderUpColor: upColor,
      borderDownColor: downColor,
      wickUpColor: upColor,
      wickDownColor: downColor,
    });

    // Create continuous LineSeries for GEX levels
    const callSeries = chart.addSeries(LineSeries, {
      color: '#00e676',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: 'Call Wall',
      priceLineVisible: false,
    });
    const putSeries = chart.addSeries(LineSeries, {
      color: isClassic ? '#ff3d00' : '#c084fc',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      title: 'Put Wall',
      priceLineVisible: false,
    });
    const flipSeries = chart.addSeries(LineSeries, {
      color: '#fbbf24',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      title: 'Flip Level',
      priceLineVisible: false,
    });

    // Initialize series markers plugin api
    seriesMarkersRef.current = createSeriesMarkers(candlestickSeries, []);

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    callSeriesRef.current = callSeries;
    putSeriesRef.current = putSeries;
    flipSeriesRef.current = flipSeries;

    // Subscribe to crosshair hover moves to update legends display
    chart.subscribeCrosshairMove((param) => {
      if (param.time) {
        const data = param.seriesData.get(candlestickSeries) as CandleData | undefined;
        if (data) {
          // Re-attach timestamp time
          setHoveredCandle({
            ...data,
            time: param.time as number,
          });
        }
      } else {
        setHoveredCandle(null);
      }
    });

    // Auto resize chart container
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          chart.resize(width, height);
        }
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.removeSeries(candlestickSeries);
      chart.removeSeries(callSeries);
      chart.removeSeries(putSeries);
      chart.removeSeries(flipSeries);
      chart.remove();
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      callSeriesRef.current = null;
      putSeriesRef.current = null;
      flipSeriesRef.current = null;
      seriesMarkersRef.current = null;
    };
  }, [activeChartTicker, colorTheme]); // Recreate chart if ticker or theme switches

  // Reactively load/update Candlestick Data, Price Lines, and GEX Bubbles (Markers)
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series || candles.length === 0) return;

    // Load series data
    series.setData(candles);

    // Load continuous GEX line series data
    const callData = candles
      .filter((c) => c.call_wall != null)
      .map((c) => ({ time: c.time as any, value: c.call_wall as number }));
    const putData = candles
      .filter((c) => c.put_wall != null)
      .map((c) => ({ time: c.time as any, value: c.put_wall as number }));
    const flipData = candles
      .filter((c) => c.gamma_flip != null)
      .map((c) => ({ time: c.time as any, value: c.gamma_flip as number }));

    if (callSeriesRef.current) callSeriesRef.current.setData(callData);
    if (putSeriesRef.current) putSeriesRef.current.setData(putData);
    if (flipSeriesRef.current) flipSeriesRef.current.setData(flipData);

    // Dynamic price lines management (only Spot Price line dynamically tracks scrubber)
    if (spotLineRef.current) {
      series.removePriceLine(spotLineRef.current);
      spotLineRef.current = null;
    }

    // Resolve the current spot price matching the timeline playhead scrubber
    // Since history might only have 1 timestamp (EOD) and candles has simulated intraday session,
    // match playhead close value to activeCandle
    const resolvedPrice = activeCandle ? activeCandle.close : null;
    if (resolvedPrice != null) {
      spotLineRef.current = series.createPriceLine({
        price: resolvedPrice,
        color: '#f59e0b',
        lineWidth: 2, // Solid playhead line
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'Spot Price',
      });
    }

    // 3. Populate dynamic bubble markers: Shifts + Active Wall Highlights
    const markers: any[] = [];
    let prevCall: number | null = null;
    let prevPut: number | null = null;

    candles.forEach((c) => {
      // Place static circular markers on historical shifts to see when walls changed
      if (c.call_wall && c.call_wall !== prevCall) {
        markers.push({
          time: c.time as any,
          position: 'aboveBar',
          color: '#00e676',
          shape: 'circle',
          text: `C-Wall: $${c.call_wall.toFixed(0)}`,
        });
        prevCall = c.call_wall;
      }
      if (c.put_wall && c.put_wall !== prevPut) {
        markers.push({
          time: c.time as any,
          position: 'belowBar',
          color: colorTheme === 'classic' ? '#ff3d00' : '#c084fc',
          shape: 'circle',
          text: `P-Wall: $${c.put_wall.toFixed(0)}`,
        });
        prevPut = c.put_wall;
      }

      // Add a distinct highlight exactly at the current active playhead timestamp
      const activeMatch = currentTimestamp !== null 
        ? (c.time === currentTimestamp) 
        : (activeCandle && c.time === activeCandle.time);

      if (activeMatch) {
        if (c.spot_price) {
          markers.push({
            time: c.time as any,
            position: 'inBar',
            color: '#fbbf24',
            shape: 'circle',
            text: `Replay Head ($${c.spot_price.toFixed(2)})`,
          });
        }
      }
    });

    if (seriesMarkersRef.current) {
      seriesMarkersRef.current.setMarkers(markers);
    }
  }, [candles.length, currentTimestamp, activeChartTicker, colorTheme, activeCandle]);

  // Handle manual ticker switch
  const handleTickerSwitch = (t: string) => {
    setActiveChartTicker(t);
  };

  // Helper to format values
  const displayCandle = hoveredCandle || activeCandle;
  const isUp = displayCandle ? displayCandle.close >= displayCandle.open : true;
  const ohlcColorClass = isUp ? styles.up : styles.down;

  return (
    <div className={styles.container}>
      {/* Header controls for Compass chart component */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h3 className={styles.title}>
            <span>Compass Chart</span>
            <span className={styles.badge}>TradingView</span>
          </h3>
        </div>

        {/* Ticker selector tab buttons */}
        <div className={styles.tickerSelector}>
          {CHART_TICKERS.map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.tickerBtn} ${t === activeChartTicker ? styles.tickerBtnActive : ''}`}
              onClick={() => handleTickerSwitch(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Candlestick & Levels display viewport */}
      <div className={styles.chartArea}>
        {candles.length === 0 && (
          <div className={styles.noData}>
            <div className={styles.spinner} />
            <span>Preloading {activeChartTicker} candlestick feed...</span>
          </div>
        )}

        {candles.length > 0 && (
          /* Tooltip Overlay showing active/hovered OHLC and Gamma levels */
          <div className={styles.overlay}>
            {displayCandle && (
              <div className={styles.ohlcBar}>
                <span className={styles.ohlcLabel}>O</span>
                <span className={`${styles.ohlcVal} ${ohlcColorClass}`}>${displayCandle.open.toFixed(2)}</span>
                <span className={styles.ohlcLabel}>H</span>
                <span className={`${styles.ohlcVal} ${ohlcColorClass}`}>${displayCandle.high.toFixed(2)}</span>
                <span className={styles.ohlcLabel}>L</span>
                <span className={`${styles.ohlcVal} ${ohlcColorClass}`}>${displayCandle.low.toFixed(2)}</span>
                <span className={styles.ohlcLabel}>C</span>
                <span className={`${styles.ohlcVal} ${ohlcColorClass}`}>${displayCandle.close.toFixed(2)}</span>
              </div>
            )}

            {/* Gamma Wall badges corresponding to displayCandle's moment */}
            {displayCandle && (
              <div className={styles.statsGrid}>
                {displayCandle.spot_price && (
                  <div className={styles.statItem} style={{ borderLeft: '3px solid #f59e0b' }}>
                    <span className={styles.statLabel}>Spot</span>
                    <span className={styles.statVal}>${displayCandle.spot_price.toFixed(2)}</span>
                  </div>
                )}
                {displayCandle.call_wall && (
                  <div className={styles.statItem} style={{ borderLeft: '3px solid #34d399' }}>
                    <span className={styles.statLabel}>Call Wall</span>
                    <span className={styles.statVal}>${displayCandle.call_wall.toFixed(0)}</span>
                  </div>
                )}
                {displayCandle.put_wall && (
                  <div className={styles.statItem} style={{ borderLeft: `3px solid ${colorTheme === 'classic' ? '#f87171' : '#c084fc'}` }}>
                    <span className={styles.statLabel}>Put Wall</span>
                    <span className={styles.statVal}>${displayCandle.put_wall.toFixed(0)}</span>
                  </div>
                )}
                {displayCandle.gamma_flip && (
                  <div className={styles.statItem} style={{ borderLeft: '3px solid #fbbf24' }}>
                    <span className={styles.statLabel}>Flip</span>
                    <span className={styles.statVal}>${displayCandle.gamma_flip.toFixed(0)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Core HTML Canvas wrapper - permanently rendered to prevent null ref initialization */}
        <div ref={chartContainerRef} className={styles.chartContainer} />
      </div>
    </div>
  );
}
export default CompassChart;
