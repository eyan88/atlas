import { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { WsMessage } from '../types';
import { api } from '../api/client';

const VITE_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

let WS_BASE = '';
if (VITE_API_BASE_URL) {
  // Convert http/https URL to ws/wss URL
  WS_BASE = VITE_API_BASE_URL.replace(/^http/, 'ws') + '/api/v1/ws';
} else {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  WS_BASE = `${protocol}://${window.location.host}/api/v1/ws`;
}
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

  const currentTimestamp = useAppStore((s) => s.currentTimestamp);
  const isLive = currentTimestamp === null;

  const wsRef       = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isLive) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsConnected(false);
      return;
    }

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
            applyDiff(msg.payload);
            
            // Check if we need to re-center the strikes viewport
            const state = useAppStore.getState();
            const currentHeatmap = state.heatmap;
            if (currentHeatmap && currentHeatmap.rows && currentHeatmap.rows.length > 0) {
              const rows = currentHeatmap.rows;
              const midStrike = rows[Math.floor(rows.length / 2)];
              const spot = msg.payload.spot_price;
              const distance = Math.abs(spot - midStrike);
              const threshold = activeTicker.toUpperCase() === 'SPX' ? 25.0 : 4.0;
              
              if (distance > threshold) {
                api.getHeatmap(activeTicker, {
                  metric: state.selectedMetric,
                  strikeCount: state.strikeCount
                }).then((snap) => {
                  setHeatmap(snap);
                }).catch((err) => {
                  console.error("Failed to re-center heatmap snapshot:", err);
                });
              }
            }
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
  }, [activeTicker, isLive]); // reconnect whenever the active ticker changes
}
