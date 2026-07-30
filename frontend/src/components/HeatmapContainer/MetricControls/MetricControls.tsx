import { useAppStore } from '../../../store/useAppStore';
import { METRIC_LABELS } from '../../../types';
import type { Metric } from '../../../types';
import styles from './MetricControls.module.css';

const METRICS: Metric[] = ['net_gex', 'net_dex', 'vanna', 'charm', 'call_oi', 'put_oi', 'volume'];

export function MetricControls() {
  const selectedMetric = useAppStore((s) => s.selectedMetric);
  const setMetric      = useAppStore((s) => s.setMetric);

  return (
    <div className={styles.controls} title="Select Heatmap Exposure Metric">
      <span className={styles.label}>Metric:</span>
      <select
        id="metric-select-dropdown"
        className={styles.select}
        value={selectedMetric}
        onChange={(e) => setMetric(e.target.value as Metric)}
        aria-label="Select Exposure Metric"
      >
        {METRICS.map((m) => (
          <option key={m} value={m}>
            {METRIC_LABELS[m]}
          </option>
        ))}
      </select>
    </div>
  );
}
