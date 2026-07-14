import { useRef, useEffect } from 'react';
import { MetricControls } from './MetricControls/MetricControls';
import { EvolutionControls } from './EvolutionControls/EvolutionControls';
import { CanvasHeatmap } from './CanvasHeatmap/CanvasHeatmap';
import { useAppStore } from '../../store/useAppStore';
import styles from './HeatmapContainer.module.css';

interface HeatmapContainerProps {
  ticker: string;
  isCompassMode?: boolean;
}

export function HeatmapContainer({ ticker, isCompassMode = false }: HeatmapContainerProps) {
  const closeTickerPane = useAppStore((s) => s.closeTickerPane);
  const snapshot = useAppStore((s) => s.heatmapsByTicker[ticker] ?? null);

  const viewportRef = useRef<HTMLDivElement>(null);

  // Synchronize scrolling across all compass viewports
  useEffect(() => {
    if (!isCompassMode || !viewportRef.current) return;
    const vp = viewportRef.current;

    const handleScroll = () => {
      const allViewports = document.querySelectorAll('.compass-viewport');
      allViewports.forEach((otherVp) => {
        if (otherVp !== vp && otherVp.scrollTop !== vp.scrollTop) {
          otherVp.scrollTop = vp.scrollTop;
        }
      });
    };

    vp.addEventListener('scroll', handleScroll, { passive: true });
    return () => vp.removeEventListener('scroll', handleScroll);
  }, [isCompassMode]);

  return (
    <section className={styles.container}>
      <div className={styles.titleBar}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
          <span className={styles.title}>{ticker}</span>
          {snapshot?.timestamp && (
            <span className={styles.timestamp}>
              {new Date(snapshot.timestamp).toLocaleString(undefined, { 
                month: 'short', 
                day: 'numeric', 
                hour: 'numeric', 
                minute: '2-digit' 
              })}
            </span>
          )}
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={() => closeTickerPane(ticker)}
          aria-label={`Close ${ticker} heatmap`}
          title={`Close ${ticker}`}
        >
          ×
        </button>
      </div>
      <div className={styles.levelBar}>
        <div className={`${styles.levelBadge} ${styles.badgeSpot}`} title="Current spot price (White row outline)">
          <span className={styles.levelLabel}>SPOT</span>
          <span className={styles.levelValue}>{snapshot?.spot_price?.toFixed(2) ?? '—'}</span>
        </div>
        <div className={`${styles.levelBadge} ${styles.badgeFlip}`} title="Gamma flip level (Amber/Gold row outline)">
          <span className={styles.levelLabel}>FLIP</span>
          <span className={styles.levelValue}>{snapshot?.gamma_flip?.toFixed(0) ?? '—'}</span>
        </div>
        <div className={`${styles.levelBadge} ${styles.badgeCall}`} title="Call wall (Mint Green row outline)">
          <span className={styles.levelLabel}>CALL</span>
          <span className={styles.levelValue}>{snapshot?.call_wall?.toFixed(0) ?? '—'}</span>
        </div>
        <div className={`${styles.levelBadge} ${styles.badgePut}`} title="Put wall (Coral Red row outline)">
          <span className={styles.levelLabel}>PUT</span>
          <span className={styles.levelValue}>{snapshot?.put_wall?.toFixed(0) ?? '—'}</span>
        </div>
      </div>
      <MetricControls />
      <EvolutionControls />
      <div 
        ref={viewportRef}
        className={`${styles.viewport} ${isCompassMode ? 'compass-viewport' : ''}`}
      >
        <CanvasHeatmap ticker={ticker} isCompassMode={isCompassMode} />
      </div>
    </section>
  );
}
