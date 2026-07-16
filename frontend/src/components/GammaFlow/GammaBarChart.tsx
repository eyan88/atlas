import { useEffect, useRef } from 'react';
import type { GammaStrike } from '../../api/gammaFlowClient';

interface GammaBarChartProps {
  strikes: GammaStrike[];
  spot: number;
}

export function GammaBarChart({ strikes, spot }: GammaBarChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || strikes.length === 0) return;

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

    // Sort strikes ascending
    const sortedStrikes = [...strikes].sort((a, b) => b.strike - a.strike); // Highest strike at the top

    // Margins
    const margin = { top: 40, right: 80, bottom: 40, left: 60 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    // Find min/max values for scaling
    const maxVal = Math.max(
      ...sortedStrikes.map((s) => Math.abs(s.dealer_gamma_vol)),
      1e6 // default minimum scale
    );

    // Scales
    const getX = (val: number) => {
      const pct = val / maxVal; // Ranges from -1 to 1
      return margin.left + chartWidth / 2 + (pct * chartWidth) / 2;
    };

    const rowHeight = chartHeight / sortedStrikes.length;

    // Grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let pct = -1; pct <= 1; pct += 0.5) {
      const x = margin.left + chartWidth / 2 + (pct * chartWidth) / 2;
      ctx.beginPath();
      ctx.moveTo(x, margin.top);
      ctx.lineTo(x, margin.top + chartHeight);
      ctx.stroke();

      // X-axis label
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px Inter';
      ctx.textAlign = 'center';
      const formatted = (val: number) => {
        const abs = Math.abs(val);
        if (abs >= 1e9) return `${(val / 1e9).toFixed(1)}B`;
        if (abs >= 1e6) return `${(val / 1e6).toFixed(0)}M`;
        if (abs >= 1e3) return `${(val / 1e3).toFixed(0)}K`;
        return val.toString();
      };
      ctx.fillText(formatted(pct * maxVal), x, margin.top + chartHeight + 15);
    }

    // Dynamic walls calculation
    let maxGexStrike = sortedStrikes[0];
    let minGexStrike = sortedStrikes[0];
    for (const s of sortedStrikes) {
      if (s.dealer_gamma_vol > maxGexStrike.dealer_gamma_vol) maxGexStrike = s;
      if (s.dealer_gamma_vol < minGexStrike.dealer_gamma_vol) minGexStrike = s;
    }

    // Draw bars
    sortedStrikes.forEach((s, idx) => {
      const y = margin.top + idx * rowHeight;
      const xZero = margin.left + chartWidth / 2;
      const xVal = getX(s.dealer_gamma_vol);
      const isPositive = s.dealer_gamma_vol >= 0;

      // Draw Bar
      ctx.fillStyle = isPositive ? 'rgba(74, 222, 128, 0.75)' : 'rgba(248, 113, 113, 0.75)';
      ctx.strokeStyle = isPositive ? '#4ade80' : '#f87171';
      ctx.lineWidth = 1;

      const barY = y + rowHeight * 0.15;
      const barHeight = rowHeight * 0.7;
      const barWidth = xVal - xZero;

      ctx.fillRect(isPositive ? xZero : xVal, barY, Math.abs(barWidth), barHeight);
      ctx.strokeRect(isPositive ? xZero : xVal, barY, Math.abs(barWidth), barHeight);

      // Y-axis label (Strike price)
      const isSpotStrike = Math.abs(s.strike - spot) === Math.min(...sortedStrikes.map((st) => Math.abs(st.strike - spot)));
      ctx.fillStyle = isSpotStrike ? '#38bdf8' : '#e2e8f0';
      ctx.font = isSpotStrike ? 'bold 11px Inter' : '11px Inter';
      ctx.textAlign = 'right';
      ctx.fillText(s.strike.toFixed(1), margin.left - 10, y + rowHeight / 2 + 4);

      // Highlight spot strike background indicator
      if (isSpotStrike) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.05)';
        ctx.fillRect(margin.left, y, chartWidth, rowHeight);
      }

      // Draw wall annotations next to the bar
      if (s.strike === maxGexStrike.strike && s.dealer_gamma_vol > 0) {
        drawLabel(ctx, 'Call Wall', '#f59e0b', margin.left + chartWidth + 10, y + rowHeight / 2);
      } else if (s.strike === minGexStrike.strike && s.dealer_gamma_vol < 0) {
        drawLabel(ctx, 'Put Wall', '#ef4444', margin.left + chartWidth + 10, y + rowHeight / 2);
      }
    });

    // Zero center line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(margin.left + chartWidth / 2, margin.top);
    ctx.lineTo(margin.left + chartWidth / 2, margin.top + chartHeight);
    ctx.stroke();

    // Draw horizontal spot price line
    const spotY = getSpotY(sortedStrikes, spot, margin.top, rowHeight);
    if (spotY !== null) {
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(margin.left, spotY);
      ctx.lineTo(margin.left + chartWidth, spotY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label spot price
      ctx.fillStyle = '#f59e0b';
      ctx.font = 'bold 10px Inter';
      ctx.textAlign = 'left';
      ctx.fillText(`Spot: $${spot.toFixed(2)}`, margin.left + 5, spotY - 4);
    }
  }, [strikes, spot]);

  // Helper to interpolate spot Y coordinate
  function getSpotY(sortedStrikes: GammaStrike[], spot: number, topMargin: number, rowHeight: number): number | null {
    if (sortedStrikes.length < 2) return null;
    const strikesOnly = sortedStrikes.map((s) => s.strike);
    const maxStrike = strikesOnly[0];
    const minStrike = strikesOnly[strikesOnly.length - 1];

    if (spot > maxStrike || spot < minStrike) return null;

    // Find the two strikes surrounding the spot
    for (let i = 0; i < sortedStrikes.length - 1; i++) {
      const upper = sortedStrikes[i].strike;
      const lower = sortedStrikes[i + 1].strike;
      if (spot <= upper && spot >= lower) {
        const pct = (upper - spot) / (upper - lower);
        return topMargin + i * rowHeight + rowHeight / 2 + pct * rowHeight;
      }
    }
    return null;
  }

  function drawLabel(ctx: CanvasRenderingContext2D, text: string, color: string, x: number, y: number) {
    ctx.fillStyle = color;
    ctx.font = 'bold 9px Inter';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    const textWidth = ctx.measureText(text).width;
    const paddingX = 6;
    const paddingY = 3;

    ctx.fillStyle = 'rgba(15, 17, 26, 0.9)';
    ctx.fillRect(x - paddingX, y - 7 - paddingY, textWidth + paddingX * 2, 14 + paddingY * 2);

    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - paddingX, y - 7 - paddingY, textWidth + paddingX * 2, 14 + paddingY * 2);

    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

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
