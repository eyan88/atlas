import { useRef, useEffect } from 'react';
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

  const formatGamma = (val: number | null | undefined) => {
    if (val == null) return '—';
    const abs = Math.abs(val);
    if (abs >= 1e9) return `${val >= 0 ? '+' : '-'}${(abs / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `${val >= 0 ? '+' : '-'}${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${val >= 0 ? '+' : '-'}${(abs / 1e3).toFixed(0)}K`;
    return `${val >= 0 ? '+' : '-'}${abs.toFixed(0)}`;
  };

  const exportToPng = () => {
    const canvas = document.getElementById(`heatmap-canvas-${ticker}`) as HTMLCanvasElement;
    if (canvas) {
      const link = document.createElement('a');
      const tsStr = snapshot?.timestamp ? new Date(snapshot.timestamp).toISOString().split('T')[0] : 'live';
      link.download = `atlas-${ticker}-${tsStr}-heatmap.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  };

  return (
    <section className={`${styles.container} ${isCompassMode ? styles.compassContainer : ''}`}>
      <div className={styles.titleBar}>
        <div className={isCompassMode ? styles.titleContentCompass : styles.titleContent}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
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
          <div className={styles.levelBar}>
            <div className={`${styles.levelBadge} ${styles.badgeSpot}`} title="Current spot price (White row outline)">
              <span className={styles.levelLabel}>SPOT</span>
              <span className={styles.levelValue}>{snapshot?.spot_price?.toFixed(2) ?? '—'}</span>
            </div>
            <div className={`${styles.levelBadge} ${styles.badgeNet}`} title="Total Net Gamma">
              <span className={styles.levelLabel}>NET Γ</span>
              <span className={styles.levelValue} style={{ color: snapshot?.net_gamma && snapshot.net_gamma >= 0 ? '#34d399' : '#f87171' }}>
                {formatGamma(snapshot?.net_gamma)}
              </span>
            </div>
            <div className={`${styles.levelBadge} ${styles.badgeFlip}`} title="Gamma flip level (Amber/Gold row outline)">
              <span className={styles.levelLabel}>FLIP</span>
              <span className={styles.levelValue}>{snapshot?.gamma_flip?.toFixed(0) ?? '—'}</span>
            </div>
            <div className={`${styles.levelBadge} ${styles.badgeCall}`} title="Call wall (Mint Green row outline)">
              <span className={styles.levelLabel}>CALL</span>
              <span className={styles.levelValue}>{snapshot?.call_wall?.toFixed(0) ?? '—'}</span>
            </div>
            <div className={`${styles.levelBadge} ${styles.badgePut}`} title="Coral Red row outline">
              <span className={styles.levelLabel}>PUT</span>
              <span className={styles.levelValue}>{snapshot?.put_wall?.toFixed(0) ?? '—'}</span>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            type="button"
            className={styles.actionBtn}
            onClick={exportToPng}
            aria-label={`Export ${ticker} heatmap to PNG`}
            title="Export PNG"
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          {!isCompassMode && (
            <button
              type="button"
              className={styles.closeBtn}
              onClick={() => closeTickerPane(ticker)}
              aria-label={`Close ${ticker} heatmap`}
              title={`Close ${ticker}`}
            >
              ×
            </button>
          )}
        </div>
      </div>
      <div 
        ref={viewportRef}
        className={`${styles.viewport} ${isCompassMode ? `compass-viewport ${styles.compassViewport}` : ''}`}
      >
        <CanvasHeatmap ticker={ticker} isCompassMode={isCompassMode} />
      </div>
    </section>
  );
}
