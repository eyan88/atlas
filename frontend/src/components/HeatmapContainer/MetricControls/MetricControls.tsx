import { useAppStore } from '../../../store/useAppStore';
import { METRIC_LABELS } from '../../../types';
import type { Metric } from '../../../types';
import styles from './MetricControls.module.css';

const METRICS: Metric[] = ['net_gex', 'net_dex', 'vanna', 'charm', 'call_oi', 'put_oi', 'volume', 'rel_pm'];

export function MetricControls() {
  const selectedMetric = useAppStore((s) => s.selectedMetric);
  const setMetric      = useAppStore((s) => s.setMetric);

  return (
    <div className={styles.controls} role="toolbar" aria-label="Metric selector">
      {METRICS.map((m) => (
        <button
          key={m}
          id={`metric-btn-${m}`}
          className={`${styles.btn} ${selectedMetric === m ? styles.btnActive : ''}`}
          onClick={() => setMetric(m)}
          aria-pressed={selectedMetric === m}
          title={METRIC_LABELS[m]}
        >
          {METRIC_LABELS[m]}
        </button>
      ))}
    </div>
  );
}
