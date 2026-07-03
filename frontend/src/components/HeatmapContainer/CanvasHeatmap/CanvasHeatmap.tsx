import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { HeatmapSnapshot } from '../../../types';
import styles from './CanvasHeatmap.module.css';

// ─── Color helpers ────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

// Positive exposure (dealers long gamma — stabilizer/magnet)
// Deep teal → green → lime → warm gold
const POSITIVE_STOPS: Array<[number, Rgb]> = [
  [0.0,  [16, 30, 42]],      // near-black teal (blends into bg)
  [0.15, [20, 65, 60]],      // dark teal
  [0.30, [28, 110, 72]],     // forest green
  [0.50, [51, 170, 80]],     // green
  [0.65, [92, 210, 90]],     // lime-green
  [0.80, [168, 230, 68]],    // lime
  [0.92, [220, 210, 45]],    // warm gold
  [1.0,  [245, 225, 80]],    // bright warm gold
];

// Negative exposure (dealers short gamma — volatility amplifier)
// Deep indigo → blue-violet → violet → magenta-pink
const NEGATIVE_STOPS: Array<[number, Rgb]> = [
  [0.0,  [18, 14, 40]],      // near-black indigo (blends into bg)
  [0.15, [30, 22, 80]],      // dark indigo
  [0.30, [50, 30, 130]],     // indigo
  [0.50, [80, 40, 170]],     // violet
  [0.65, [120, 45, 195]],    // blue-violet
  [0.80, [160, 55, 200]],    // bright violet
  [0.92, [195, 65, 185]],    // magenta-violet
  [1.0,  [225, 85, 175]],    // hot magenta-pink
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

function rampLookup(stops: Array<[number, Rgb]>, magnitude: number): Rgb {
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [s0, c0] = stops[i];
    const [s1, c1] = stops[i + 1];
    if (magnitude <= s1) {
      const t = (magnitude - s0) / (s1 - s0 || 1);
      return mixColor(c0, c1, Math.max(0, Math.min(1, t)));
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Maps a signed normalized value in [-1, 1] to a diverging RGBA color.
 *
 * Positive (long gamma)  → teal/green/gold ramp  — stabilizer/magnet zones
 * Negative (short gamma) → indigo/violet/magenta ramp — amplifier zones
 *
 * Magnitude drives intensity; sign drives hue.
 */
function valueToColor(normalized: number): [number, number, number, number] {
  const magnitude = Math.max(0, Math.min(1, Math.abs(normalized)));
  const alpha = 0.22 + magnitude * 0.66; // 0.22..0.88

  const stops = normalized >= 0 ? POSITIVE_STOPS : NEGATIVE_STOPS;
  const [r, g, b] = rampLookup(stops, magnitude);
  return [r, g, b, alpha];
}

function textColorForCell(r: number, g: number, b: number): string {
  const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  return luminance > 140 ? 'rgba(8,10,14,0.92)' : 'rgba(240,245,255,0.88)';
}

/**
 * Returns the percentage-change label color (green/red) with enough contrast
 * against the given cell background.
 */
function pctColorForCell(r: number, g: number, b: number, isPositive: boolean): string {
  const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  if (isPositive) {
    return luminance > 140 ? 'rgba(16, 110, 55, 0.95)' : 'rgba(74, 222, 128, 0.95)';
  } else {
    return luminance > 140 ? 'rgba(170, 30, 30, 0.95)' : 'rgba(248, 113, 113, 0.95)';
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
          
          // Map absolute exposure to color (warm gold for positive, violet for negative)
          const [r_, g_, b_, a] = valueToColor(normVal);

          // Cell background (colored by absolute dealer exposure value)
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

          // Adaptive text color based on cell background luminance
          ctx.fillStyle = textColorForCell(r_, g_, b_);
          ctx.font = "bold 10px 'JetBrains Mono', monospace";
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, x + CELL_W / 2, y + 6);

          // Line 2: Percentage Change (Evolution)
          const pct = pctChanges[r][c];
          const isPos = pct >= 0;
          const pctLabel = `${isPos ? '▲ +' : '▼ '}${pct.toFixed(0)}%`;
          ctx.fillStyle = pctColorForCell(r_, g_, b_, isPos);
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
