import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { HeatmapSnapshot } from '../../../types';
import styles from './CanvasHeatmap.module.css';

// ─── Color helpers ────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

// Positive exposure (dealers long gamma — Parula-themed: Blue → Cyan → Green → Yellow)
const POSITIVE_STOPS: Array<[number, Rgb]> = [
  [0.0,  [35, 47, 68]],      // Slate Blue-Grey midpoint (neutral)
  [0.15, [44, 70, 144]],     // Deep Parula Blue
  [0.35, [29, 115, 170]],    // Bright Sky Blue
  [0.55, [18, 155, 160]],    // Vibrant Cyan/Teal
  [0.75, [34, 185, 110]],    // Fresh Green
  [0.90, [150, 210, 60]],    // Lime Green
  [1.0,  [250, 235, 40]],    // Radiant Parula Gold/Yellow
];

// Negative exposure (dealers short gamma — Viridis-themed: Purple → Violet → Orchid → Red)
const NEGATIVE_STOPS: Array<[number, Rgb]> = [
  [0.0,  [35, 47, 68]],      // Slate Blue-Grey midpoint (neutral)
  [0.15, [65, 30, 100]],     // Deep Indigo/Purple
  [0.35, [95, 25, 125]],     // Rich Violet
  [0.55, [130, 20, 130]],    // Radiant Orchid/Magenta
  [0.75, [170, 30, 110]],    // Deep Rose-Pink
  [0.90, [215, 45, 95]],     // Vibrant Coral
  [1.0,  [245, 75, 75]],     // Hot Flame Red
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
  const alpha = 0.35 + magnitude * 0.55; // 0.35..0.90

  const stops = normalized >= 0 ? POSITIVE_STOPS : NEGATIVE_STOPS;
  const [r, g, b] = rampLookup(stops, magnitude);
  return [r, g, b, alpha];
}

function textColorForCell(r: number, g: number, b: number): string {
  const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  return luminance > 130 ? '#0b0c10' : '#f9fafb';
}

/**
 * Returns a bright percentage-change label color (green/red).
 * Always uses vivid variants since text sits on a dark translucent pill.
 */
