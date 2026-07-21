import { useEffect, useRef } from 'react';
import type { NetFlowData } from '../../api/gammaFlowClient';

interface NetFlowChartProps {
  history: NetFlowData[];
  currentTimestamp?: number | null;
}

function formatUSD(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '+';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function NetFlowChart({ history, currentTimestamp }: NetFlowChartProps) {
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

    // Sort full history by timestamp ascending
    const sorted = [...history].sort((a, b) => a.timestamp - b.timestamp);

    // Fix the X-axis to represent exactly the standard trading session: 9:30 AM to 4:00 PM Eastern (America/New_York)
    const firstTs = sorted[0].timestamp;
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

    // Find min and max values across both premium lines for primary Y-axis
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

      const margin = { top: 20, right: 60, bottom: 30, left: 60 };
      const chartWidth = observedWidth - margin.left - margin.right;
      const chartHeight = observedHeight - margin.top - margin.bottom;

      // Get screen coordinates helper (stabilized using fixed trading hours minTime/maxTime)
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

      // Filter history down to the currently visible segments
      const latestAllowedTs = currentTimestamp ?? maxTime;
      const visibleHistory = sorted.filter((h) => h.timestamp <= latestAllowedTs);

      // 2. Draw Call & Put Premium Lines
      const drawLine = (
        points: number[],
        strokeColor: string,
        fillGradientStart: string
      ) => {
        if (points.length === 0) return;

        ctx.beginPath();
        ctx.moveTo(getX(visibleHistory[0].timestamp), getPremY(points[0]));

        for (let i = 1; i < visibleHistory.length; i++) {
          ctx.lineTo(getX(visibleHistory[i].timestamp), getPremY(points[i]));
        }

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Create Area fill gradient
        const grad = ctx.createLinearGradient(0, margin.top, 0, margin.top + chartHeight);
        grad.addColorStop(0, fillGradientStart);
        grad.addColorStop(1, 'rgba(13, 15, 20, 0.0)');

        ctx.lineTo(getX(visibleHistory[visibleHistory.length - 1].timestamp), margin.top + chartHeight);
        ctx.lineTo(getX(visibleHistory[0].timestamp), margin.top + chartHeight);
        ctx.closePath();

        ctx.fillStyle = grad;
        ctx.fill();
      };

      if (visibleHistory.length > 0) {
        const visibleCalls = visibleHistory.map((h) => h.net_call_prem);
        const visiblePuts = visibleHistory.map((h) => h.net_put_prem);

        // Draw Call premium line (green)
        drawLine(visibleCalls, '#00e676', 'rgba(0, 230, 118, 0.12)');

        // Draw Put premium line (red)
        drawLine(visiblePuts, '#ff3d00', 'rgba(255, 61, 0, 0.12)');

        // 3. Draw Spot Price Line Overlay (Glowing Dotted Path)
        ctx.beginPath();
        ctx.moveTo(getX(visibleHistory[0].timestamp), getSpotY(visibleHistory[0].price));
        for (let i = 1; i < visibleHistory.length; i++) {
          ctx.lineTo(getX(visibleHistory[i].timestamp), getSpotY(visibleHistory[i].price));
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
      }

      // 4. Draw X-axis Time stamps exactly at standard session hours
      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';

      tickTimes.forEach((ts) => {
        const x = getX(ts);
        const date = new Date(ts * 1000);
        const timeStr = date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'America/New_York',
          hour12: false
        });
        ctx.fillText(timeStr, x, margin.top + chartHeight + 8);
      });

      // 5. Draw Hover Indicator crosshair and Tooltip box
      if (mouseX !== null && mouseX >= margin.left && mouseX <= margin.left + chartWidth) {
        const xRatio = (mouseX - margin.left) / chartWidth;
        const targetTs = minTime + xRatio * (maxTime - minTime);

        // Find closest timestamp present in visibleHistory
        if (visibleHistory.length > 0) {
          const activeItem = visibleHistory.reduce((prev, curr) => {
            return Math.abs(curr.timestamp - targetTs) < Math.abs(prev.timestamp - targetTs) ? curr : prev;
          }, visibleHistory[0]);

          if (activeItem.timestamp <= latestAllowedTs) {
            const xPos = getX(activeItem.timestamp);

             // Format time string for the highlight badge
             const date = new Date(activeItem.timestamp * 1000);
             const timeStr = date.toLocaleTimeString('en-US', {
               hour: '2-digit',
               minute: '2-digit',
               timeZone: 'America/New_York',
               hour12: false
             });

             // Draw highlighted time badge at the bottom axis (instead of vertical crosshair line)
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

            // Gather metrics
            const callVal = activeItem.net_call_prem;
            const putVal = activeItem.net_put_prem;
            const netVal = activeItem.net_premium;
            const spotPrice = activeItem.price;
            // Use already declared timeStr and date variables for tooltip

            // Tooltip box dimensions
            const tooltipW = 150;
            const tooltipH = 92;
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
            ctx.fillText(`Spot: $${spotPrice.toFixed(2)}`, tooltipX + 10, tooltipY + 25);

            ctx.fillStyle = '#00e676';
            ctx.fillText(`Calls: ${formatUSD(callVal)}`, tooltipX + 10, tooltipY + 40);

            ctx.fillStyle = '#ff3d00';
            ctx.fillText(`Puts: ${formatUSD(putVal)}`, tooltipX + 10, tooltipY + 55);

            ctx.fillStyle = netVal >= 0 ? '#00e676' : '#ff3d00';
            ctx.fillText(`Net Prem: ${formatUSD(netVal)}`, tooltipX + 10, tooltipY + 70);
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
  }, [history, currentTimestamp]);

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
