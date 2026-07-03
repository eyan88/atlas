import { useEffect } from 'react';
import { Header } from './components/Header/Header';
import { Sidebar } from './components/Sidebar/Sidebar';
import { HeatmapContainer } from './components/HeatmapContainer/HeatmapContainer';
import { TimelineControls } from './components/TimelineControls/TimelineControls';
import { useAppStore } from './store/useAppStore';
import { api } from './api/client';
import styles from './App.module.css';

// NOTE: Import and call useWebSocket() here when the backend is ready.
// import { useWebSocket } from './hooks/useWebSocket';

export function App() {
  // useWebSocket();  ← uncomment once FastAPI backend is running

  const setHeatmap     = useAppStore((s) => s.setHeatmap);
  const setHeatmapForTicker = useAppStore((s) => s.setHeatmapForTicker);
  const setTimelineData = useAppStore((s) => s.setTimelineData);
  const activeTicker   = useAppStore((s) => s.activeTicker);
  const openTickers    = useAppStore((s) => s.openTickers);
  const selectedMetric = useAppStore((s) => s.selectedMetric);
  const strikeCount    = useAppStore((s) => s.strikeCount);

  const currentTimestamp    = useAppStore((s) => s.currentTimestamp);
  const snapshotsHistory    = useAppStore((s) => s.snapshotsHistory);

  // 1. Fetch timeline and initial latest snapshot on mount / ticker change
  useEffect(() => {
    openTickers.forEach(async (ticker, index) => {
      try {
        // Query timeline for the target seeded date '2026-07-02'
        const timeline = await api.getTimeline(ticker, '2026-07-02');
        const timestamps = timeline.timestamps;
        
        if (timestamps.length === 0) return;

        // Fetch latest snapshot
        const latestTs = timestamps[timestamps.length - 1];
        const latestIso = new Date(latestTs * 1000).toISOString();
        const snap = await api.getHeatmap(ticker, {
          metric: selectedMetric,
          timestamp: latestIso,
          strikeCount
        });

        // Store in local cache history
        setTimelineData(ticker, timestamps, { [latestTs]: snap });
        setHeatmapForTicker(ticker, snap);
        if (ticker === activeTicker || index === 0) {
          setHeatmap(snap);
        }
      } catch (err) {
        console.error("Failed to fetch initial heatmap data:", err);
      }
    });
  }, [openTickers, selectedMetric, strikeCount, setTimelineData, setHeatmapForTicker, setHeatmap, activeTicker]);

  // 2. Load historical snapshots on-demand when scrubbing/playing
  useEffect(() => {
    if (!currentTimestamp) return;

    openTickers.forEach(async (ticker) => {
      try {
        // Check if already in cache history
        const cached = snapshotsHistory[ticker]?.[currentTimestamp];
        if (cached) {
          // If cached, just set it
          setHeatmapForTicker(ticker, cached);
          if (ticker === activeTicker) {
            setHeatmap(cached);
          }
          return;
        }

        // Fetch snapshot for current timestamp
        const isoString = new Date(currentTimestamp * 1000).toISOString();
        const snap = await api.getHeatmap(ticker, {
          metric: selectedMetric,
          timestamp: isoString,
          strikeCount
        });

        // Add to cache history
        setTimelineData(ticker, useAppStore.getState().timelineTimestamps, {
          ...snapshotsHistory[ticker],
          [currentTimestamp]: snap
        });

        setHeatmapForTicker(ticker, snap);
        if (ticker === activeTicker) {
          setHeatmap(snap);
        }
      } catch (err) {
        console.error(`Failed to fetch heatmap for timestamp ${currentTimestamp}:`, err);
      }
    });
  }, [currentTimestamp, openTickers, selectedMetric, strikeCount, activeTicker, snapshotsHistory, setTimelineData, setHeatmapForTicker, setHeatmap]);


  return (
    <div className={styles.app}>
      <Header />
      <div className={styles.workspace}>
        <div className={styles.paneStrip}>
          {openTickers.map((ticker) => (
            <HeatmapContainer key={ticker} ticker={ticker} />
          ))}
        </div>
        <Sidebar />
      </div>
      <TimelineControls />
    </div>
  );
}
