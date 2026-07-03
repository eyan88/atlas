import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { WsMessage } from '../types';

const WS_BASE = `ws://${window.location.host}/api/v1/ws`;
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * useWebSocket — manages a persistent WebSocket connection to the Atlas
 * real-time feed for the currently selected ticker.
 *
 * Protocol:
 *   INIT   → full heatmap snapshot   → setHeatmap()
 *   PATCH  → incremental cell diffs  → applyDiff()
 *   Heartbeat ping every 30s.
 */
export function useWebSocket() {
  const activeTicker  = useAppStore((s) => s.activeTicker);
  const setHeatmap    = useAppStore((s) => s.setHeatmap);
  const applyDiff     = useAppStore((s) => s.applyDiff);
  const setWsConnected = useAppStore((s) => s.setWsConnected);
  const updateMarketLevels = useAppStore((s) => s.updateMarketLevels);

  const wsRef       = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(`${WS_BASE}/${activeTicker}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        // Heartbeat ping every 30 s
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          if (msg.type === 'INIT') {
            setHeatmap(msg.payload);
          } else if (msg.type === 'PATCH') {
            const p = msg.payload;
            updateMarketLevels(p.spot_price, p.gamma_flip, p.call_wall, p.put_wall);
            // Full snapshot replacement for now; future: apply cell-level diffs
            applyDiff({
              ticker: p.ticker,
              timestamp: p.timestamp,
              spot_price: p.spot_price,
              gamma_flip: p.gamma_flip,
              call_wall: p.call_wall,
              put_wall: p.put_wall,
              // preserve existing columns/rows/data until diff engine is implemented
              columns: [],
              rows: [],
              data: [],
            });
          }
        } catch {
          // Ignore non-JSON frames (e.g. pong)
        }
      };

      ws.onerror = () => setWsConnected(false);

      ws.onclose = () => {
        setWsConnected(false);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        // Reconnect after 3 s
        reconnectTimer = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      wsRef.current?.close();
    };
  }, [activeTicker]); // reconnect whenever the active ticker changes
}
