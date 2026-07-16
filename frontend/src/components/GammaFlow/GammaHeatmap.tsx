import { useEffect, useRef } from 'react';
import type { GammaStrike } from '../../api/gammaFlowClient';

interface GammaHeatmapProps {
  history: GammaStrike[];
}

function formatUSD(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '+';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function GammaHeatmap({ history }: GammaHeatmapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set dimensions based on client bounding rect
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    // 1. Process and sort data
    const timestamps = Array.from(new Set(history.map((h) => h.timestamp))).sort((a, b) => a - b);
    const strikes = Array.from(new Set(history.map((h) => h.strike))).sort((a, b) => a - b); // Ascending order (lowest at bottom)

    if (timestamps.length < 2 || strikes.length < 2) return;

    // Build lookup map and gather spot prices per timestamp
    const matrix: Record<string, number> = {};
    const spotPrices: Record<number, number> = {};

    history.forEach((h) => {
      matrix[`${h.timestamp}:${h.strike}`] = h.dealer_gamma_vol;
      spotPrices[h.timestamp] = h.price;
    });

    const margin = { top: 20, right: 55, bottom: 30, left: 20 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Helper coordinates
    const getX = (ts: number) => {
      const minTime = timestamps[0];
      const maxTime = timestamps[timestamps.length - 1];
      if (maxTime === minTime) return margin.left;
      return margin.left + ((ts - minTime) / (maxTime - minTime)) * chartWidth;
    };

    const getRowY = (strikeIdx: number) => {
      // Index 0 (lowest strike) is drawn at the bottom
      return margin.top + chartHeight - (strikeIdx / (strikes.length - 1)) * chartHeight;
    };

    // Find global max absolute GEX for color scaling
    const maxGexAbs = Math.max(
      ...history.map((h) => Math.abs(h.dealer_gamma_vol)),
      1e6
    );

    // Calculate dimensions of a single heatmap cell
    const cellWidth = chartWidth / (timestamps.length - 1);
    const cellHeight = chartHeight / (strikes.length - 1);

    // Track mouse coordinates for interactive tooltips
    let mouseX: number | null = null;
    let mouseY: number | null = null;

    const draw = () => {
      // Clear canvas
      ctx.fillStyle = '#0d0f14';
      ctx.fillRect(0, 0, width, height);

      // 2. Draw Heatmap Cells
      for (let xIdx = 0; xIdx < timestamps.length - 1; xIdx++) {
        const ts = timestamps[xIdx];
        const x = getX(ts);

        strikes.forEach((strike, yIdx) => {
          const val = matrix[`${ts}:${strike}`] || 0;
          const pct = val / maxGexAbs; // ranges -1 to 1

          // Boosted non-linear scale to make low/mid-range exposure levels vivid and clear
          const boostedOpacity = Math.pow(Math.abs(pct), 0.75);
          ctx.fillStyle = pct >= 0
            ? `rgba(0, 230, 118, ${boostedOpacity * 0.95})` // Vivid Neon Emerald Green
            : `rgba(255, 61, 0, ${boostedOpacity * 0.95})`;  // Vivid Coral Crimson Red

          const y = getRowY(yIdx) - cellHeight / 2;
          ctx.fillRect(x, y, cellWidth + 0.5, cellHeight + 0.5); // Add 0.5px to prevent rendering seams
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

      // X-Axis Time Labels (Draw 4-5 ticks)
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const xTickInterval = Math.max(1, Math.floor(timestamps.length / 5));

      for (let i = 0; i < timestamps.length; i += xTickInterval) {
        const ts = timestamps[i];
        const x = getX(ts);
        ctx.beginPath();
        ctx.moveTo(x, margin.top);
        ctx.lineTo(x, margin.top + chartHeight);
        ctx.stroke();

        const date = new Date(ts * 1000);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        ctx.fillText(timeStr, x, margin.top + chartHeight + 8);
      }

      // 4. Draw Price Line Overlay (Glowing Spot Path)
      ctx.beginPath();
      let hasLine = false;

      timestamps.forEach((ts) => {
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
        // High visibility outer glow
        ctx.shadowColor = 'rgba(245, 158, 11, 0.75)';
        ctx.shadowBlur = 10;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 3.5;
        ctx.stroke();
        ctx.shadowBlur = 0; // reset
      }

      // 5. Draw Hover Indicator crosshair and Tooltip box
      if (mouseX !== null && mouseX >= margin.left && mouseX <= margin.left + chartWidth) {
        // Find closest timestamp
        const xRatio = (mouseX - margin.left) / chartWidth;
        const targetTsIdx = Math.round(xRatio * (timestamps.length - 1));
        const activeTs = timestamps[Math.max(0, Math.min(timestamps.length - 1, targetTsIdx))];
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
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

        // Tooltip box metrics
        const tooltipW = 140;
        const tooltipH = 80;
        let tooltipX = xPos + 15;
        if (tooltipX + tooltipW > width) {
          tooltipX = xPos - tooltipW - 15;
        }
        let tooltipY = mouseY !== null ? mouseY - tooltipH / 2 : margin.top + 20;
        tooltipY = Math.max(margin.top, Math.min(margin.top + chartHeight - tooltipH, tooltipY));

        // Draw box container
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
    };

    // Initial draw
    draw();

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
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [history]);

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
