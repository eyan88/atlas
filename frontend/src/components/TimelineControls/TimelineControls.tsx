import { useEffect, useState } from 'react';
import { useAppStore, getEasternDateStr } from '../../store/useAppStore';
import styles from './TimelineControls.module.css';

const SPEEDS = [1, 5, 10, 60] as const;

// Returns the current US Eastern Time formatted as HH:MM AM/PM
function getLiveEtTime() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

export function TimelineControls() {
  const isPlaying          = useAppStore((s) => s.isPlaying);
  const replaySpeed        = useAppStore((s) => s.replaySpeed);
  const timestamp          = useAppStore((s) => s.currentTimestamp);
  const togglePlay         = useAppStore((s) => s.togglePlay);
  const setSpeed           = useAppStore((s) => s.setReplaySpeed);
  const setTimestamp       = useAppStore((s) => s.setTimestamp);
  const timelineTimestamps = useAppStore((s) => s.timelineTimestamps);

  // Live ET clock — ticks every second, completely independent of the scrubber
  const [liveEtTime, setLiveEtTime] = useState(getLiveEtTime);
  useEffect(() => {
    const clock = setInterval(() => setLiveEtTime(getLiveEtTime()), 1000);
    return () => clearInterval(clock);
  }, []);

  // Replay timer loop
  useEffect(() => {
    if (!isPlaying || timelineTimestamps.length === 0) return;

    const intervalMs = 1000 / replaySpeed;
    const timer = setInterval(() => {
      const storeState = useAppStore.getState();
      if (!storeState.isPlaying) return;
      const currentTs = storeState.currentTimestamp;
      const list = storeState.timelineTimestamps;
      if (list.length === 0) return;

      const currentIdx = currentTs ? list.indexOf(currentTs) : list.length - 1;
      let nextIdx = currentIdx + 1;
      if (nextIdx >= list.length) {
        nextIdx = 0; // Loop back to start of session
      }

      const nextTs = list[nextIdx];
      storeState.setTimestamp(nextTs);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, replaySpeed, timelineTimestamps]);

  // Scrubber position label — shown above the slider, not on the GO LIVE button
  const scrubberTimeLabel = timestamp
    ? new Date(timestamp * 1000).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/New_York',
      })
    : null;

  const currentIdx = timestamp && timelineTimestamps.length > 0
    ? timelineTimestamps.indexOf(timestamp)
    : timelineTimestamps.length - 1;

  const sliderVal = currentIdx !== -1 ? currentIdx : timelineTimestamps.length - 1;

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

      {/* Timeline Slider */}
      <div className={styles.sliderWrapper}>
        <span className={styles.sliderLabel}>9:30 AM</span>
        <div className={styles.sliderTrack}>
          {/* Scrubber position tooltip — shows the replay timestamp, not the live clock */}
          {scrubberTimeLabel && (
            <span className={styles.scrubberTimeLabel}>{scrubberTimeLabel} ET</span>
          )}
          <input
            id="timeline-slider"
            type="range"
            className={styles.slider}
            min={0}
            max={timelineTimestamps.length > 0 ? timelineTimestamps.length - 1 : 100}
            value={sliderVal}
            onChange={(e) => {
              const idx = Number(e.target.value);
              if (timelineTimestamps[idx]) {
                setTimestamp(timelineTimestamps[idx]);
              }
            }}
            disabled={timelineTimestamps.length === 0}
            aria-label="Replay timeline"
          />
        </div>
        <span className={styles.sliderLabel}>4:00 PM</span>
      </div>

      {/* Latest EOD Positioning Button */}
      <button
        id="toggle-live-btn"
        className={`${styles.liveBtn} ${timestamp === null ? styles.liveActive : ''}`}
        onClick={() => {
          const todayStr = getEasternDateStr();
          useAppStore.setState({ selectedDate: todayStr });
          setTimestamp(null);
        }}
        title="Show latest End of Day dealer positioning snapshot"
      >
        <span className={`${styles.timeDot} ${timestamp === null ? styles.liveDot : ''}`} />
        <span className={styles.timeLabel}>
          EOD SNAPSHOT
        </span>
      </button>
    </footer>
  );
}
