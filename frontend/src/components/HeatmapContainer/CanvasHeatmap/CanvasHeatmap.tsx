import { useCallback, useEffect, useRef, useMemo } from 'react';
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

// Positive ramp: muted teal/green (low significance) → vibrant emerald (#199e70) → lime → neon yellow (dominant)
const POS_RAMP: Array<[number, Rgb]> = [
  [0.0,  [25, 55, 65]],       // Dark muted teal
  [0.15, [25, 120, 95]],      // Deep emerald teal
  [0.35, [25, 158, 112]],     // Vibrant emerald green (#199e70 gamma-exposure style)
  [0.55, [45, 190, 100]],     // Bright green
  [0.75, [140, 220, 45]],     // Lime green
  [0.90, [210, 240, 35]],     // Yellow-lime
  [1.0,  [255, 250, 60]],     // Neon yellow (dominant positive node)
];

// Negative ramp: muted dark plum (low significance) → coral red (#e66767) → deep purple/violet (dominant)
const NEG_RAMP: Array<[number, Rgb]> = [
  [0.0,  [45, 25, 35]],       // Dark muted plum
  [0.15, [120, 40, 50]],      // Deep muted red
  [0.35, [230, 103, 103]],    // Vibrant coral red (#e66767 gamma-exposure style)
  [0.55, [195, 60, 120]],     // Deep magenta-violet
  [0.75, [140, 45, 180]],     // Vivid violet
  [0.90, [110, 30, 175]],     // Deep purple
  [1.0,  [90, 25, 160]],      // Rich deep purple (dominant negative node)
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
 *
 * Positive values ramp through green → neon yellow.
 * Negative values ramp through dark purple → vivid purple.
 * Near-zero values of either sign settle into dark muted tones.
 */
function valueToColor(normalized: number): [number, number, number, number] {
  const val = Math.max(-1, Math.min(1, normalized));
  const mag = Math.abs(val);

  // Alpha: near-zero cells are more transparent, dominant cells are opaque
  const alpha = 0.45 + mag * 0.50; // range: 0.45 → 0.95

  let rgb: Rgb;
  if (val >= 0) {
    // Use a power curve to push contrast toward the dominant node
    // This makes the top node much brighter while mid-range stays greener
    const curved = Math.pow(mag, 0.65);
    rgb = rampLookup(POS_RAMP, curved);
  } else {
    const curved = Math.pow(mag, 0.65);
    rgb = rampLookup(NEG_RAMP, curved);
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
  isCompassMode?: boolean;
}

export function CanvasHeatmap({ ticker, isCompassMode = false }: CanvasHeatmapProps) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const heatmap     = useAppStore((s) => s.heatmapsByTicker[ticker] ?? null);
  const setHovered  = useAppStore((s) => s.setHoveredCell);
  const evolutionWindow = useAppStore((s) => s.evolutionWindow);
  const snapshotsHistory = useAppStore((s) => s.snapshotsHistory);

  const CELL_W = isCompassMode ? 160 : 106;
  const CELL_H = isCompassMode ? 26 : 42;
  const axisLeft = isCompassMode ? 0 : 76;

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

  // ─── Compass Mode Slicing ────────────────────────────────────────────────────
  
  const displaySnap = useMemo(() => {
    if (!heatmap) return null;
    if (!isCompassMode) return heatmap;
    return {
      ...heatmap,
      columns: heatmap.columns.slice(0, 1),
      data: heatmap.data.map(row => [row[0]]),
    };
  }, [heatmap, isCompassMode]);

  const displayRefSnap = useMemo(() => {
    if (!refSnap) return null;
    if (!isCompassMode) return refSnap;
    return {
      ...refSnap,
      columns: refSnap.columns.slice(0, 1),
      data: refSnap.data.map(row => [row[0]]),
    };
  }, [refSnap, isCompassMode]);

  const selectedMetric = useAppStore((s) => s.selectedMetric);

  // Compute cell matrix data (for 'rel_pm', calculates rate of metric change per minute)
  const cellMatrix = useMemo(() => {
    if (!displaySnap) return [];
    if (selectedMetric !== 'rel_pm') return displaySnap.data;

    const rows = displaySnap.rows;
    const cols = displaySnap.columns;
    const curSec = displaySnap.timestamp ? Math.floor(new Date(displaySnap.timestamp).getTime() / 1000) : 0;
    const refSec = displayRefSnap && displayRefSnap.timestamp ? Math.floor(new Date(displayRefSnap.timestamp).getTime() / 1000) : 0;
    let deltaMin = (curSec > 0 && refSec > 0 && curSec > refSec) ? (curSec - refSec) / 60 : 1;
    if (deltaMin <= 0) deltaMin = 1;

    return rows.map((_, r) => {
      return cols.map((_, c) => {
        const curVal = displaySnap.data[r][c];
        let refVal = curVal;
        if (displayRefSnap && displayRefSnap.data && displayRefSnap.data[r]) {
          refVal = displayRefSnap.data[r][c] ?? curVal;
        }
        return (curVal - refVal) / deltaMin;
      });
    });
  }, [displaySnap, displayRefSnap, selectedMetric]);

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

      const activeData = cellMatrix.length > 0 ? cellMatrix : snap.data;

      // Normalize absolute exposures for color intensities
      const norm = normalizeMatrixPerColumn(activeData);

      // Find the expiry-specific Call Wall and Put Wall index for each column (expiration)
      const colCallWallRows = new Array(cols.length).fill(-1);
      const colPutWallRows = new Array(cols.length).fill(-1);

      for (let c = 0; c < cols.length; c++) {
        let maxPositiveVal = -Infinity;
        let maxPosRowIdx = -1;
        let minNegativeVal = Infinity;
        let minNegRowIdx = -1;

        for (let r = 0; r < rows.length; r++) {
          const val = activeData[r][c];
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
          const absVal = Math.abs(activeData[r][c]);
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

          // Line 1: Value
          const raw = activeData[r][c];
          const absV = Math.abs(raw);
          let label = '';
          if (selectedMetric === 'rel_pm') {
            if      (absV >= 1e9) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e9).toFixed(1)}B/m`;
            else if (absV >= 1e6) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e6).toFixed(1)}M/m`;
            else if (absV >= 1e3) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e3).toFixed(0)}K/m`;
            else                  label = `${raw >= 0 ? '+' : '-'}${absV.toFixed(1)}/m`;
          } else {
            if      (absV >= 1e9) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e9).toFixed(1)}B`;
            else if (absV >= 1e6) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e6).toFixed(1)}M`;
            else if (absV >= 1e3) label = `${raw >= 0 ? '+' : '-'}${(absV / 1e3).toFixed(0)}K`;
            else                  label = `${raw >= 0 ? '+' : '-'}${absV.toFixed(1)}`;
          }

          // Fill main text
          
          if (isCompassMode) {
            // Side by side
            ctx.fillStyle = textColorForCell(r_, g_, b_);
            ctx.font = "11px 'Inter', sans-serif";
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, x + CELL_W / 2 - 2, y + CELL_H / 2);
            
            const pct = pctChanges[r][c];
            const isPos = pct >= 0;
            const pctLabel = `${isPos ? '▲ +' : '▼ '}${pct.toFixed(0)}%`;
            ctx.font = "9px 'Inter', sans-serif";
            
            const pctTextW = ctx.measureText(pctLabel).width;
            const pillW = pctTextW + 8;
            const pillH = 13;
            const pillX = x + CELL_W / 2 + 6;
            const pillY = y + CELL_H / 2 - pillH / 2;
            
            ctx.beginPath();
            ctx.roundRect(pillX, pillY, pillW, pillH, 4);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
            ctx.fill();
            
            ctx.fillStyle = pctColorForCell(isPos);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pctLabel, pillX + pillW / 2, y + CELL_H / 2 + 1);
          } else {
            // Top and bottom
            ctx.fillStyle = textColorForCell(r_, g_, b_);
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
            ctx.fillStyle = 'rgba(0, 0, 0, 0.38)';
            ctx.fill();

            ctx.fillStyle = pctColorForCell(isPos);
            ctx.textAlign = 'center';
            ctx.fillText(pctLabel, x + CELL_W / 2, y + 25);
          }
        }


        // Strike label (drawn after cell backgrounds)
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
        ctx.textBaseline = 'middle';
        const strikeLabel = Number.isInteger(strike) ? strike.toFixed(0) : strike.toFixed(2).replace(/\.?0+$/, '');
        if (isCompassMode) {
          ctx.textAlign = 'left';
          ctx.fillText(strikeLabel, axisLeft + 4, y + CELL_H / 2);
        } else {
          ctx.textAlign = 'right';
          ctx.fillText(strikeLabel, axisLeft - 6, y + CELL_H / 2);
        }
      }
    },
    [evolutionWindow, refSnap, isCompassMode, CELL_W, CELL_H],
  );


  // Re-draw whenever heatmap or levels change
  useEffect(() => {
    if (!displaySnap || !canvasRef.current) return;
    draw(displaySnap, canvasRef.current);
  }, [displaySnap, displayRefSnap, draw]);

  // ─── Interaction ─────────────────────────────────────────────────────────────

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!displaySnap) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;

      const cIdx = Math.floor((mx - axisLeft) / CELL_W);
      const rIdx = Math.floor((my - AXIS_TOP)  / CELL_H);

      if (
        cIdx >= 0 &&
        cIdx < displaySnap.columns.length &&
        rIdx >= 0 &&
        rIdx < displaySnap.rows.length
      ) {
        const metric = useAppStore.getState().selectedMetric;
        let value = displaySnap.data[rIdx][cIdx];
        
        // Find reference value for absolute/percent change
        let refValue = null;
        if (displayRefSnap && displayRefSnap.data[rIdx] && displayRefSnap.data[rIdx][cIdx] !== undefined) {
          refValue = displayRefSnap.data[rIdx][cIdx];
        }

        if (metric === 'rel_pm') {
          const curVal = value;
          const refVal = refValue ?? curVal;
          const curSec = displaySnap.timestamp ? Math.floor(new Date(displaySnap.timestamp).getTime() / 1000) : 0;
          const refSec = displayRefSnap && displayRefSnap.timestamp ? Math.floor(new Date(displayRefSnap.timestamp).getTime() / 1000) : 0;
          let deltaMin = (curSec > 0 && refSec > 0 && curSec > refSec) ? (curSec - refSec) / 60 : 1;
          if (deltaMin <= 0) deltaMin = 1;
          value = (curVal - refVal) / deltaMin;
        }

        const rawVal = displaySnap.data[rIdx][cIdx];
        const pctChange = (refValue !== null && refValue !== 0) ? ((rawVal - refValue) / Math.abs(refValue)) * 100 : 0;

        setHovered({
          ticker,
          metric,
          strike: displaySnap.rows[rIdx],
          expiration: displaySnap.columns[cIdx],
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
    [displaySnap, displayRefSnap, ticker, setHovered, CELL_W, CELL_H],
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
