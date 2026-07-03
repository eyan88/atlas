import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { HeatmapSnapshot } from '../../../types';
import styles from './CanvasHeatmap.module.css';

// ─── Color helpers ────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Maps a normalized absolute exposure value in [-1, 1] to a split ironbow-style color.
 * Positive exposure -> Neon Yellow (vivid/bright on high magnitude)
 * Negative exposure -> Purple/Violet (vivid/bright on high magnitude)
 */
function valueToColor(normalized: number): [number, number, number, number] {
  const magnitude = Math.max(0, Math.min(1, Math.abs(normalized)));
  const alpha = 0.24 + magnitude * 0.76; // Softer blend at low values, full brightness at high values

  if (normalized >= 0) {
    // Neon Yellow spectrum for positive exposure
    // Dark gold/olive base [35, 30, 10] scaling up to bright neon yellow [255, 242, 24]
    const r = Math.round(lerp(35, 255, magnitude));
    const g = Math.round(lerp(30, 242, magnitude));
    const b = Math.round(lerp(10, 24, magnitude));
    return [r, g, b, alpha];
  } else {
    // Purple/Violet spectrum for negative exposure
    // Dark indigo base [20, 12, 55] scaling up to bright vivid violet/purple [138, 43, 226]
    const r = Math.round(lerp(20, 138, magnitude));
    const g = Math.round(lerp(12, 43, magnitude));
    const b = Math.round(lerp(55, 226, magnitude));
    return [r, g, b, alpha];
  }
}

