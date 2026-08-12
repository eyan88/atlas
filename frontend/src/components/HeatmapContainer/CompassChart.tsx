import { useEffect, useRef, useState } from 'react';
import { createChart, IChartApi, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';
import { useAppStore } from '../../store/useAppStore';
import { api } from '../../api/client';
import styles from './CompassChart.module.css';

const CHART_TICKERS = ['SPY', 'QQQ', 'IWM'];

interface GammaLevel {
  strike: number;
  net_gex: number;
  abs_gex: number;
}

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
  net_gamma?: number | null;
  gamma_levels?: GammaLevel[];
  session_peak_gex?: number;
}

export function CompassChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candlestickSeriesRef = useRef<any>(null);
  const seriesMarkersRef = useRef<any>(null);

  // Zustand Store queries
  const snapshotsHistory = useAppStore((s) => s.snapshotsHistory);
  const currentTimestamp = useAppStore((s) => s.currentTimestamp);
  const colorTheme = useAppStore((s) => s.colorTheme);
  const selectedDate = useAppStore((s) => s.selectedDate);

  // Local chart ticker, source and candle states
  const [activeChartTicker, setActiveChartTicker] = useState('SPY');
  const [gexSource, setGexSource] = useState<'active' | 'prior'>('active');
  const [candles, setCandles] = useState<CandleData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hoveredCandle, setHoveredCandle] = useState<CandleData | null>(null);
  
  // State to track settled options levels from previous trading session EOD
  const [prevEodLevels, setPrevEodLevels] = useState<{
    date: string;
    call_wall: number | null;
    put_wall: number | null;
    gamma_flip: number | null;
  } | null>(null);

  const tickerHistory = snapshotsHistory[activeChartTicker] ?? {};

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

  // Fetch actual price action candles and previous GEX levels dynamically when ticker/date changes
  useEffect(() => {
    let active = true;
    const loadChartData = async () => {
      setIsLoading(true);
      try {
        // 1. Fetch previous day's EOD settled options levels
        const prevDate = getPreviousTradingDay(selectedDate);
        let walls: {
          call_wall: number | null;
          put_wall: number | null;
          gamma_flip: number | null;
        } = { call_wall: null, put_wall: null, gamma_flip: null };
        try {
          const prevData = await api.getHeatmapHistory(activeChartTicker, {
            date: prevDate,
            strikeCount: 40,
          });
          const keys = Object.keys(prevData.history).map(Number).sort((a, b) => a - b);
          if (keys.length > 0) {
            const latestSnap = prevData.history[keys[keys.length - 1]];
            walls = {
              call_wall: latestSnap.call_wall,
              put_wall: latestSnap.put_wall,
              gamma_flip: latestSnap.gamma_flip,
            };
            if (active) {
              setPrevEodLevels({
                date: prevDate,
                ...walls,
              });
            }
          } else {
            if (active) setPrevEodLevels(null);
          }
        } catch (err) {
          console.warn("Could not load previous day GEX levels, falling back:", err);
          if (active) setPrevEodLevels(null);
        }

        // 2. Fetch actual intraday price candles from backend
        const priceCandles = await api.getStockCandles(activeChartTicker, selectedDate);
        if (!active) return;

        // Map GEX levels onto each candle
        const historyKeys = Object.keys(tickerHistory).map(Number).sort((a, b) => a - b);
        const latestHistorySnap = historyKeys.length > 0 ? tickerHistory[historyKeys[historyKeys.length - 1]] : null;

        const formattedCandles = priceCandles.map((c) => {
          // If using prior levels, assign previous day EOD walls. Otherwise look up corresponding active day snapshot
          let callWall = walls.call_wall;
          let putWall = walls.put_wall;
          let flip = walls.gamma_flip;

          if (gexSource === 'active') {
            const snapKey = historyKeys.find((ts) => Math.abs(ts - c.time) < 150);
            const snap = snapKey ? tickerHistory[snapKey] : latestHistorySnap;
            callWall = snap?.call_wall ?? null;
            putWall = snap?.put_wall ?? null;
            flip = snap?.gamma_flip ?? null;
          }

          return {
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            spot_price: c.close,
            call_wall: callWall,
            put_wall: putWall,
            gamma_flip: flip,
          };
        });

        setCandles(formattedCandles);
      } catch (err) {
        console.error("Failed to load chart price action and GEX levels:", err);
        if (active) setCandles([]);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    loadChartData();
    return () => {
      active = false;
    };
  }, [activeChartTicker, selectedDate, gexSource]);

  // Find currently active candle matching the timeline slider playhead (closest 2.5-minute match)
  const activeCandle = currentTimestamp
    ? candles.find((c) => Math.abs(c.time - currentTimestamp) < 150) || candles[candles.length - 1]
    : candles[candles.length - 1];

  const liveSnap = useAppStore((s) => s.heatmapsByTicker[activeChartTicker] ?? s.heatmap);
  const liveSpot = useAppStore((s) => s.spotPrice);
  const currentSnap = currentTimestamp ? tickerHistory[currentTimestamp] : null;

  // Selected level values for display (matching live stream or active playhead candle at exact timestamp)
  const spotPriceVal = currentTimestamp === null 
    ? (liveSnap?.spot_price ?? liveSpot ?? activeCandle?.close) 
    : (currentSnap?.spot_price ?? activeCandle?.spot_price ?? activeCandle?.close);

  const callWallVal = currentTimestamp === null 
    ? (liveSnap?.call_wall ?? activeCandle?.call_wall) 
    : (currentSnap?.call_wall ?? activeCandle?.call_wall);

  const putWallVal = currentTimestamp === null 
    ? (liveSnap?.put_wall ?? activeCandle?.put_wall) 
    : (currentSnap?.put_wall ?? activeCandle?.put_wall);

  const flipVal = currentTimestamp === null 
    ? (liveSnap?.gamma_flip ?? activeCandle?.gamma_flip) 
    : (currentSnap?.gamma_flip ?? activeCandle?.gamma_flip);

  // Render OHLC values for hovered candle or active candle
  const displayCandle = hoveredCandle || activeCandle || null;
  const isPriceUp = displayCandle ? displayCandle.close >= displayCandle.open : true;
  const ohlcColorClass = isPriceUp ? styles.up : styles.down;

  // 1. Initialize Lightweight Chart Canvas
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      layout: {
        background: { color: '#0d1117' },
        textColor: 'rgba(255, 255, 255, 0.7)',
        fontSize: 10,
        fontFamily: 'Inter, system-ui, sans-serif',
      },
      localization: {
        timeFormatter: (time: any) => {
          const unixSec = typeof time === 'number' ? time : time?.timestamp;
          if (!unixSec || isNaN(unixSec)) return '';
          return new Date(unixSec * 1000).toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
        },
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: any) => {
          const unixSec = typeof time === 'number' ? time : time?.timestamp;
          if (!unixSec || isNaN(unixSec)) return '';
          return new Date(unixSec * 1000).toLocaleTimeString('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          });
        },
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

    // Initialize series markers plugin api
    seriesMarkersRef.current = createSeriesMarkers(candlestickSeries, []);

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;

    // Subscribe to crosshair hover moves to update legends display
    chart.subscribeCrosshairMove((param) => {
      if (param.time) {
        const data = param.seriesData.get(candlestickSeries) as CandleData | undefined;
        if (data) {
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
      chart.remove();
      chartRef.current = null;
      candlestickSeriesRef.current = null;
      seriesMarkersRef.current = null;
    };
  }, [activeChartTicker, colorTheme]);

  // 2. Reactively update candles data and active markers
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series || candles.length === 0) return;

    // Deduplicate and sort candles strictly ascending for Lightweight Charts
    const uniqueMap = new Map<number, CandleData>();
    candles.forEach((c) => {
      if (c && c.time && c.open !== undefined && c.high !== undefined && c.low !== undefined && c.close !== undefined) {
        const d = new Date(c.time * 1000);
        const nyTimeStr = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
        const parts = nyTimeStr.split(':');
        const hour = parseInt(parts[0], 10);
        const min = parseInt(parts[1], 10);
        const minuteOfDay = hour * 60 + min;
        if (minuteOfDay <= 960) {
            uniqueMap.set(c.time, c);
        }
      }
    });
    const sortedCandles = Array.from(uniqueMap.values()).sort((a, b) => a.time - b.time);
    
    // In Replay mode (currentTimestamp != null), slice candles up to playhead timestamp to paint price action bar-by-bar
    const isLive = currentTimestamp === null;
    const visibleCandles = isLive
      ? sortedCandles
      : sortedCandles.filter((c) => c.time <= currentTimestamp);

    if (visibleCandles.length > 0) {
      series.setData(visibleCandles);
    }

    // Draw a dynamic marker bubble directly on the playhead candle
    const markers: any[] = [];
    if (activeCandle && activeCandle.close) {
      markers.push({
        time: activeCandle.time as any,
        position: 'inBar',
        color: '#fbbf24',
        shape: 'circle',
        text: `Spot ($${activeCandle.close.toFixed(2)})`,
      });
    }

    if (seriesMarkersRef.current) {
      seriesMarkersRef.current.setMarkers(markers);
    }
  }, [candles, activeCandle, currentTimestamp]);

  // 3. Draw options level bubbles dynamically sized on canvas overlay
  useEffect(() => {
    const container = chartContainerRef.current;
    const canvas = overlayCanvasRef.current;
    const chart = chartRef.current;
    const series = candlestickSeriesRef.current;
    if (!container || !canvas || !chart || !series) return;

    let animFrameId: number;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Match high DPI scaling
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.scale(dpr, dpr);

      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);

      // Use session_peak_gex embedded per candle by backend for consistent session-wide normalization
      const sessionPeakGex = candles.reduce((peak, c) => Math.max(peak, c.session_peak_gex ?? 0), 0) || 1;

      // Filter candles for rendering canvas overlay up to current playhead timestamp in replay mode
      const isLive = currentTimestamp === null;
      const renderCandles = isLive ? candles : candles.filter((c) => c.time <= currentTimestamp);

      // Loop through and draw gamma node bubbles per candle using embedded gamma_levels
      renderCandles.forEach((c) => {
        const x = chart.timeScale().timeToCoordinate(c.time as any);
        if (x === null || x < 0 || x > canvas.clientWidth) return;

        // Use gamma_levels embedded directly in the candle by the backend enrichment pass.
        // Backend already pre-filtered to >= 25% of each snapshot's own peak.
        // Apply a final 20% session-peak guard to ensure only dominant institutional levels render.
        const levels = c.gamma_levels ?? [];
        const sigNodes = levels
          .filter((n) => n.abs_gex >= sessionPeakGex * 0.20)
          .map((n) => ({
            strike: n.strike,
            gex: n.net_gex,
            absGex: n.abs_gex,
            relativeMagnitude: n.abs_gex / sessionPeakGex,
          }));

        sigNodes.forEach((node) => {
          const y = series.priceToCoordinate(node.strike);
          if (y !== null && y >= 0 && y <= canvas.clientHeight) {
            const isPos = node.gex >= 0;
            const mag = node.relativeMagnitude;

            // 5-tier bubble size scaling relative to session peak
            let radius: number;
            if (mag >= 0.85) radius = 11.5;
            else if (mag >= 0.65) radius = 9.0;
            else if (mag >= 0.45) radius = 6.5;
            else if (mag >= 0.25) radius = 4.5;
            else radius = 2.5;

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = isPos
              ? 'rgba(52, 211, 153, 0.22)'
              : (colorTheme === 'classic' ? 'rgba(239, 68, 68, 0.22)' : 'rgba(192, 132, 252, 0.22)');
            ctx.strokeStyle = isPos
              ? 'rgba(52, 211, 153, 0.75)'
              : (colorTheme === 'classic' ? 'rgba(239, 68, 68, 0.75)' : 'rgba(192, 132, 252, 0.75)');
            ctx.lineWidth = 1;
            ctx.fill();
            ctx.stroke();
          }
        });

        // Draw Gamma Flip dot (yellow accent)
        if (c.gamma_flip != null) {
          const y = series.priceToCoordinate(c.gamma_flip);
          if (y !== null && y >= 0 && y <= canvas.clientHeight) {
            ctx.beginPath();
            ctx.arc(x, y, 2.5, 0, 2 * Math.PI);
            ctx.fillStyle = 'rgba(251, 191, 36, 0.35)';
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
            ctx.lineWidth = 0.75;
            ctx.fill();
            ctx.stroke();
          }
        }
      });
    };

    const triggerRedraw = () => {
      cancelAnimationFrame(animFrameId);
      animFrameId = requestAnimationFrame(draw);
    };

    chart.timeScale().subscribeVisibleTimeRangeChange(triggerRedraw);
    chart.subscribeCrosshairMove(triggerRedraw);
    triggerRedraw();

    window.addEventListener('resize', triggerRedraw);

    return () => {
      cancelAnimationFrame(animFrameId);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(triggerRedraw);
      chart.subscribeCrosshairMove(triggerRedraw);
      window.removeEventListener('resize', triggerRedraw);
    };
  }, [candles, colorTheme, gexSource, tickerHistory]);

  return (
    <div className={styles.container}>
      {/* Widget Control Header */}
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <span className={styles.title}>Real-Time Chart</span>
          {prevEodLevels && gexSource === 'prior' && (
            <span className={styles.subtitle}>
              Prior day close: {prevEodLevels.date}
            </span>
          )}
        </div>

        {/* Dynamic GEX Options levels readout */}
        <div className={styles.headerStats}>
          {spotPriceVal != null && (
            <div className={styles.headerStatItem} style={{ borderLeft: '3px solid #f59e0b' }}>
              <span className={styles.statLabel}>Spot</span>
              <span className={styles.statVal}>${spotPriceVal.toFixed(2)}</span>
            </div>
          )}
          {callWallVal != null && (
            <div className={styles.headerStatItem} style={{ borderLeft: '3px solid #34d399' }}>
              <span className={styles.statLabel}>Call Wall</span>
              <span className={styles.statVal}>${callWallVal.toFixed(0)}</span>
            </div>
          )}
          {putWallVal != null && (
            <div className={styles.headerStatItem} style={{ borderLeft: `3px solid ${colorTheme === 'classic' ? '#f87171' : '#c084fc'}` }}>
              <span className={styles.statLabel}>Put Wall</span>
              <span className={styles.statVal}>${putWallVal.toFixed(0)}</span>
            </div>
          )}
          {flipVal != null && (
            <div className={styles.headerStatItem} style={{ borderLeft: '3px solid #fbbf24' }}>
              <span className={styles.statLabel}>Flip</span>
              <span className={styles.statVal}>${flipVal.toFixed(0)}</span>
            </div>
          )}
        </div>

        {/* Source Toggle + Ticker selectors */}
        <div className={styles.controls}>
          <div className={styles.toggleGroup}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${gexSource === 'active' ? styles.toggleBtnActive : ''}`}
              onClick={() => setGexSource('active')}
            >
              Active
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${gexSource === 'prior' ? styles.toggleBtnActive : ''}`}
              onClick={() => setGexSource('prior')}
            >
              Prior Day
            </button>
          </div>

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
      </div>

      {/* Candlestick & Levels display viewport */}
      <div className={styles.chartArea}>
        {isLoading && (
          <div className={styles.noData}>
            <div className={styles.spinner} />
            <span>Preloading {activeChartTicker} candlestick feed...</span>
          </div>
        )}
        
        {/* Tooltip Hover Overlay */}
        {candles.length > 0 && displayCandle && (
          <div className={styles.overlay}>
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
          </div>
        )}

        {/* Transparent Overlay Canvas for drawing dynamic GEX bubbles */}
        <canvas ref={overlayCanvasRef} className={styles.overlayCanvas} />

        {/* Core Canvas Element */}
        <div ref={chartContainerRef} className={styles.chartContainer} />
      </div>
    </div>
  );
}

export default CompassChart;
