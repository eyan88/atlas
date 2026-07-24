import { useEffect, useRef } from 'react';
import type { GammaStrike } from '../../api/gammaFlowClient';
import { useAppStore } from '../../store/useAppStore';

interface GammaHeatmapProps {
  history: GammaStrike[];
  currentTimestamp?: number | null;
  strikeCount?: number;
  metric?: 'gex' | 'rel_pm';
}

function formatUSD(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '+';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function GammaHeatmap({ history, currentTimestamp, strikeCount, metric = 'gex' }: GammaHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorTheme = useAppStore((s) => s.colorTheme);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !history || !Array.isArray(history) || history.length === 0) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    // Track mouse coordinates & observed dimensions
    let mouseX: number | null = null;
    let mouseY: number | null = null;
    let observedWidth = parent.clientWidth || canvas.getBoundingClientRect().width || 400;
    let observedHeight = parent.clientHeight || canvas.getBoundingClientRect().height || 300;

    // 1. Process and sort timestamps
    const validHistory = history.filter((h) => h && typeof h.timestamp === 'number' && !isNaN(h.timestamp));
    const timestamps = Array.from(new Set(validHistory.map((h) => h.timestamp))).sort((a, b) => a - b);
    const rawStrikes = Array.from(new Set(validHistory.map((h) => h.strike))).sort((a, b) => a - b); // Ascending order

    if (timestamps.length < 2 || rawStrikes.length < 2 || !timestamps[0]) return;

    // Fix the X-axis to represent exactly the standard trading session: 9:30 AM to 4:00 PM Eastern (America/New_York)
    const firstTs = timestamps[0];
    const dateRef = new Date(firstTs * 1000);
    const year = dateRef.getUTCFullYear();
    const month = dateRef.getUTCMonth();
    const day = dateRef.getUTCDate();

    // Determine if the session started at 13:30 UTC (Daylight Saving Time) or 14:30 UTC (Standard Time)
    const startHour = dateRef.getUTCHours() < 14 ? 13 : 14;
    const startMin = 30;

    const minTimeDate = new Date(Date.UTC(year, month, day, startHour, startMin, 0));
    const minTime = Math.floor(minTimeDate.getTime() / 1000);
    const maxTime = minTime + 23400; // Exactly 6.5 hours later (23,400 seconds)

    // Static clean 1.5-hour interval tick times: 9:30, 11:00, 12:30, 14:00, 15:30, 16:00 Eastern
    const tickTimes = [
      minTime,
      minTime + 5400,   // 11:00 AM
      minTime + 10800,  // 12:30 PM
      minTime + 16200,  // 02:00 PM
      minTime + 21600,  // 03:30 PM
      maxTime,          // 04:00 PM
    ];

    // Find the latest spot price from the visible segment to orient our zoom window
    const visibleSegment = currentTimestamp
      ? history.filter((h) => h.timestamp <= currentTimestamp)
      : history;
    const lastHistoryItem = visibleSegment[visibleSegment.length - 1] || history[history.length - 1];
    const currentSpot = lastHistoryItem ? lastHistoryItem.price : rawStrikes[Math.floor(rawStrikes.length / 2)];

    // Filter strikes to the closest N strikes around the spot price
    let strikes = rawStrikes;
    if (currentSpot > 0 && strikeCount !== undefined && strikeCount > 0) {
      strikes = [...rawStrikes]
        .sort((a, b) => Math.abs(a - currentSpot) - Math.abs(b - currentSpot))
        .slice(0, strikeCount)
        .sort((a, b) => a - b);
    }

    // Build lookup maps for raw GEX and spot prices
    const rawMatrix: Record<string, number> = {};
    const spotPrices: Record<number, number> = {};

    history.forEach((h) => {
      rawMatrix[`${h.timestamp}:${h.strike}`] = h.dealer_gamma_vol;
      spotPrices[h.timestamp] = h.price;
    });

    // Compute colMax for per-column normalization (perTime / rel_pm mode from gamma-exposure repo)
    const colMax: Record<number, number> = {};
    timestamps.forEach((ts) => {
      let maxAbs = 0;
      strikes.forEach((strike) => {
        const a = Math.abs(rawMatrix[`${ts}:${strike}`] || 0);
        if (a > maxAbs) maxAbs = a;
      });
      colMax[ts] = maxAbs > 0 ? maxAbs : 1e-9;
    });

    // Find max absolute GEX value across visible matrix for global GEX scaling
    const maxValAbs = Math.max(
      ...Object.values(rawMatrix).map((v) => Math.abs(v)),
      1e3
    );

    // Atlas Signature Color Palette
    type Rgb = [number, number, number];

    // Positive ramp: Muted Teal -> Emerald -> Forest Green -> Soft Golden Lime (Soft, elegant contrast)
    const POS_RAMP: Array<[number, Rgb]> = [
      [0.0,  [16, 24, 32]],       // Near-zero positive (blends smoothly into dark background)
      [0.15, [18, 75, 70]],       // Deep teal-green
      [0.35, [22, 125, 85]],      // Medium emerald
      [0.55, [32, 160, 80]],      // Rich forest green
      [0.75, [85, 180, 50]],      // Muted lime green
      [0.90, [140, 195, 45]],     // Soft lime
      [1.0,  [175, 210, 50]],     // Soft golden lime (non-blinding peak positive node)
    ];

    // Negative ramp: Muted Dark Plum -> Violet -> Deep Purple (Soft, elegant contrast)
    const NEG_RAMP: Array<[number, Rgb]> = [
      [0.0,  [20, 15, 28]],       // Near-zero negative (blends smoothly into dark background)
      [0.15, [48, 25, 75]],       // Dark plum
      [0.35, [72, 32, 110]],      // Medium purple
      [0.55, [95, 38, 148]],      // Vivid violet
      [0.75, [115, 40, 175]],     // Rich purple
      [0.90, [130, 42, 185]],     // Deep vivid purple
      [1.0,  [145, 45, 195]],     // Soft deep violet (non-blinding peak negative node)
    ];

    // Classic Positive Green ramp: dark muted green -> vivid green -> soft golden green/lime
    const CLASSIC_POS_RAMP: Array<[number, Rgb]> = [
      [0.0,  [16, 24, 20]],
      [0.15, [18, 75, 45]],
      [0.35, [22, 125, 65]],
      [0.55, [32, 160, 70]],
      [0.75, [75, 180, 50]],
      [0.90, [120, 195, 45]],
      [1.0,  [150, 210, 50]],
    ];

    // Classic Negative Red ramp: dark muted red -> vivid red -> soft red/peach
    const CLASSIC_NEG_RAMP: Array<[number, Rgb]> = [
      [0.0,  [24, 16, 16]],
      [0.15, [75, 24, 24]],
      [0.35, [125, 32, 32]],
      [0.55, [160, 38, 38]],
      [0.75, [180, 50, 50]],
      [0.90, [195, 75, 75]],
      [1.0,  [210, 100, 100]],
    ];

    const mixColor = (c1: Rgb, c2: Rgb, f: number): Rgb => {
      const factor = Math.max(0, Math.min(1, f));
      return [
        Math.round(c1[0] + (c2[0] - c1[0]) * factor),
        Math.round(c1[1] + (c2[1] - c1[1]) * factor),
        Math.round(c1[2] + (c2[2] - c1[2]) * factor),
      ];
    };

    const rampLookup = (stops: Array<[number, Rgb]>, t: number): Rgb => {
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
    };

    const getHeatmapColor = (normalized: number): string => {
      const val = Math.max(-1, Math.min(1, normalized));
      const abs = Math.abs(val);
      if (abs < 0.015) return '#0a0e17'; // Deep dark Atlas navy background for low GEX
      
      const posStops = colorTheme === 'classic' ? CLASSIC_POS_RAMP : POS_RAMP;
      const negStops = colorTheme === 'classic' ? CLASSIC_NEG_RAMP : NEG_RAMP;
      
      const rgb = val >= 0 ? rampLookup(posStops, abs) : rampLookup(negStops, abs);
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    };

    const draw = () => {
      if (observedWidth === 0 || observedHeight === 0) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Handle high DPI displays
      const dpr = window.devicePixelRatio || 1;
      canvas.width = observedWidth * dpr;
      canvas.height = observedHeight * dpr;
      ctx.scale(dpr, dpr);

      // Clear canvas (Atlas dark navy base)
      ctx.fillStyle = '#0a0e17';
      ctx.fillRect(0, 0, observedWidth, observedHeight);

      const margin = { top: 16, right: 65, bottom: 25, left: 35 };
      const chartWidth = observedWidth - margin.left - margin.right;
      const chartHeight = observedHeight - margin.top - margin.bottom;

      // Calculate vertical height of a single heatmap cell
      const cellHeight = chartHeight / strikes.length;
      const rowGap = 1.0; // 1px clean row separation between strike prices
      const drawCellHeight = Math.max(1, cellHeight - rowGap);

      // Helper coordinates (stabilized against fixed trading hours minTime/maxTime)
      const getX = (ts: number) => {
        if (maxTime === minTime) return margin.left;
        return margin.left + ((ts - minTime) / (maxTime - minTime)) * chartWidth;
      };

      const getRowY = (strikeIdx: number) => {
        return margin.top + chartHeight - (strikeIdx + 0.5) * cellHeight;
      };

      // Resolve maximum timestamp currently allowed to display
      const latestAllowedTs = currentTimestamp ?? maxTime;

      // 2. Draw Heatmap Cells (Strictly clipped to Inner Plot Area with 1px row gap separation)
      ctx.save();
      ctx.beginPath();
      ctx.rect(margin.left, margin.top, chartWidth, chartHeight);
      ctx.clip();

      for (let xIdx = 0; xIdx < timestamps.length; xIdx++) {
        const ts = timestamps[xIdx];
        if (ts > latestAllowedTs) continue; // Skip future cells

        const x = getX(ts);
        // Compute cell width dynamically based on distance to next timestamp
        const nextTs = timestamps[xIdx + 1] || ts + 300;
        const nextX = getX(nextTs);
        const cellWidth = Math.max(1.5, nextX - x);

        strikes.forEach((strike, yIdx) => {
          const val = rawMatrix[`${ts}:${strike}`] || 0;
          let pct = 0;
          if (metric === 'rel_pm') {
            pct = val / colMax[ts]; // Exact perTime normalization from gamma-exposure repo
          } else {
            pct = maxValAbs > 0 ? val / maxValAbs : 0; // Global GEX mode
          }
          pct = Math.max(-1, Math.min(1, pct));

          // Draw cell using selected color scheme
          ctx.fillStyle = getHeatmapColor(pct);

          const y = margin.top + chartHeight - (yIdx + 1) * cellHeight + rowGap / 2;
          ctx.fillRect(x, y, cellWidth + 0.5, drawCellHeight);
        });
      }

      // Draw Price Line Overlay (Glowing Spot Path) within clipped plot area
      ctx.beginPath();
      let hasLine = false;

      timestamps.forEach((ts, xIdx) => {
        if (ts > latestAllowedTs) return; // Skip future price paths

        const price = spotPrices[ts];
        if (price === undefined) return;

        // Interpolate Y coordinate based on surrounding strikes
        let yVal: number | null = null;
        if (strikes.length > 1) {
          const minStrike = strikes[0];
          const maxStrike = strikes[strikes.length - 1];

          if (price >= minStrike && price <= maxStrike) {
            for (let y = 0; y < strikes.length - 1; y++) {
              const lower = strikes[y];
              const upper = strikes[y + 1];
              if (price >= lower && price <= upper) {
                const idxPosition = y + (price - lower) / (upper - lower);
                yVal = getRowY(idxPosition);
                break;
              }
            }
          }
        }

        if (yVal !== null) {
          const nextTs = timestamps[xIdx + 1] || ts + 300;
          const cellWidth = Math.max(1.5, getX(nextTs) - getX(ts));
          const x = getX(ts) + cellWidth / 2;

          if (!hasLine) {
            ctx.moveTo(x, yVal);
            hasLine = true;
          } else {
            ctx.lineTo(x, yVal);
          }
        }
      });

      if (hasLine) {
        ctx.shadowColor = 'rgba(245, 158, 11, 0.7)';
        ctx.shadowBlur = 4;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      ctx.restore(); // End inner plot clip area

      // 3. Draw Grid Lines and Labels
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;

      // Y-Axis Strike Labels (Draw on the RIGHT side outside the chart plot)
      const yTickInterval = Math.max(1, Math.floor(strikes.length / 6));
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px Inter';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      for (let i = 0; i < strikes.length; i += yTickInterval) {
        const strike = strikes[i];
        const y = getRowY(i);
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + chartWidth, y);
        ctx.stroke();

        ctx.fillText(`$${strike.toFixed(1)}`, margin.left + chartWidth + 6, y);
      }

      // X-Axis Time Labels (Draw exactly at the fixed tickTimes trading hours)
      ctx.textBaseline = 'top';

      tickTimes.forEach((ts, idx) => {
        const x = getX(ts);
        const date = new Date(ts * 1000);
        const timeStr = date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/New_York',
          hour12: false
        });
        if (idx === 0) {
          ctx.textAlign = 'left';
        } else if (idx === tickTimes.length - 1) {
          ctx.textAlign = 'right';
        } else {
          ctx.textAlign = 'center';
        }
        ctx.fillText(timeStr, x, margin.top + chartHeight + 6);
      });

      // 5. Draw Hover Indicator (Vertical time tracking line, horizontal strike guide, spot dot & Tooltip)
      if (mouseX !== null && mouseX >= margin.left && mouseX <= margin.left + chartWidth) {
        const xRatio = (mouseX - margin.left) / chartWidth;
        const targetTs = minTime + xRatio * (maxTime - minTime);

        // Find closest timestamp present in history
        const activeTs = timestamps.reduce((prev, curr) => {
          return Math.abs(curr - targetTs) < Math.abs(prev - targetTs) ? curr : prev;
        }, timestamps[0]);

        // Only show tooltip/cursor details for regions containing active drawn data
        if (activeTs <= latestAllowedTs) {
          const xPos = getX(activeTs);

          // Format time string for the highlight badge
          const date = new Date(activeTs * 1000);
          const timeStr = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/New_York',
            hour12: false
          });

          // Draw vertical time guide line (Sky Blue tracking line across full chart height)
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(xPos, margin.top);
          ctx.lineTo(xPos, margin.top + chartHeight);
          ctx.stroke();

          // Draw highlighted time badge at the bottom axis
          const badgeW = 44;
          const badgeH = 16;
          const badgeX = xPos - badgeW / 2;
          const badgeY = margin.top + chartHeight + 4;

          ctx.fillStyle = '#0f172a';
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 9px Inter';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(timeStr, xPos, badgeY + badgeH / 2);

          // Find closest strike corresponding to mouseY
          let hoveredStrike = strikes[0];
          if (mouseY !== null && mouseY >= margin.top && mouseY <= margin.top + chartHeight) {
            const yRatio = 1 - (mouseY - margin.top) / chartHeight;
            const targetStrikeIdx = Math.round(yRatio * (strikes.length - 1));
            hoveredStrike = strikes[Math.max(0, Math.min(strikes.length - 1, targetStrikeIdx))];
            const yPos = getRowY(targetStrikeIdx);

            // Draw horizontal crosshair guide line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
            ctx.beginPath();
            ctx.moveTo(margin.left, yPos);
            ctx.lineTo(margin.left + chartWidth, yPos);
            ctx.stroke();
          }
          ctx.setLineDash([]); // Reset line dash

          // Highlight Spot Price Marker Dot on spot curve at time xPos
          const activeSpot = spotPrices[activeTs];
          if (activeSpot !== undefined && strikes.length > 1) {
            const minStrike = strikes[0];
            const maxStrike = strikes[strikes.length - 1];
            if (activeSpot >= minStrike && activeSpot <= maxStrike) {
              for (let y = 0; y < strikes.length - 1; y++) {
                const lower = strikes[y];
                const upper = strikes[y + 1];
                if (activeSpot >= lower && activeSpot <= upper) {
                  const idxPos = y + (activeSpot - lower) / (upper - lower);
                  const spotY = getRowY(idxPos);

                  // Glowing Amber Spot Marker Dot
                  ctx.beginPath();
                  ctx.arc(xPos, spotY, 4.5, 0, Math.PI * 2);
                  ctx.fillStyle = '#f59e0b';
                  ctx.fill();
                  ctx.strokeStyle = '#ffffff';
                  ctx.lineWidth = 1.5;
                  ctx.stroke();
                  break;
                }
              }
            }
          }

          // Gather metrics
          const spotPrice = spotPrices[activeTs] || 0;
          const activeVal = rawMatrix[`${activeTs}:${hoveredStrike}`] || 0;

          // Tooltip box dimensions
          const tooltipW = 155;
          const tooltipH = 80;
          let tooltipX = xPos + 15;
          if (tooltipX + tooltipW > observedWidth) {
            tooltipX = xPos - tooltipW - 15;
          }
          let tooltipY = mouseY !== null ? mouseY - tooltipH / 2 : margin.top + 20;
          tooltipY = Math.max(margin.top, Math.min(margin.top + chartHeight - tooltipH, tooltipY));

          // Draw container box
          ctx.fillStyle = 'rgba(15, 17, 26, 0.95)';
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(tooltipX, tooltipY, tooltipW, tooltipH, 6);
          ctx.fill();
          ctx.stroke();

          // Write Tooltip text
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 10px Inter';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(`Time: ${timeStr}`, tooltipX + 10, tooltipY + 10);
          
          ctx.fillStyle = '#f59e0b';
          ctx.fillText(`Spot: $${spotPrice.toFixed(2)}`, tooltipX + 10, tooltipY + 26);

          ctx.fillStyle = '#94a3b8';
          ctx.fillText(`Strike: ${hoveredStrike.toFixed(1)}`, tooltipX + 10, tooltipY + 42);

          if (metric === 'rel_pm') {
            const cMax = colMax[activeTs] || 1e-9;
            const relPct = Math.max(-100, Math.min(100, (activeVal / cMax) * 100));
            const pctSign = relPct >= 0 ? '+' : '';
            ctx.fillStyle = activeVal >= 0 ? '#199e70' : '#e66767';
            ctx.fillText(`Rel/Min: ${pctSign}${relPct.toFixed(0)}% (${formatUSD(activeVal)})`, tooltipX + 10, tooltipY + 58);
          } else {
            const gexStr = formatUSD(activeVal);
            ctx.fillStyle = activeVal >= 0 ? '#199e70' : '#e66767';
            ctx.fillText(`GEX: ${gexStr}`, tooltipX + 10, tooltipY + 58);
          }
        }
      }
    };

    // Initial draw immediately on mount to solve load races
    draw();

    // Check dimensions helper
    const checkAndDraw = () => {
      const w = parent.clientWidth || parent.getBoundingClientRect().width;
      const h = parent.clientHeight || parent.getBoundingClientRect().height;
      if (w > 0 && h > 0 && (w !== observedWidth || h !== observedHeight)) {
        observedWidth = w;
        observedHeight = h;
        draw();
      }
    };

    // Resize observer to dynamically capture container size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        const w = width || parent.clientWidth || parent.getBoundingClientRect().width;
        const h = height || parent.clientHeight || parent.getBoundingClientRect().height;
        if (w > 0 && h > 0) {
          if (w !== observedWidth || h !== observedHeight) {
            observedWidth = w;
            observedHeight = h;
            draw();
          }
        }
      }
    });
    resizeObserver.observe(parent);

    // Schedule post-mount draw checks for flex transitions
    const rafId = requestAnimationFrame(checkAndDraw);
    const timerId = setTimeout(checkAndDraw, 120);
    window.addEventListener('resize', checkAndDraw);

    // Mouse Move Listeners
    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
      draw();
    };

    const handleMouseLeave = () => {
      mouseX = null;
      mouseY = null;
      draw();
    };

    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(timerId);
      window.removeEventListener('resize', checkAndDraw);
      resizeObserver.disconnect();
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [history, currentTimestamp, strikeCount, metric, colorTheme]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          background: '#0d0f14',
          borderRadius: '6px',
        }}
      />
    </div>
  );
}
export default GammaHeatmap;
