import { useEffect } from 'react';
import type { HeatmapSnapshot } from './types';
import { Header } from './components/Header/Header';
import { Sidebar } from './components/Sidebar/Sidebar';
import { HeatmapContainer } from './components/HeatmapContainer/HeatmapContainer';
import { TimelineControls } from './components/TimelineControls/TimelineControls';
import { useAppStore } from './store/useAppStore';
import { api } from './api/client';
import styles from './App.module.css';

import { useWebSocket } from './hooks/useWebSocket';

export function App() {
  useWebSocket();

  const setHeatmap     = useAppStore((s) => s.setHeatmap);
  const setHeatmapForTicker = useAppStore((s) => s.setHeatmapForTicker);
  const setTimelineData = useAppStore((s) => s.setTimelineData);
  const activeTicker   = useAppStore((s) => s.activeTicker);
  const openTickers    = useAppStore((s) => s.openTickers);
  const selectedMetric = useAppStore((s) => s.selectedMetric);
  const strikeCount    = useAppStore((s) => s.strikeCount);
  const selectedDate   = useAppStore((s) => s.selectedDate);
  const setTimestamp   = useAppStore((s) => s.setTimestamp);
  const isLoadingHistory = useAppStore((s) => s.isLoadingHistory);
  const setIsLoadingHistory = useAppStore((s) => s.setIsLoadingHistory);

  // 1. Preload the complete date timeline and history snapshots on mount / ticker change / date change
  useEffect(() => {
    const fetchAll = async () => {
      setIsLoadingHistory(true);
      
      await Promise.all(openTickers.map(async (ticker, index) => {
        try {
          // Query timeline for the target date
          const timeline = await api.getTimeline(ticker, selectedDate);
          const timestamps = timeline.timestamps;
          
          if (timestamps.length === 0) {
            // If no history on this date, clear timeline but don't crash
            setTimelineData(ticker, [], {});
            setHeatmapForTicker(ticker, null);
            if (ticker === activeTicker || index === 0) {
              setHeatmap(null);
              setTimestamp(null);
            }
            return;
          }

          // Fetch the full history matrix of snapshots in a single bulk request
          const historyData = await api.getHeatmapHistory(ticker, {
            date: selectedDate,
            metric: selectedMetric,
            strikeCount
          });

          // Normalize history keys: backend returns string keys ("1751500800")
          // but timeline returns numeric timestamps (1751500800).
          // Re-key the history dict with numbers so lookups match.
          const normalizedHistory: Record<number, HeatmapSnapshot> = {};
          for (const [key, value] of Object.entries(historyData.history)) {
            normalizedHistory[Number(key)] = value;
          }

          // Store the preloaded snapshots in local history cache
          setTimelineData(ticker, timestamps, normalizedHistory);

          // Default to the latest snapshot in the timeline
          const latestTs = timestamps[timestamps.length - 1];
          const snap = normalizedHistory[latestTs];

          if (snap) {
            setHeatmapForTicker(ticker, snap);
            if (ticker === activeTicker || index === 0) {
              setHeatmap(snap);
              setTimestamp(latestTs);
            }
          }
        } catch (err) {
          console.error("Failed to fetch heatmap timeline history:", err);
        }
      }));
      
      setIsLoadingHistory(false);
    };
    
    fetchAll();
  }, [openTickers, selectedMetric, strikeCount, selectedDate, setTimelineData, setHeatmapForTicker, setHeatmap, setTimestamp, activeTicker, setIsLoadingHistory]);


  return (
    <div className={styles.app}>
      <Header />
      <div className={styles.workspace}>
        {isLoadingHistory && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner}></div>
            <p>Loading market data...</p>
          </div>
        )}
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
