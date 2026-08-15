import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import type { HeatmapSnapshot } from '../../../types';
import styles from './CanvasHeatmap.module.css';

// ─── Color helpers ────────────────────────────────────────────────────────────

type Rgb = [number, number, number];

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

// ─── Per-column contrast color system ────────────────────────────────────────
//
// The color intent:
//   • The dominant positive gamma node in each expiry column → neon yellow
//   • Other positive cells → green shades proportional to their magnitude relative to the column peak
//   • Non-significant cells (near zero) → muted dark purple
//   • The dominant negative gamma node → deep vivid purple
//   • Other negative cells → purple shades proportional to their magnitude relative to the column trough
//
// This makes the "walls" and significant nodes pop while everything else recedes.

// Positive ramp: muted teal/green (low significance) → emerald → lime → neon yellow (dominant)
const POS_RAMP: Array<[number, Rgb]> = [
  [0.0,  [30, 58, 74]],       // Dark muted teal (near-zero positive → blends into background)
  [0.15, [20, 100, 90]],      // Deep teal-green
  [0.35, [16, 145, 100]],     // Medium emerald
  [0.55, [34, 180, 85]],      // Vivid green
  [0.75, [120, 210, 40]],     // Lime green
  [0.90, [200, 235, 30]],     // Yellow-lime
  [1.0,  [250, 245, 50]],     // Neon yellow (dominant positive node)
];

// Negative ramp: muted dark purple (low significance) → medium violet → vivid deep purple (dominant)
const NEG_RAMP: Array<[number, Rgb]> = [
  [0.0,  [35, 25, 60]],       // Very dark muted purple (near-zero negative → blends into background)
  [0.15, [50, 30, 85]],       // Dark plum
  [0.35, [70, 35, 120]],      // Medium-dark purple
  [0.55, [95, 40, 160]],      // Medium violet
  [0.75, [120, 45, 200]],     // Vivid violet
  [0.90, [105, 30, 185]],     // Deep vivid purple
  [1.0,  [88, 28, 155]],      // Rich deep purple (dominant negative node)
];

// Classic Positive Green ramp: dark muted green -> vivid green -> bright call green
const CLASSIC_POS_RAMP: Array<[number, Rgb]> = [
  [0.0,  [16, 32, 22]],
  [0.15, [22, 60, 30]],
  [0.35, [28, 105, 45]],
  [0.55, [34, 150, 60]],
  [0.75, [40, 195, 75]],
  [0.90, [60, 230, 90]],
  [1.0,  [100, 255, 120]],
];

// Classic Negative Red ramp: dark muted red -> vivid red -> bright put red
const CLASSIC_NEG_RAMP: Array<[number, Rgb]> = [
  [0.0,  [32, 16, 16]],
  [0.15, [65, 24, 24]],
  [0.35, [115, 30, 30]],
  [0.55, [165, 36, 36]],
  [0.75, [215, 42, 42]],
  [0.90, [240, 60, 60]],
  [1.0,  [255, 95, 95]],
];

