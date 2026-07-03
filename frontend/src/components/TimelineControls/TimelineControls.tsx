import { useAppStore } from '../../store/useAppStore';
import styles from './TimelineControls.module.css';

const SPEEDS = [1, 5, 10, 60] as const;

export function TimelineControls() {
  const isPlaying   = useAppStore((s) => s.isPlaying);
  const replaySpeed = useAppStore((s) => s.replaySpeed);
  const timestamp   = useAppStore((s) => s.currentTimestamp);
  const togglePlay  = useAppStore((s) => s.togglePlay);
  const setSpeed    = useAppStore((s) => s.setReplaySpeed);

  const timeLabel = timestamp
    ? new Date(timestamp * 1000).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Chicago',
      })
    : 'LIVE';

  return (
    <footer className={styles.footer}>
      {/* Play / Pause */}
      <div className={styles.playControls}>
        <button
          id="timeline-play-btn"
          className={`${styles.playBtn} ${isPlaying ? styles.playing : ''}`}
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause replay' : 'Play replay'}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        {/* Speed selector */}
        <div className={styles.speedGroup}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              id={`speed-btn-${s}x`}
              className={`${styles.speedBtn} ${replaySpeed === s ? styles.speedActive : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* Timeline Slider — placeholder, wired to replay timestamps when backend is live */}
      <div className={styles.sliderWrapper}>
        <input
          id="timeline-slider"
          type="range"
          className={styles.slider}
          min={0}
          max={390}  // max 390 min in a trading day
          defaultValue={390}
          step={1}
          aria-label="Replay timeline"
        />
      </div>

      {/* Current Time Badge */}
      <div className={styles.timeBadge}>
        <span className={`${styles.timeDot} ${timestamp === null ? styles.live : ''}`} />
        <span className={styles.timeLabel}>{timeLabel}</span>
      </div>
    </footer>
  );
}
