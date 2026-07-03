import { useEffect } from 'react';
import { Header } from './components/Header/Header';
import { Sidebar } from './components/Sidebar/Sidebar';
import { HeatmapContainer } from './components/HeatmapContainer/HeatmapContainer';
import { TimelineControls } from './components/TimelineControls/TimelineControls';
import { useAppStore } from './store/useAppStore';
import { generateMockTimeline } from './api/client';
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

  // ── Bootstrap with mock data in development ──────────────────────────────
  useEffect(() => {
    openTickers.forEach((ticker, index) => {
      const { timestamps, snapshots } = generateMockTimeline(ticker, selectedMetric, strikeCount);
      setTimelineData(ticker, timestamps, snapshots);

      // Default to the latest snapshot in the timeline
      const latestTs = timestamps[timestamps.length - 1];
      const snap = snapshots[latestTs];

      setHeatmapForTicker(ticker, snap);
      if (ticker === activeTicker || index === 0) {
        setHeatmap(snap);
      }
    });
  }, [activeTicker, openTickers, selectedMetric, strikeCount, setHeatmap, setHeatmapForTicker, setTimelineData]);


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