function rampLookup(stops: Array<[number, Rgb]>, t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const [s0, c0] = stops[i];
    const [s1, c1] = stops[i + 1];
    if (clamped <= s1) {
      const frac = (clamped - s0) / (s1 - s0 || 1);
      return mixColor(c0, c1, Math.max(0, Math.min(1, frac)));
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Maps a per-column normalized value to an RGBA color.
 *
 * @param normalized  — value in [-1, 1] where the sign indicates direction
 *                      and the magnitude indicates how dominant this cell is
 *                      relative to the peak/trough in its expiry column.
 * @param colorTheme  — color theme ('atlas' or 'classic')
 */
function valueToColor(normalized: number, colorTheme: 'atlas' | 'classic'): [number, number, number, number] {
  const val = Math.max(-1, Math.min(1, normalized));
  const mag = Math.abs(val);

  // Alpha: near-zero cells are more transparent, dominant cells are opaque
  const alpha = 0.45 + mag * 0.50; // range: 0.45 → 0.95

  let rgb: Rgb;
  const curved = Math.pow(mag, 0.65);
  
  if (colorTheme === 'classic') {
    if (val >= 0) {
      rgb = rampLookup(CLASSIC_POS_RAMP, curved);
    } else {
      rgb = rampLookup(CLASSIC_NEG_RAMP, curved);
    }
  } else {
    if (val >= 0) {
      rgb = rampLookup(POS_RAMP, curved);
    } else {
      rgb = rampLookup(NEG_RAMP, curved);
    }
  }

  return [rgb[0], rgb[1], rgb[2], alpha];
}

function textColorForCell(r: number, g: number, b: number): string {
  const luminance = (0.2126 * r) + (0.7152 * g) + (0.0722 * b);
  return luminance > 140 ? '#0b0c10' : '#f0f1f3';
}

/**
 * Returns a bright percentage-change label color (green/red).
 * Always uses vivid variants since text sits on a dark translucent pill.
 */
function pctColorForCell(isPositive: boolean): string {
  return isPositive ? 'rgba(90, 235, 140, 0.95)' : 'rgba(255, 120, 120, 0.95)';
}

/**
 * Normalizes the data matrix PER COLUMN (per expiry).
 * Each column is independently scaled so that its peak absolute value maps to ±1.
 * This ensures each expiry's dominant node gets the full extreme color
 * regardless of whether another expiry has a larger absolute value.
 */
function normalizeMatrixPerColumn(data: number[][]): number[][] {
  if (data.length === 0) return [];
  const numCols = data[0].length;
  const numRows = data.length;

  // Find max absolute value per column
  const colMax = new Array(numCols).fill(0);
  for (let c = 0; c < numCols; c++) {
    for (let r = 0; r < numRows; r++) {
      const abs = Math.abs(data[r][c]);
      if (abs > colMax[c]) colMax[c] = abs;
    }
  }

  // Normalize each cell by its column's max
  return data.map((row) =>
    row.map((v, c) => (colMax[c] === 0 ? 0 : v / colMax[c]))
  );
}

// ─── Constants ───────────────────────────────────────────────────────────────

// Constants moved to component scope for dynamic sizing based on mode
const AXIS_TOP  = 52;   // px for expiration labels
const FONT      = "12px 'Inter', sans-serif";
const FONT_HDR  = "12px 'Inter', sans-serif";

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
  const colorTheme  = useAppStore((s) => s.colorTheme);
  const highlightSignificantNodes = useAppStore((s) => s.highlightSignificantNodes);

  const CELL_W = 106;
  const CELL_H = 42;
  const axisLeft = 76;

  // Resolve reference snapshot for calculations based on selected evolution window
  const tickerHistory = snapshotsHistory[ticker] ?? {};
  const historyTimestamps = Object.keys(tickerHistory).map(Number).sort((a, b) => a - b);
  const currentTs = heatmap?.timestamp ? Math.floor(new Date(heatmap.timestamp).getTime() / 1000) : null;
  
  let refSnap: HeatmapSnapshot | null = null;
  if (currentTs && historyTimestamps.length > 0) {
    if (evolutionWindow === '1m') {
      const targetTs = currentTs - 60;
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
      const currentDateStr = new Date(currentTs * 1000).toISOString().split('T')[0];
      const sameDayStamps = historyTimestamps.filter(ts => new Date(ts * 1000).toISOString().split('T')[0] === currentDateStr);
      const openTs = sameDayStamps.length > 0 ? sameDayStamps[0] : historyTimestamps[0];
      refSnap = tickerHistory[openTs] ?? null;
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

      // Find the row indices closest to each level
      let closestSpotIdx = -1;
      let closestFlipIdx = -1;
      let closestCallIdx = -1;
      let closestPutIdx = -1;

      let minSpotDist = Infinity;
      let minFlipDist = Infinity;
      let minCallDist = Infinity;
      let minPutDist = Infinity;

      for (let r = 0; r < rows.length; r++) {
        const strike = rows[r];
        if (spotPrice !== null) {
          const dist = Math.abs(strike - spotPrice);
          if (dist < minSpotDist) {
            minSpotDist = dist;
            closestSpotIdx = r;
          }
        }
        if (gammaFlip !== null) {
          const dist = Math.abs(strike - gammaFlip);
          if (dist < minFlipDist) {
            minFlipDist = dist;
            closestFlipIdx = r;
          }
        }
        if (snap.call_wall !== null) {
          const dist = Math.abs(strike - snap.call_wall);
          if (dist < minCallDist) {
            minCallDist = dist;
            closestCallIdx = r;
          }
        }
        if (snap.put_wall !== null) {
          const dist = Math.abs(strike - snap.put_wall);
          if (dist < minPutDist) {
            minPutDist = dist;
            closestPutIdx = r;
          }
        }
      }

      // Normalize absolute exposures for color intensities
      const norm = normalizeMatrixPerColumn(snap.data);

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

      const allAbsVals: number[] = [];

      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < cols.length; c++) {
          const absVal = Math.abs(snap.data[r][c]);
          if (absVal > 0) allAbsVals.push(absVal);
          if (absVal > maxAbsValue) {
            maxAbsValue = absVal;
            maxAbsRowIdx = r;
            maxAbsColIdx = c;
          }
        }
      }

      allAbsVals.sort((a, b) => a - b);
      let sigThreshold = 0;
      if (allAbsVals.length > 0) {
        // Top 15% magnitude (85th percentile)
        const p85Idx = Math.floor(allAbsVals.length * 0.85);
        sigThreshold = allAbsVals[p85Idx];
      }

      const checkIsCellSignificant = (r: number, c: number): boolean => {
        const isCellCallWall = colCallWallRows[c] === r;
        const isCellPutWall = colPutWallRows[c] === r;
        const isAbsMax = r === maxAbsRowIdx && c === maxAbsColIdx;
        const val = Math.abs(snap.data[r][c]);
        return isCellCallWall || isCellPutWall || isAbsMax || (sigThreshold > 0 && val >= sigThreshold);
      };

      // Calculate percentage changes for display labels
      const pctChanges = rows.map((_strike, r) => {
        return cols.map((_exp, c) => {
          const curVal = snap.data[r][c];
          let refVal = curVal;
          if (refSnap && refSnap.data && refSnap.data[r] && refSnap.data[r][c] !== undefined) {
            refVal = refSnap.data[r][c];
          }
          
          if (refVal === 0 || refVal === curVal) return 0;
          return ((curVal - refVal) / Math.abs(refVal)) * 100;
        });
      });

      const W = axisLeft + cols.length * CELL_W + 4;
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
        const x = axisLeft + c * CELL_W + CELL_W / 2;
        const label = cols[c].slice(5); // "MM-DD"
        ctx.fillText(label, x, AXIS_TOP / 2);
      }

      // ── Cells ─────────────────────────────────────────────────────────────
      for (let r = 0; r < rows.length; r++) {
        const y    = AXIS_TOP + r * CELL_H;
        const strike = rows[r];
        const isSpot = r === closestSpotIdx;
        const isFlip = r === closestFlipIdx;
        const isCall = r === closestCallIdx;
        const isPut = r === closestPutIdx;

        for (let c = 0; c < cols.length; c++) {
          const x = axisLeft + c * CELL_W;
          const normVal = norm[r][c];
          const raw = snap.data[r][c];
          
          // Map absolute exposure to color (warm gold for positive, violet for negative)
          const [r_, g_, b_, a] = valueToColor(normVal, colorTheme);

          const isCellCallWall = colCallWallRows[c] === r;
          const isCellPutWall = colPutWallRows[c] === r;
          const isSignificant = checkIsCellSignificant(r, c);

          if (highlightSignificantNodes && !isSignificant) {
            // Dim non-significant cells
            ctx.fillStyle = `rgba(${r_},${g_},${b_},${a * 0.08})`;
            ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);

            ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);
          } else {
            // Significant cell OR normal view mode
            ctx.fillStyle = `rgba(${r_},${g_},${b_},${highlightSignificantNodes ? Math.max(a, 0.65) : a})`;
            ctx.fillRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);

            if (highlightSignificantNodes && isSignificant) {
              // Highlight significant node with glowing border and badge
              ctx.strokeStyle = raw >= 0 ? '#38bdf8' : '#f43f5e';
              ctx.lineWidth = 2.5;
              ctx.strokeRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2);

              // Draw badge icon
              ctx.fillStyle = raw >= 0 ? '#38bdf8' : '#f43f5e';
              ctx.font = '10px sans-serif';
              ctx.textAlign = 'left';
              ctx.textBaseline = 'top';
              ctx.fillText('⚡', x + 3, y + 3);
            } else {
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
            }
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
          const absV = Math.abs(raw);
          let label = '';
          if      (absV >= 1e9) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e9).toFixed(1)}B`;
          else if (absV >= 1e6) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e6).toFixed(1)}M`;
          else if (absV >= 1e3) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e3).toFixed(0)}K`;
          else                  label = `${raw >= 0 ? '+' : '-'}${absV.toFixed(1)}`;

          const isDimmedText = highlightSignificantNodes && !isSignificant;

          // Fill main text
          
          // Top and bottom
          ctx.fillStyle = isDimmedText ? 'rgba(148, 163, 184, 0.25)' : textColorForCell(r_, g_, b_);
          ctx.font = "11px 'Inter', sans-serif";
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(label, x + CELL_W / 2, y + 8);

          const pct = pctChanges[r][c];
          const isPos = pct >= 0;
          const pctLabel = `${isPos ? '▲ +' : '▼ '}${pct.toFixed(0)}%`;
          ctx.font = "9px 'Inter', sans-serif";
          
          const pctTextW = ctx.measureText(pctLabel).width;
          const pillW = pctTextW + 8;
          const pillH = 13;
          const pillX = x + CELL_W / 2 - pillW / 2;
          const pillY = y + 23;
          
          ctx.beginPath();
          ctx.roundRect(pillX, pillY, pillW, pillH, 4);
          ctx.fillStyle = isDimmedText ? 'rgba(0, 0, 0, 0.15)' : 'rgba(0, 0, 0, 0.38)';
          ctx.fill();

          ctx.fillStyle = isDimmedText ? 'rgba(148, 163, 184, 0.25)' : pctColorForCell(isPos);
          ctx.textAlign = 'center';
          ctx.fillText(pctLabel, x + CELL_W / 2, y + 25);
        }


        // Strike label (drawn after cell backgrounds)
        const rowHasSig = cols.some((_, c) => checkIsCellSignificant(r, c));

        if (isSpot) {
          ctx.fillStyle = '#f9fafb'; // White
        } else if (isFlip) {
          ctx.fillStyle = '#fbbf24'; // Amber/Gold
        } else if (isCall) {
          ctx.fillStyle = '#34d399'; // Mint Green
        } else if (isPut) {
          ctx.fillStyle = '#f87171'; // Coral Red
        } else {
          ctx.fillStyle = highlightSignificantNodes && !rowHasSig ? 'rgba(107, 114, 128, 0.25)' : '#6b7280'; // Dim or Gray
        }
        ctx.font = FONT;
        ctx.textBaseline = 'middle';
        const strikeLabel = Number.isInteger(strike) ? strike.toFixed(0) : strike.toFixed(2).replace(/\.?0+$/, '');
        ctx.textAlign = 'right';
        ctx.fillText(strikeLabel, axisLeft - 6, y + CELL_H / 2);
      }
    },
    [evolutionWindow, refSnap, colorTheme, highlightSignificantNodes, CELL_W, CELL_H],
  );


  // Re-draw whenever heatmap or levels change
  useEffect(() => {
    if (!heatmap || !canvasRef.current) return;
    draw(heatmap, canvasRef.current);
  }, [heatmap, refSnap, draw]);

  // ─── Interaction ─────────────────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!heatmap) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;

      const cIdx = Math.floor((mx - axisLeft) / CELL_W);
      const rIdx = Math.floor((my - AXIS_TOP)  / CELL_H);

      if (
        cIdx >= 0 &&
        cIdx < heatmap.columns.length &&
        rIdx >= 0 &&
        rIdx < heatmap.rows.length
      ) {
        const value = heatmap.data[rIdx][cIdx];
        
        // Find reference value for absolute/percent change
        let refValue = null;
        if (refSnap && refSnap.data[rIdx] && refSnap.data[rIdx][cIdx] !== undefined) {
          refValue = refSnap.data[rIdx][cIdx];
        }

        const pctChange = (refValue !== null && refValue !== 0) ? ((value - refValue) / Math.abs(refValue)) * 100 : 0;

        setHovered({
          ticker,
          metric: useAppStore.getState().selectedMetric,
          strike: heatmap.rows[rIdx],
          expiration: heatmap.columns[cIdx],
          value,
          pctChange,
          rowIdx: rIdx,
          colIdx: cIdx,
          mouseX: e.pageX,
          mouseY: e.pageY,
        });
      } else {
        setHovered(null);
      }
    },
    [heatmap, refSnap, ticker, setHovered, CELL_W, CELL_H],
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
        id={`heatmap-canvas-${ticker}`}
        className={styles.canvas}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      />
    </div>
  );
}
