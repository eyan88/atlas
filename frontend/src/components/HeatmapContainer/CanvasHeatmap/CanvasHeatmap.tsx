import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { HeatmapSnapshot } from '../../../types';
import styles from './CanvasHeatmap.module.css';

// ─── Color helpers ────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

const IRONBOW_STOPS: Array<[number, Rgb]> = [
  [0.0, [38, 23, 157]],
  [0.14, [42, 38, 176]],
  [0.28, [47, 72, 196]],
  [0.42, [44, 126, 208]],
  [0.55, [51, 204, 184]],
  [0.68, [92, 224, 170]],
  [0.80, [194, 237, 90]],
  [0.90, [244, 250, 60]],
  [0.97, [255, 242, 24]],
  [1.0, [255, 255, 180]],
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixColor(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

/**
 * Maps a normalized magnitude in [0, 1] to an ironbow-style RGBA color.
 */
function valueToColor(normalized: number): [number, number, number, number] {
  const magnitude = Math.max(0, Math.min(1, Math.abs(normalized)));
  const alpha = 0.24 + magnitude * 0.62; // softer blend, 0.24..0.86

  for (let i = 0; i < IRONBOW_STOPS.length - 1; i += 1) {
    const [startStop, startColor] = IRONBOW_STOPS[i];
    const [endStop, endColor] = IRONBOW_STOPS[i + 1];
    if (magnitude <= endStop) {
      const t = (magnitude - startStop) / (endStop - startStop || 1);
      const [r, g, b] = mixColor(startColor, endColor, Math.max(0, Math.min(1, t)));
      return [r, g, b, alpha];
    }
  }

  const [r, g, b] = IRONBOW_STOPS[IRONBOW_STOPS.length - 1][1];
  return [r, g, b, alpha];
}

function textColorForCell(r: number, g: number, b: number): string {
  const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  return luminance > 150 ? 'rgba(8,10,14,0.9)' : 'rgba(255,255,255,0.86)';
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

const CELL_W    = 80;   // px
const CELL_H    = 28;   // px
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

  // ─── Draw ──────────────────────────────────────────────────────────────────

  const draw = useCallback(
    (snap: HeatmapSnapshot, canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rows = snap.rows;
      const cols = snap.columns;
      const norm = normalizeMatrix(snap.data);
      const spotPrice = snap.spot_price;
      const gammaFlip = snap.gamma_flip;

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
          const [r_, g_, b_, a] = valueToColor(norm[r][c]);

          // Cell background
          ctx.fillStyle = `rgba(${r_},${g_},${b_},${a})`;
          ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);

          // Spot price row highlight
          if (isSpot) {
            ctx.strokeStyle = 'rgba(249,250,251,0.4)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
          }

          // Gamma flip row highlight
          if (isFlip) {
            ctx.strokeStyle = 'rgba(251,191,36,0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
          }

          // Value text
          const raw = snap.data[r][c];
          const absV = Math.abs(raw);
          let label = '';
          if      (absV >= 1e9) label = `${(raw / 1e9).toFixed(1)}B`;
          else if (absV >= 1e6) label = `${(raw / 1e6).toFixed(1)}M`;
          else if (absV >= 1e3) label = `${(raw / 1e3).toFixed(0)}K`;
          else                  label = raw.toFixed(1);

          ctx.fillStyle = textColorForCell(r_, g_, b_);
          ctx.font = FONT;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, x + CELL_W / 2, y + CELL_H / 2);
        }
      }
    },
    [],
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
        setHovered({
          ticker,
          strike:     heatmap.rows[rowIdx],
          expiration: heatmap.columns[colIdx],
          value:      heatmap.data[rowIdx][colIdx],
          metric:     useAppStore.getState().selectedMetric,
          rowIdx,
          colIdx,
        });
      } else {
        setHovered(null);
      }
    },
    [heatmap, setHovered, ticker],
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
