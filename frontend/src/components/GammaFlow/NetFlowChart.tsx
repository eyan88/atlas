import { useEffect, useRef } from 'react';
import type { NetFlowData } from '../../api/gammaFlowClient';

interface NetFlowChartProps {
  history: NetFlowData[];
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

    // Clear canvas
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(0, 0, width, height);

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

    // 3. Draw Spot Price Line Overlay (amber secondary axis path)
    ctx.beginPath();
    ctx.moveTo(getX(sorted[0].timestamp), getSpotY(sorted[0].price));
    for (let i = 1; i < sorted.length; i++) {
      ctx.lineTo(getX(sorted[i].timestamp), getSpotY(sorted[i].price));
    }
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]); // dotted line to differentiate from flows
    ctx.stroke();
    ctx.setLineDash([]); // reset

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
