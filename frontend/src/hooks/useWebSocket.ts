import { useEffect, useRef } from 'react';
import { useAppStore, toSeconds } from '../store/useAppStore';
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
  const setHeatmapForTicker = useAppStore((s) => s.setHeatmapForTicker);
  const applyDiff     = useAppStore((s) => s.applyDiff);
  const setWsConnected = useAppStore((s) => s.setWsConnected);

  const currentTimestamp = useAppStore((s) => s.currentTimestamp);
  const isLive = currentTimestamp === null;

  const wsRef       = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    const closeExisting = () => {
      clearTimeout(reconnectTimer);
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (wsRef.current) {
        const socket = wsRef.current;
        socket.onclose = null;
        socket.onerror = null;
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        } else if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => {
            try { socket.close(); } catch { /* ignore */ }
          };
        }
        wsRef.current = null;
      }
    };

    if (!isLive || !activeTicker) {
      closeExisting();
      setWsConnected(false);
      return;
    }

    const connect = () => {
      closeExisting();

      const state = useAppStore.getState();
      const ws = new WebSocket(`${WS_BASE}/${activeTicker}?strikeCount=${state.strikeCount}`);
      wsRef.current = ws;

      ws.onopen = () => {
        // If this socket was superseded while connecting, discard it
        if (wsRef.current !== ws) {
          ws.onclose = null;
          ws.close();
          return;
        }
        setWsConnected(true);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping');
        }, HEARTBEAT_INTERVAL_MS);
      };

      ws.onmessage = (event: MessageEvent<string>) => {
        if (wsRef.current !== ws) return;
        try {
          const msg = JSON.parse(event.data) as WsMessage;
          if (msg.payload && msg.payload.timestamp) {
            const ms = new Date(msg.payload.timestamp).getTime();
            if (!isNaN(ms)) {
              const sec = toSeconds(ms);
              msg.payload.timestamp = new Date(sec * 1000).toISOString();
            }
          }
          if (msg.type === 'INIT') {
            setHeatmapForTicker(activeTicker, msg.payload);
            setHeatmap(msg.payload);
          } else if (msg.type === 'PATCH') {
            applyDiff(msg.payload);
            
            // Check if we need to re-center the strikes viewport
            const currentState = useAppStore.getState();
            const currentHeatmap = currentState.heatmap;
            if (currentHeatmap && currentHeatmap.rows && currentHeatmap.rows.length > 0) {
              const rows = currentHeatmap.rows;
              const midStrike = rows[Math.floor(rows.length / 2)];
              const spot = msg.payload.spot_price;
              const distance = Math.abs(spot - midStrike);
              const threshold = activeTicker.toUpperCase() === 'SPX' ? 25.0 : 4.0;
              
              if (distance > threshold) {
                api.getHeatmap(activeTicker, {
                  metric: currentState.selectedMetric,
                  strikeCount: currentState.strikeCount
                }).then((snap) => {
                  setHeatmap(snap);
                }).catch((err) => {
                  console.error("Failed to re-center heatmap snapshot:", err);
                });
              }
            }
          }
        } catch {
          // Ignore non-JSON frames
        }
      };

      ws.onerror = () => {
        if (wsRef.current === ws) setWsConnected(false);
      };

      ws.onclose = () => {
        if (wsRef.current !== ws) return;
        setWsConnected(false);
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
        
        const currentState = useAppStore.getState();
        const stillLive = currentState.currentTimestamp === null;
        if (stillLive) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      closeExisting();
    };
  }, [activeTicker, isLive]);
}
