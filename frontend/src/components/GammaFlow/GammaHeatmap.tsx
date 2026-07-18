import { useEffect, useRef } from 'react';
import type { GammaStrike } from '../../api/gammaFlowClient';

interface GammaHeatmapProps {
  history: GammaStrike[];
  currentTimestamp?: number | null;
  strikeCount?: number;
}

function formatUSD(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '+';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function GammaHeatmap({ history, currentTimestamp, strikeCount }: GammaHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length === 0) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    // Track mouse coordinates & observed dimensions
    let mouseX: number | null = null;
    let mouseY: number | null = null;
    let observedWidth = parent.clientWidth || canvas.getBoundingClientRect().width || 400;
    let observedHeight = parent.clientHeight || canvas.getBoundingClientRect().height || 300;

    // 1. Process and sort timestamps
    const timestamps = Array.from(new Set(history.map((h) => h.timestamp))).sort((a, b) => a - b);
    const rawStrikes = Array.from(new Set(history.map((h) => h.strike))).sort((a, b) => a - b); // Ascending order

    if (timestamps.length < 2 || rawStrikes.length < 2) return;

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

    // Build lookup map and gather spot prices per timestamp
    const matrix: Record<string, number> = {};
    const spotPrices: Record<number, number> = {};

    history.forEach((h) => {
      matrix[`${h.timestamp}:${h.strike}`] = h.dealer_gamma_vol;
      spotPrices[h.timestamp] = h.price;
    });

    // Find global max absolute GEX for color scaling
    const maxGexAbs = Math.max(
      ...history.map((h) => Math.abs(h.dealer_gamma_vol)),
      1e6
    );

    const draw = () => {
      if (observedWidth === 0 || observedHeight === 0) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Handle high DPI displays
      const dpr = window.devicePixelRatio || 1;
      canvas.width = observedWidth * dpr;
      canvas.height = observedHeight * dpr;
      ctx.scale(dpr, dpr);

      // Clear canvas
      ctx.fillStyle = '#0d0f14';
      ctx.fillRect(0, 0, observedWidth, observedHeight);

      const margin = { top: 20, right: 55, bottom: 30, left: 20 };
      const chartWidth = observedWidth - margin.left - margin.right;
      const chartHeight = observedHeight - margin.top - margin.bottom;

      // Helper coordinates (stabilized against fixed trading hours minTime/maxTime)
      const getX = (ts: number) => {
        if (maxTime === minTime) return margin.left;
        return margin.left + ((ts - minTime) / (maxTime - minTime)) * chartWidth;
      };

      const getRowY = (strikeIdx: number) => {
        return margin.top + chartHeight - (strikeIdx / (strikes.length - 1)) * chartHeight;
      };

      // Calculate vertical height of a single heatmap cell
      const cellHeight = chartHeight / (strikes.length - 1);

      // Resolve maximum timestamp currently allowed to display
      const latestAllowedTs = currentTimestamp ?? maxTime;

      // 2. Draw Heatmap Cells
      for (let xIdx = 0; xIdx < timestamps.length; xIdx++) {
        const ts = timestamps[xIdx];
        if (ts > latestAllowedTs) continue; // Skip future cells

        const x = getX(ts);
        // Compute cell width dynamically based on distance to next timestamp
        const nextTs = timestamps[xIdx + 1] || ts + 300;
        const nextX = getX(nextTs);
        const cellWidth = Math.max(1.5, nextX - x);

        strikes.forEach((strike, yIdx) => {
          const val = matrix[`${ts}:${strike}`] || 0;
          const pct = val / maxGexAbs; // ranges -1 to 1

          // Boosted non-linear scale to make low/mid-range exposure levels vivid and clear
          const boostedOpacity = Math.pow(Math.abs(pct), 0.6); // lowered from 0.75 for much greater visibility
          ctx.fillStyle = pct >= 0
            ? `rgba(0, 230, 118, ${boostedOpacity * 0.95})` // Vivid Neon Emerald Green
            : `rgba(255, 61, 0, ${boostedOpacity * 0.95})`;  // Vivid Coral Crimson Red

          const y = getRowY(yIdx) - cellHeight / 2;
          ctx.fillRect(x, y, cellWidth + 0.5, cellHeight + 0.5); // Add 0.5px to prevent rendering gaps
        });
      }

      // 3. Draw Grid Lines and Labels
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;

      // Y-Axis Strike Labels (Draw on the RIGHT side instead of left)
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

        ctx.fillText(strike.toFixed(1), margin.left + chartWidth + 8, y);
      }

      // X-Axis Time Labels (Draw exactly at the fixed tickTimes trading hours)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      tickTimes.forEach((ts) => {
        const x = getX(ts);
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + chartHeight);
        ctx.stroke();

        const date = new Date(ts * 1000);
        const timeStr = date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/New_York',
          hour12: false
        });
        ctx.fillText(timeStr, x, margin.top + chartHeight + 8);
      });

      // 4. Draw Price Line Overlay (Glowing Spot Path - Plotted up to latest allowed timestamp)
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
          // Center the line inside the cell width
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
        // High visibility outer glow (thin, clean profile)
        ctx.shadowColor = 'rgba(245, 158, 11, 0.65)';
        ctx.shadowBlur = 5;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.shadowBlur = 0; // reset
      }

      // 5. Draw Hover Indicator crosshair and Tooltip box
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

          // Draw vertical crosshair line
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(xPos, margin.top);
          ctx.lineTo(xPos, margin.top + chartHeight);
          ctx.stroke();
          ctx.setLineDash([]);

          // Find closest strike corresponding to mouseY
          let hoveredStrike = strikes[0];
          if (mouseY !== null && mouseY >= margin.top && mouseY <= margin.top + chartHeight) {
            const yRatio = 1 - (mouseY - margin.top) / chartHeight;
            const targetStrikeIdx = Math.round(yRatio * (strikes.length - 1));
            hoveredStrike = strikes[Math.max(0, Math.min(strikes.length - 1, targetStrikeIdx))];
            const yPos = getRowY(targetStrikeIdx);

            // Draw horizontal crosshair line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.beginPath();
            ctx.moveTo(margin.left, yPos);
            ctx.lineTo(margin.left + chartWidth, yPos);
            ctx.stroke();
          }

          // Gather metrics
          const gexValue = matrix[`${activeTs}:${hoveredStrike}`] || 0;
          const spotPrice = spotPrices[activeTs] || 0;
          const date = new Date(activeTs * 1000);
          const timeStr = date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/New_York',
            hour12: false
          });

          // Tooltip box dimensions
          const tooltipW = 140;
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

          const gexStr = formatUSD(gexValue);
          ctx.fillStyle = gexValue >= 0 ? '#00e676' : '#ff3d00';
          ctx.fillText(`GEX: ${gexStr}`, tooltipX + 10, tooltipY + 58);
        }
      }
    };

    // Initial draw immediately on mount to solve load races
    draw();

    // Resize observer to dynamically capture container size changes
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        if (width !== observedWidth || height !== observedHeight) {
          observedWidth = width;
          observedHeight = height;
          draw();
        }
      }
    });
    resizeObserver.observe(parent);

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
      resizeObserver.disconnect();
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [history, currentTimestamp, strikeCount]);

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
