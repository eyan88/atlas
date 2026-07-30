import { useAppStore } from '../../../store/useAppStore';
import { EVOLUTION_WINDOW_LABELS } from '../../../types';
import type { EvolutionWindow } from '../../../types';
import styles from './EvolutionControls.module.css';

const WINDOWS: EvolutionWindow[] = ['1m', '15m', '1h', 'open', 'prev_day'];

export function EvolutionControls() {
  const evolutionWindow = useAppStore((s) => s.evolutionWindow);
  const setWindow       = useAppStore((s) => s.setEvolutionWindow);

  return (
    <div className={styles.controls} role="toolbar" aria-label="Evolution window selector">
      <span className={styles.label}>Evolution:</span>
      <div className={styles.btnGroup}>
        {WINDOWS.map((w) => (
          <button
            key={w}
            id={`evolution-btn-${w}`}
            className={`${styles.btn} ${evolutionWindow === w ? styles.btnActive : ''}`}
            onClick={() => setWindow(w)}
            aria-pressed={evolutionWindow === w}
            title={EVOLUTION_WINDOW_LABELS[w]}
          >
            {EVOLUTION_WINDOW_LABELS[w]}
          </button>
        ))}
      </div>
    </div>
  );
}
