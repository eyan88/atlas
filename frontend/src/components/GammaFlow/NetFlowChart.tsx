import { useEffect, useRef } from 'react';
import type { NetFlowData } from '../../api/gammaFlowClient';

interface NetFlowChartProps {
  history: NetFlowData[];
}

function formatUSD(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '+';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function NetFlowChart({ history }: NetFlowChartProps) {
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

    // Sort history by timestamp ascending
    const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

    const margin = { top: 20, right: 60, bottom: 30, left: 60 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Find min and max values across both premium lines
    const timestamps = sorted.map((h) => h.timestamp);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);

    const calls = sorted.map((h) => h.net_call_prem);
    const puts = sorted.map((h) => h.net_put_prem);
    const maxVal = Math.max(...calls, ...puts, 1e6);
    const minVal = Math.min(...calls, ...puts, 0);
    const valRange = maxVal - minVal;

    // Find min and max for spot prices (for secondary axis)
    const spots = sorted.map((h) => h.price);
    const maxSpot = Math.max(...spots);
    const minSpot = Math.min(...spots);
    const spotRange = maxSpot - minSpot;
    // Add small padding (10%) to spot price axis
    const spotPad = spotRange > 0 ? spotRange * 0.1 : 1.0;
    const spotMin = minSpot - spotPad;
    const spotMax = maxSpot + spotPad;
    const spotScaleRange = spotMax - spotMin;

    // Get screen coordinates helper
    const getX = (ts: number) => {
      if (maxTime === minTime) return margin.left;
      return margin.left + ((ts - minTime) / (maxTime - minTime)) * chartWidth;
    };

    // Primary Y-Axis coordinate (Premium Flow - Left axis)
    const getPremY = (val: number) => {
      if (valRange === 0) return margin.top + chartHeight / 2;
      return margin.top + chartHeight - ((val - minVal) / valRange) * chartHeight;
    };

    // Secondary Y-Axis coordinate (Spot Price - Right axis)
    const getSpotY = (val: number) => {
      if (spotScaleRange === 0) return margin.top + chartHeight / 2;
      return margin.top + chartHeight - ((val - spotMin) / spotScaleRange) * chartHeight;
    };

    // Track mouse coordinates for interactive tooltips
    let mouseX: number | null = null;
    let mouseY: number | null = null;

    const draw = () => {
      // Clear canvas
      ctx.fillStyle = '#0d0f14';
      ctx.fillRect(0, 0, width, height);

      // 1. Draw horizontal grid lines and Left/Right axis labels
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        const y = margin.top + (i / 4) * chartHeight;
        ctx.beginPath();
        ctx.moveTo(margin.left, y);
        ctx.lineTo(margin.left + chartWidth, y);
        ctx.stroke();

        // Left axis label (Premium flow in M/B)
        const val = maxVal - (i / 4) * valRange;
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const formattedPrem = (v: number) => {
          const abs = Math.abs(v);
          if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
          if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
          if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
          return `$${v.toFixed(0)}`;
        };
        ctx.fillText(formattedPrem(val), margin.left - 8, y);

        // Right axis label (Spot price)
        const spotVal = spotMax - (i / 4) * spotScaleRange;
        ctx.fillStyle = '#f59e0b'; // Amber color for spot
        ctx.textAlign = 'left';
        ctx.fillText(`$${spotVal.toFixed(2)}`, margin.left + chartWidth + 8, y);
      }

      // 2. Draw Call & Put Premium Lines
      const drawLine = (
        points: number[],
        strokeColor: string,
        fillGradientStart: string
      ) => {
        if (points.length === 0) return;

        ctx.beginPath();
        ctx.moveTo(getX(sorted[0].timestamp), getPremY(points[0]));

        for (let i = 1; i < sorted.length; i++) {
          ctx.lineTo(getX(sorted[i].timestamp), getPremY(points[i]));
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Create Area fill gradient
        const grad = ctx.createLinearGradient(0, margin.top, 0, margin.top + chartHeight);
        grad.addColorStop(0, fillGradientStart);
        grad.addColorStop(1, 'rgba(13, 15, 20, 0.0)');

        ctx.lineTo(getX(sorted[sorted.length - 1].timestamp), margin.top + chartHeight);
        ctx.lineTo(getX(sorted[0].timestamp), margin.top + chartHeight);
        ctx.closePath();

        ctx.fillStyle = grad;
        ctx.fill();
      };

      // Draw Call premium line (green)
      drawLine(calls, '#00e676', 'rgba(0, 230, 118, 0.12)');

      // Draw Put premium line (red)
      drawLine(puts, '#ff3d00', 'rgba(255, 61, 0, 0.12)');

      // 3. Draw Spot Price Line Overlay (Glowing Dotted Path)
      ctx.beginPath();
      ctx.moveTo(getX(sorted[0].timestamp), getSpotY(sorted[0].price));
      for (let i = 1; i < sorted.length; i++) {
        ctx.lineTo(getX(sorted[i].timestamp), getSpotY(sorted[i].price));
      }
      // Glowing highlight (thin, clean profile)
      ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
      ctx.shadowBlur = 5;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.8;
      ctx.setLineDash([3, 3]); // dotted line to differentiate from flows
      ctx.stroke();
      ctx.setLineDash([]); // reset
      ctx.shadowBlur = 0; // reset shadow

      // 4. Draw X-axis Time stamps
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      const tickInterval = Math.max(1, Math.floor(sorted.length / 4));
      for (let i = 0; i < sorted.length; i += tickInterval) {
        const h = sorted[i];
        const date = new Date(h.timestamp * 1000);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        ctx.fillText(timeStr, getX(h.timestamp), margin.top + chartHeight + 8);
      }

      if ((sorted.length - 1) % tickInterval !== 0) {
        const h = sorted[sorted.length - 1];
        const date = new Date(h.timestamp * 1000);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        ctx.fillText(timeStr, getX(h.timestamp), margin.top + chartHeight + 8);
      }

      // 5. Draw Hover Indicator crosshair and Tooltip box
      if (mouseX !== null && mouseX >= margin.left && mouseX <= margin.left + chartWidth) {
        // Find closest timestamp
        const xRatio = (mouseX - margin.left) / chartWidth;
        const targetTsIdx = Math.round(xRatio * (sorted.length - 1));
        const activeItem = sorted[Math.max(0, Math.min(sorted.length - 1, targetTsIdx))];
        const xPos = getX(activeItem.timestamp);

        // Draw vertical crosshair line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(xPos, margin.top);
        ctx.lineTo(xPos, margin.top + chartHeight);
        ctx.stroke();
        ctx.setLineDash([]);

        // Gather metrics
        const callVal = activeItem.net_call_prem;
        const putVal = activeItem.net_put_prem;
        const netVal = activeItem.net_premium;
        const spotPrice = activeItem.price;
        const date = new Date(activeItem.timestamp * 1000);
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

        // Tooltip box dimensions
        const tooltipW = 150;
        const tooltipH = 92;
        let tooltipX = xPos + 15;
        if (tooltipX + tooltipW > width) {
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
        ctx.fillText(`Spot: $${spotPrice.toFixed(2)}`, tooltipX + 10, tooltipY + 25);

        ctx.fillStyle = '#00e676';
        ctx.fillText(`Calls: ${formatUSD(callVal)}`, tooltipX + 10, tooltipY + 40);

        ctx.fillStyle = '#ff3d00';
        ctx.fillText(`Puts: ${formatUSD(putVal)}`, tooltipX + 10, tooltipY + 55);

        ctx.fillStyle = netVal >= 0 ? '#00e676' : '#ff3d00';
        ctx.fillText(`Net Prem: ${formatUSD(netVal)}`, tooltipX + 10, tooltipY + 70);
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
export default NetFlowChart;
