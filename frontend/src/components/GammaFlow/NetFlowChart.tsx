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

    // Find min and max values across both lines
    const timestamps = sorted.map((h) => h.timestamp);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);

    const calls = sorted.map((h) => h.net_call_prem);
    const puts = sorted.map((h) => h.net_put_prem);
    const maxVal = Math.max(...calls, ...puts, 1e6);
    const minVal = Math.min(...calls, ...puts, 0);

    const valRange = maxVal - minVal;

    // Get screen coordinates helper
    const getX = (ts: number) => {
      if (maxTime === minTime) return margin.left;
      return margin.left + ((ts - minTime) / (maxTime - minTime)) * chartWidth;
    };

    const getY = (val: number) => {
      if (valRange === 0) return margin.top + chartHeight / 2;
      return margin.top + chartHeight - ((val - minVal) / valRange) * chartHeight;
    };

    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = margin.top + (i / 4) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(margin.left + chartWidth, y);
      ctx.stroke();

      // Y-axis label
      const val = maxVal - (i / 4) * valRange;
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px Inter';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const formatted = (v: number) => {
        const abs = Math.abs(v);
        if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
        if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
        if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
        return `$${v.toFixed(0)}`;
      };
      ctx.fillText(formatted(val), margin.left - 8, y);
    }

    // Draw line charts
    const drawLine = (
      points: number[],
      strokeColor: string,
      fillGradientStart: string
    ) => {
      if (points.length === 0) return;

      ctx.beginPath();
      ctx.moveTo(getX(sorted[0].timestamp), getY(points[0]));

      for (let i = 1; i < sorted.length; i++) {
        ctx.lineTo(getX(sorted[i].timestamp), getY(points[i]));
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
    drawLine(calls, '#4ade80', 'rgba(74, 222, 128, 0.15)');

    // Draw Put premium line (red)
    drawLine(puts, '#f87171', 'rgba(248, 113, 113, 0.15)');

    // Draw X-axis timestamps
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

    // Also draw the last timestamp label if it was skipped
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
