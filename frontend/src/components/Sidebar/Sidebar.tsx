import { useAppStore } from '../../store/useAppStore';
import { METRIC_LABELS } from '../../types';
import styles from './Sidebar.module.css';

function formatValue(value: number, metric: string): string {
  if (metric.includes('oi') || metric === 'volume') {
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return value.toFixed(0);
  }
  // Exposure values
  if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return value.toFixed(2);
}

export function Sidebar() {
  const hoveredCell     = useAppStore((s) => s.hoveredCell);
  const selectedMetric  = useAppStore((s) => s.selectedMetric);
  const activeTicker    = useAppStore((s) => s.activeTicker);

  const isPositive = hoveredCell ? hoveredCell.value >= 0 : false;

  return (
    <aside className={styles.sidebar}>
      <h2 className={styles.sidebarTitle}>Inspector</h2>
      <div className={styles.content}>
        {hoveredCell ? (
          <section className={`${styles.hoverPane} ${styles.cellInfo}`}>
            <div className={styles.cellHeader}>
              <span className={styles.cellTicker}>{hoveredCell.ticker ?? activeTicker}</span>
              <span
                className={`${styles.cellSign} ${isPositive ? styles.positive : styles.negative}`}
              >
                {isPositive ? '▲ Long' : '▼ Short'}
              </span>
            </div>

            <div className={styles.metricValue}>
              <span
                className={`${styles.valueAmount} ${isPositive ? styles.positive : styles.negative}`}
              >
                {isPositive ? '+' : ''}{formatValue(hoveredCell.value, selectedMetric)}
              </span>
              <span className={styles.metricName}>{METRIC_LABELS[selectedMetric]}</span>
            </div>

            <div className={styles.cellDetails}>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Strike</span>
                <span className={styles.detailValue}>${hoveredCell.strike.toFixed(2)}</span>
              </div>
              <div className={styles.detailRow}>
                <span className={styles.detailLabel}>Expiration</span>
                <span className={styles.detailValue}>{hoveredCell.expiration}</span>
              </div>
            </div>
          </section>
        ) : (
          <p className={`${styles.hoverPane} ${styles.emptyHint}`}>Hover over a cell to inspect its details.</p>
        )}
      </div>
    </aside>
  );
}