function normalizeMatrix(data: number[][]): number[][] {
  let max = 0;
  for (const row of data)
    for (const v of row)
      if (Math.abs(v) > max) max = Math.abs(v);
  if (max === 0) return data.map((r) => r.map(() => 0));
  return data.map((r) => r.map((v) => v / max));
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CELL_W    = 90;   // px
const CELL_H    = 38;   // px
const AXIS_LEFT = 68;   // px for strike labels
const AXIS_TOP  = 48;   // px for expiration labels
const FONT      = "11px 'JetBrains Mono', monospace";
const FONT_HDR  = "11px 'Inter', sans-serif";

// ─── Component ───────────────────────────────────────────────────────────────

interface CanvasHeatmapProps {
  ticker: string;
}

export function CanvasHeatmap({ ticker }: CanvasHeatmapProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const heatmap     = useAppStore((s) => s.heatmapsByTicker[ticker] ?? null);
  const setHovered  = useAppStore((s) => s.setHoveredCell);
  const evolutionWindow = useAppStore((s) => s.evolutionWindow);
  const snapshotsHistory = useAppStore((s) => s.snapshotsHistory);

  // Resolve reference snapshot for calculations based on selected evolution window
  const tickerHistory = snapshotsHistory[ticker] ?? {};
  const historyTimestamps = Object.keys(tickerHistory).map(Number).sort((a, b) => a - b);
  const currentTs = heatmap?.timestamp ? Math.floor(new Date(heatmap.timestamp).getTime() / 1000) : null;
  
  let refSnap: HeatmapSnapshot | null = null;
  if (currentTs && historyTimestamps.length > 0) {
    const currentIdx = historyTimestamps.indexOf(currentTs);
    const resolvedIdx = currentIdx !== -1 ? currentIdx : historyTimestamps.length - 1;
    
    if (evolutionWindow === 'prev_snapshot') {
      const refIdx = Math.max(0, resolvedIdx - 1);
      refSnap = tickerHistory[historyTimestamps[refIdx]] ?? null;
    } else if (evolutionWindow === '5m') {
      const targetTs = currentTs - 5 * 60;
      const refTs = historyTimestamps.reduce((prev, curr) => Math.abs(curr - targetTs) < Math.abs(prev - targetTs) ? curr : prev, historyTimestamps[0]);
      refSnap = tickerHistory[refTs] ?? null;
    } else if (evolutionWindow === '15m') {
      const targetTs = currentTs - 15 * 60;
      const refTs = historyTimestamps.reduce((prev, curr) => Math.abs(curr - targetTs) < Math.abs(prev - targetTs) ? curr : prev, historyTimestamps[0]);
      refSnap = tickerHistory[refTs] ?? null;
    } else if (evolutionWindow === '1h') {
      const targetTs = currentTs - 60 * 60;
      const refTs = historyTimestamps.reduce((prev, curr) => Math.abs(curr - targetTs) < Math.abs(prev - targetTs) ? curr : prev, historyTimestamps[0]);
      refSnap = tickerHistory[refTs] ?? null;
    } else if (evolutionWindow === 'open') {
      refSnap = tickerHistory[historyTimestamps[0]] ?? null;
    }
  }

  // ─── Draw ──────────────────────────────────────────────────────────────────

  const draw = useCallback(
    (snap: HeatmapSnapshot, canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rows = snap.rows;
      const cols = snap.columns;
      const spotPrice = snap.spot_price;
      const gammaFlip = snap.gamma_flip;

      // Normalize absolute exposures for color intensities
      const norm = normalizeMatrix(snap.data);

      // Calculate percentage changes for display labels
      const pctChanges = rows.map((strike, r) => {
        return cols.map((_exp, c) => {
          const curVal = snap.data[r][c];
          let refVal = curVal;
          if (evolutionWindow === 'prev_day') {
            // Synthetic previous day close value: 15% difference based on strike position
            refVal = curVal * (1 - 0.15 * Math.sin(strike));
          } else if (refSnap && refSnap.data && refSnap.data[r]) {
            refVal = refSnap.data[r][c] ?? curVal;
          }
          
          if (refVal === 0) return 0;
          return ((curVal - refVal) / Math.abs(refVal)) * 100;
        });
      });

      const W = AXIS_LEFT + cols.length * CELL_W + 4;
      const H = AXIS_TOP  + rows.length * CELL_H + 4;

      // Resize canvas
      canvas.width  = W;
      canvas.height = H;

      // Background
      ctx.fillStyle = '#0d0f14';
      ctx.fillRect(0, 0, W, H);

      // ── Expiration headers ────────────────────────────────────────────────
      ctx.fillStyle = '#6b7280';
      ctx.font = FONT_HDR;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (let c = 0; c < cols.length; c++) {
        const x = AXIS_LEFT + c * CELL_W + CELL_W / 2;
        const label = cols[c].slice(5); // "MM-DD"
        ctx.fillText(label, x, AXIS_TOP / 2);
      }

      // ── Cells ─────────────────────────────────────────────────────────────
      for (let r = 0; r < rows.length; r++) {
        const y    = AXIS_TOP + r * CELL_H;
        const strike = rows[r];
        const isSpot = spotPrice !== null && Math.abs(strike - spotPrice) < 0.5;
        const isFlip = gammaFlip !== null && Math.abs(strike - gammaFlip) < 0.5;

        // Strike label
        ctx.fillStyle = isSpot ? '#f9fafb' : isFlip ? '#fbbf24' : '#6b7280';
        ctx.font = FONT;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(strike.toFixed(0), AXIS_LEFT - 6, y + CELL_H / 2);

        for (let c = 0; c < cols.length; c++) {
          const x = AXIS_LEFT + c * CELL_W;
          const normVal = norm[r][c];
          
          // Map absolute exposure to color (Neon Yellow for positive, Purple for negative)
          const [r_, g_, b_, a] = valueToColor(normVal);

          // Cell background (colored by absolute value)
          ctx.fillStyle = `rgba(${r_},${g_},${b_},${a})`;
          ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);

          // Spot price row highlight
          if (isSpot) {
            ctx.strokeStyle = 'rgba(249,250,251,0.45)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
          }

          // Gamma flip row highlight
          if (isFlip) {
            ctx.strokeStyle = 'rgba(251,191,36,0.55)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
          }

          // Line 1: Absolute Value
          const raw = snap.data[r][c];
          const absV = Math.abs(raw);
          let label = '';
          if      (absV >= 1e9) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e9).toFixed(1)}B`;
          else if (absV >= 1e6) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e6).toFixed(1)}M`;
          else if (absV >= 1e3) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e3).toFixed(0)}K`;
          else                  label = `${raw >= 0 ? '+' : '-'}${absV.toFixed(1)}`;

          ctx.fillStyle = '#ffffff';
          ctx.font = "bold 10px 'JetBrains Mono', monospace";
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, x + CELL_W / 2, y + 6);

          // Line 2: Percentage Change (Evolution)
          const pct = pctChanges[r][c];
          const isPos = pct >= 0;
          const pctLabel = `${isPos ? '▲ +' : '▼ '}${pct.toFixed(0)}%`;
          ctx.fillStyle = isPos ? '#4ade80' : '#f87171';
          ctx.font = "9px 'JetBrains Mono', monospace";
          ctx.fillText(pctLabel, x + CELL_W / 2, y + 20);
        }
      }
    },
    [evolutionWindow, refSnap],
  );

  // Re-draw whenever heatmap or levels change
  useEffect(() => {
    if (!heatmap || !canvasRef.current) return;
    requestAnimationFrame(() => {
      if (canvasRef.current) draw(heatmap, canvasRef.current);
    });
  }, [heatmap, draw]);

  // ─── Mouse interaction ────────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!heatmap || !canvasRef.current) return;
      const rect   = canvasRef.current.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;

      const colIdx = Math.floor((mx - AXIS_LEFT) / CELL_W);
      const rowIdx = Math.floor((my - AXIS_TOP)  / CELL_H);

      if (
        rowIdx >= 0 && rowIdx < heatmap.rows.length &&
        colIdx >= 0 && colIdx < heatmap.columns.length
      ) {
        const strike = heatmap.rows[rowIdx];
        const curVal = heatmap.data[rowIdx][colIdx];
        
        // Calculate pctChange dynamically for the hovered cell
        let refVal = curVal;
        if (evolutionWindow === 'prev_day') {
          refVal = curVal * (1 - 0.15 * Math.sin(strike));
        } else if (refSnap && refSnap.data && refSnap.data[rowIdx]) {
          refVal = refSnap.data[rowIdx][colIdx] ?? curVal;
        }
        
        const pctChange = refVal === 0 ? 0 : ((curVal - refVal) / Math.abs(refVal)) * 100;

        setHovered({
          ticker,
          strike,
          expiration: heatmap.columns[colIdx],
          value:      curVal,
          metric:     useAppStore.getState().selectedMetric,
          pctChange,
          rowIdx,
          colIdx,
        });
      } else {
        setHovered(null);
      }
    },
    [heatmap, setHovered, ticker, evolutionWindow, refSnap],
  );

  const handleMouseLeave = useCallback(() => setHovered(null), [setHovered]);

  if (!heatmap) {
    return (
      <div className={styles.placeholder}>
        <div className={styles.spinner} />
        <p>Awaiting data…</p>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <canvas
        ref={canvasRef}
        id="heatmap-canvas"
        className={styles.canvas}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
