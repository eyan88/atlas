import { useEffect } from 'react';
import { useAppStore } from '../../store/useAppStore';
import styles from './TimelineControls.module.css';

const SPEEDS = [1, 5, 10, 60] as const;

export function TimelineControls() {
  const isPlaying   = useAppStore((s) => s.isPlaying);
  const replaySpeed = useAppStore((s) => s.replaySpeed);
  const timestamp   = useAppStore((s) => s.currentTimestamp);
  const togglePlay  = useAppStore((s) => s.togglePlay);
  const setSpeed    = useAppStore((s) => s.setReplaySpeed);
  const setTimestamp = useAppStore((s) => s.setTimestamp);
  const timelineTimestamps = useAppStore((s) => s.timelineTimestamps);

  // Replay timer loop effect
  useEffect(() => {
    if (!isPlaying || timelineTimestamps.length === 0) return;

    const intervalMs = 1000 / replaySpeed;
    const timer = setInterval(() => {
      useAppStore.setState((state) => {
        if (!state.isPlaying) return {};
        const currentTs = state.currentTimestamp;
        const list = state.timelineTimestamps;
        if (list.length === 0) return {};

        const currentIdx = currentTs ? list.indexOf(currentTs) : list.length - 1;
        let nextIdx = currentIdx + 1;
        if (nextIdx >= list.length) {
          nextIdx = 0; // Loop back to the start of the day
        }

        const nextTs = list[nextIdx];

        // Coordinate updates across all open panes
        const nextHeatmaps = { ...state.heatmapsByTicker };
        state.openTickers.forEach((t) => {
          const tHistory = state.snapshotsHistory[t];
          if (tHistory && tHistory[nextTs]) {
            nextHeatmaps[t] = tHistory[nextTs];
          }
        });

        const activeHist = state.snapshotsHistory[state.activeTicker];
        const nextHeatmap = activeHist && activeHist[nextTs] ? activeHist[nextTs] : state.heatmap;

        return {
          currentTimestamp: nextTs,
          heatmap: nextHeatmap,
          heatmapsByTicker: nextHeatmaps,
          spotPrice: nextHeatmap ? nextHeatmap.spot_price : state.spotPrice,
          gammaFlip: nextHeatmap ? nextHeatmap.gamma_flip : state.gammaFlip,
          callWall: nextHeatmap ? nextHeatmap.call_wall : state.callWall,
          putWall: nextHeatmap ? nextHeatmap.put_wall : state.putWall,
        };
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, replaySpeed, timelineTimestamps]);

  const timeLabel = timestamp
    ? new Date(timestamp * 1000).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Chicago',
      })
    : 'LIVE';

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

      {/* Live Toggle Button */}
      <button
        id="toggle-live-btn"
        className={`${styles.liveBtn} ${timestamp === null ? styles.liveActive : ''}`}
        onClick={() => {
          const todayStr = new Date().toISOString().split('T')[0];
          useAppStore.setState({ selectedDate: todayStr });
          setTimestamp(null);
        }}
        title={timestamp === null ? 'Active WebSocket streaming live feed' : 'Switch to real-time live trading session'}
      >
        <span className={`${styles.timeDot} ${timestamp === null ? styles.liveDot : ''}`} />
        <span className={styles.timeLabel}>
          {timestamp === null ? 'LIVE FEED' : `GO LIVE (${timeLabel})`}
        </span>
      </button>
    </footer>
  );
}