function pctColorForCell(isPositive: boolean): string {
  return isPositive ? 'rgba(90, 235, 140, 0.95)' : 'rgba(255, 120, 120, 0.95)';
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

const CELL_W    = 106;  // px
const CELL_H    = 42;   // px
const AXIS_LEFT = 76;   // px for strike labels
const AXIS_TOP  = 52;   // px for expiration labels
const FONT      = "bold 12px 'JetBrains Mono', monospace";
const FONT_HDR  = "bold 12px 'Inter', sans-serif";

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

      // Find the expiry-specific Call Wall and Put Wall index for each column (expiration)
      const colCallWallRows = new Array(cols.length).fill(-1);
      const colPutWallRows = new Array(cols.length).fill(-1);

      for (let c = 0; c < cols.length; c++) {
        let maxPositiveVal = -Infinity;
        let maxPosRowIdx = -1;
        let minNegativeVal = Infinity;
        let minNegRowIdx = -1;

        for (let r = 0; r < rows.length; r++) {
          const val = snap.data[r][c];
          if (val > 0 && val > maxPositiveVal) {
            maxPositiveVal = val;
            maxPosRowIdx = r;
          }
          if (val < 0 && val < minNegativeVal) {
            minNegativeVal = val;
            minNegRowIdx = r;
          }
        }
        colCallWallRows[c] = maxPosRowIdx;
        colPutWallRows[c] = minNegRowIdx;
      }

      // Find the cell with the highest absolute exposure value in the entire matrix
      let maxAbsValue = -Infinity;
      let maxAbsRowIdx = -1;
      let maxAbsColIdx = -1;

      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols.length; c++) {
          const absVal = Math.abs(snap.data[r][c]);
          if (absVal > maxAbsValue) {
            maxAbsValue = absVal;
            maxAbsRowIdx = r;
            maxAbsColIdx = c;
          }
        }
      }

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
        const isCall = snap.call_wall !== null && Math.abs(strike - snap.call_wall) < 0.5;
        const isPut = snap.put_wall !== null && Math.abs(strike - snap.put_wall) < 0.5;

        // Strike label
        if (isSpot) {
          ctx.fillStyle = '#f9fafb'; // White
        } else if (isFlip) {
          ctx.fillStyle = '#fbbf24'; // Amber/Gold
        } else if (isCall) {
          ctx.fillStyle = '#34d399'; // Mint Green
        } else if (isPut) {
          ctx.fillStyle = '#f87171'; // Coral Red
        } else {
          ctx.fillStyle = '#6b7280'; // Gray
        }
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

          const isCellCallWall = colCallWallRows[c] === r;
          const isCellPutWall = colPutWallRows[c] === r;

          // Highlight row/cell borders based on priority: Spot > Flip > Expiry Call Wall > Expiry Put Wall
          if (isSpot) {
            ctx.strokeStyle = 'rgba(249,250,251,0.45)'; // White (Spot row)
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
          } else if (isFlip) {
            ctx.strokeStyle = 'rgba(251,191,36,0.55)'; // Amber/Gold (Flip row)
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
          } else if (isCellCallWall) {
            ctx.strokeStyle = '#34d399'; // Mint Green (Call Wall cell)
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1.5, y + 1.5, CELL_W - 3, CELL_H - 3);
          } else if (isCellPutWall) {
            ctx.strokeStyle = '#f87171'; // Coral Red (Put Wall cell)
            ctx.lineWidth = 2;
            ctx.strokeRect(x + 1.5, y + 1.5, CELL_W - 3, CELL_H - 3);
          }

          // If this cell is the absolute maximum exposure node in the entire matrix, draw a gold star waypoint ★
          if (r === maxAbsRowIdx && c === maxAbsColIdx) {
            ctx.fillStyle = '#fbbf24'; // Gold
            ctx.font = '10px Arial';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'top';
            ctx.fillText('★', x + CELL_W - 4, y + 4);
          }

          // Line 1: Absolute Value
          const raw = snap.data[r][c];
          const absV = Math.abs(raw);
          let label = '';
          if      (absV >= 1e9) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e9).toFixed(1)}B`;
          else if (absV >= 1e6) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e6).toFixed(1)}M`;
          else if (absV >= 1e3) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e3).toFixed(0)}K`;
          else                  label = `${raw >= 0 ? '+' : '-'}${absV.toFixed(1)}`;

          // Main text outline for high legibility
          ctx.strokeStyle = '#090d16';
          ctx.lineWidth = 2.5;
          ctx.lineJoin = 'round';
          ctx.font = "bold 11px 'JetBrains Mono', monospace";
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.strokeText(label, x + CELL_W / 2, y + 8);

          // Fill main text
          ctx.fillStyle = textColorForCell(r_, g_, b_);
          ctx.fillText(label, x + CELL_W / 2, y + 8);

          // Line 2: Percentage Change (Evolution)
          const pct = pctChanges[r][c];
          const isPos = pct >= 0;
          const pctLabel = `${isPos ? '▲ +' : '▼ '}${pct.toFixed(0)}%`;
          ctx.font = "9px 'JetBrains Mono', monospace";

          // Translucent pill backdrop for readability
          const pctTextW = ctx.measureText(pctLabel).width;
          const pillW = pctTextW + 8;
          const pillH = 13;
          const pillX = x + CELL_W / 2 - pillW / 2;
          const pillY = y + 23;
          const pillR = 4; // border-radius
          ctx.beginPath();
          ctx.roundRect(pillX, pillY, pillW, pillH, pillR);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
          ctx.fill();

          ctx.fillStyle = pctColorForCell(isPos);
          ctx.textAlign = 'center';
          ctx.fillText(pctLabel, x + CELL_W / 2, y + 25);
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
