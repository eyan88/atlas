import { useEffect, useRef, useState } from 'react';
import { createChart, LineStyle, IChartApi, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';
import { useAppStore } from '../../store/useAppStore';
import { api } from '../../api/client';
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

  // References for horizontal GEX price lines on the chart
  const spotLineRef = useRef<any>(null);
  const callLineRef = useRef<any>(null);
  const putLineRef = useRef<any>(null);
  const flipLineRef = useRef<any>(null);

  // Zustand Store queries
  const currentTimestamp = useAppStore((s) => s.currentTimestamp);
  const colorTheme = useAppStore((s) => s.colorTheme);
  const selectedDate = useAppStore((s) => s.selectedDate);

  // Local chart ticker and candle states
  const [activeChartTicker, setActiveChartTicker] = useState('SPY');
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

        const formattedCandles = priceCandles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          spot_price: c.close,
          call_wall: walls.call_wall,
          put_wall: walls.put_wall,
          gamma_flip: walls.gamma_flip,
        }));

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
  }, [activeChartTicker, selectedDate]);

  // Find currently active candle matching the timeline slider playhead (closest 2.5-minute match)
  const activeCandle = currentTimestamp
    ? candles.find((c) => Math.abs(c.time - currentTimestamp) < 150) || candles[candles.length - 1]
    : candles[candles.length - 1];

  // Selected level values for display
  const spotPriceVal = activeCandle?.close;
  const callWallVal = prevEodLevels?.call_wall;
  const putWallVal = prevEodLevels?.put_wall;
  const flipVal = prevEodLevels?.gamma_flip;

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
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
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

  // 2. Reactively update candles, price lines, and markers
  useEffect(() => {
    const series = candlestickSeriesRef.current;
    if (!series || candles.length === 0) return;

    // Load series data
    series.setData(candles);

    // Clean up previous price lines
    if (spotLineRef.current) {
      series.removePriceLine(spotLineRef.current);
      spotLineRef.current = null;
    }
    if (callLineRef.current) {
      series.removePriceLine(callLineRef.current);
      callLineRef.current = null;
    }
    if (putLineRef.current) {
      series.removePriceLine(putLineRef.current);
      putLineRef.current = null;
    }
    if (flipLineRef.current) {
      series.removePriceLine(flipLineRef.current);
      flipLineRef.current = null;
    }

    // 2. Draw static horizontal settled levels from previous EOD
    if (callWallVal != null) {
      callLineRef.current = series.createPriceLine({
        price: callWallVal,
        color: '#00e676',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Call Wall',
      });
    }
    if (putWallVal != null) {
      putLineRef.current = series.createPriceLine({
        price: putWallVal,
        color: colorTheme === 'classic' ? '#f87171' : '#c084fc',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'Put Wall',
      });
    }
    if (flipVal != null) {
      flipLineRef.current = series.createPriceLine({
        price: flipVal,
        color: '#fbbf24',
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: 'Gamma Flip',
      });
    }

    // 3. Draw dynamic solid price line for active spot replay position
    if (spotPriceVal != null) {
      spotLineRef.current = series.createPriceLine({
        price: spotPriceVal,
        color: '#f59e0b',
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: 'Spot Price',
      });
    }

    // 4. Draw a dynamic marker bubble directly on the playhead candle
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
  }, [candles, spotPriceVal, callWallVal, putWallVal, flipVal, activeCandle, colorTheme]);

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

        {/* Core Canvas Element */}
        <div ref={chartContainerRef} className={styles.chartContainer} />
      </div>
    </div>
  );
}

export default CompassChart;
