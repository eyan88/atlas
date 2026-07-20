import { useEffect } from 'react';
import type { HeatmapSnapshot } from './types';
import { Header } from './components/Header/Header';
import { HeatmapContainer } from './components/HeatmapContainer/HeatmapContainer';
import { TimelineControls } from './components/TimelineControls/TimelineControls';
import { HoverTooltip } from './components/HoverTooltip/HoverTooltip';
import { useAppStore, toSeconds } from './store/useAppStore';
import { api } from './api/client';
import styles from './App.module.css';

import { useWebSocket } from './hooks/useWebSocket';
import { MetricControls } from './components/HeatmapContainer/MetricControls/MetricControls';
import { EvolutionControls } from './components/HeatmapContainer/EvolutionControls/EvolutionControls';

export function App() {
  useWebSocket();

  const setHeatmap     = useAppStore((s) => s.setHeatmap);
  const setHeatmapForTicker = useAppStore((s) => s.setHeatmapForTicker);
  const setTimelineData = useAppStore((s) => s.setTimelineData);
  const activeTab      = useAppStore((s) => s.activeTab);
  const activeTicker   = useAppStore((s) => s.activeTicker);
  const openTickers    = useAppStore((s) => s.openTickers);
  const setTicker      = useAppStore((s) => s.setTicker);
  const closeTickerPane = useAppStore((s) => s.closeTickerPane);
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
      
      const tickersToFetch = activeTab === 'compass' ? ['SPY', 'QQQ', 'IWM'] : openTickers;

      await Promise.all(tickersToFetch.map(async (ticker, index) => {
        try {
          // Query timeline for the target date
          const timeline = await api.getTimeline(ticker, selectedDate);
          const timestamps = timeline.timestamps.map(toSeconds);
          
          if (timestamps.length === 0) {
            // If no history on this date, clear timeline but don't crash
            setTimelineData(ticker, [], {});
            
            // Only clear the heatmap if this is a historical date.
            // If it's live mode (today), the WebSocket INIT will provide the baseline
            // heatmap (e.g., from yesterday's close) and we should retain it.
            const todayStr = new Date().toISOString().split('T')[0];
            const isLive = selectedDate === todayStr;
            
            if (!isLive) {
              setHeatmapForTicker(ticker, null);
              if (ticker === activeTicker || index === 0) {
                setHeatmap(null);
                setTimestamp(null);
              }
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
            const secKey = toSeconds(Number(key));
            normalizedHistory[secKey] = {
              ...value,
              timestamp: new Date(secKey * 1000).toISOString(),
            };
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
  }, [openTickers, activeTab, selectedMetric, strikeCount, selectedDate, setTimelineData, setHeatmapForTicker, setHeatmap, setTimestamp, activeTicker, setIsLoadingHistory]);

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
        <div className={styles.mainArea}>
          <div className={styles.globalControlsBar}>
            {activeTab === 'heatmap' && openTickers.length > 0 ? (
              <div className={styles.browserTabs}>
                {openTickers.map((t) => (
                  <div
                    key={t}
                    className={`${styles.browserTab} ${t === activeTicker ? styles.browserTabActive : ''}`}
                    onClick={() => setTicker(t)}
                  >
                    <span className={styles.browserTabTitle}>{t}</span>
                    <button
                      type="button"
                      className={styles.browserTabClose}
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTickerPane(t);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ flex: 1 }} />
            )}
            <div className={styles.controlsGroup}>
              <MetricControls />
              <EvolutionControls />
            </div>
          </div>
          <div className={`${styles.paneStrip} ${activeTab === 'compass' ? styles.compassStrip : ''}`}>
            {activeTab === 'heatmap' ? (
              openTickers.map((ticker) => (
                <div
                  key={ticker}
                  style={{
                    display: ticker === activeTicker ? 'flex' : 'none',
                    flex: 1,
                    minWidth: 0,
                    minHeight: 0
                  }}
                >
                  <HeatmapContainer ticker={ticker} />
                </div>
              ))
            ) : (
              <>
                <HeatmapContainer key="SPY-compass" ticker="SPY" isCompassMode />
                <HeatmapContainer key="QQQ-compass" ticker="QQQ" isCompassMode />
                <HeatmapContainer key="IWM-compass" ticker="IWM" isCompassMode />
              </>
            )}
          </div>
        </div>
        <HoverTooltip />
      </div>
      <TimelineControls />
    </div>
  );
}
