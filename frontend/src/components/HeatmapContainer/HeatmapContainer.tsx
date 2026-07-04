import { MetricControls } from './MetricControls/MetricControls';
import { EvolutionControls } from './EvolutionControls/EvolutionControls';
import { CanvasHeatmap } from './CanvasHeatmap/CanvasHeatmap';
import { useAppStore } from '../../store/useAppStore';
import styles from './HeatmapContainer.module.css';

interface HeatmapContainerProps {
  ticker: string;
}

export function HeatmapContainer({ ticker }: HeatmapContainerProps) {
  const closeTickerPane = useAppStore((s) => s.closeTickerPane);
  const snapshot = useAppStore((s) => s.heatmapsByTicker[ticker] ?? null);

  return (
    <section className={styles.container}>
      <div className={styles.titleBar}>
        <span className={styles.title}>{ticker}</span>
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
      <div className={styles.viewport}>
        <CanvasHeatmap ticker={ticker} />
      </div>
    </section>
  );
}
