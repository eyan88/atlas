import { useAppStore } from '../../../store/useAppStore';
import { METRIC_LABELS } from '../../../types';
import type { Metric } from '../../../types';
import styles from './MetricControls.module.css';

const METRICS: Metric[] = ['net_gex', 'net_dex', 'vanna', 'charm', 'call_oi', 'put_oi', 'volume'];

export function MetricControls() {
  const selectedMetric = useAppStore((s) => s.selectedMetric);
  const setMetric      = useAppStore((s) => s.setMetric);
  const highlightSignificantNodes = useAppStore((s) => s.highlightSignificantNodes);
  const toggleHighlightSignificantNodes = useAppStore((s) => s.toggleHighlightSignificantNodes);

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

      <button
        type="button"
        className={`${styles.highlightBtn} ${highlightSignificantNodes ? styles.highlightBtnActive : ''}`}
        onClick={toggleHighlightSignificantNodes}
        title="Highlight significant GEX nodes & dim non-significant cells"
        aria-label="Highlight Significant Nodes"
      >
        <span className={styles.btnIcon}>⚡</span>
        <span>{highlightSignificantNodes ? 'Major Nodes Highlighted' : 'Highlight Major Nodes'}</span>
      </button>
    </div>
  );
}
