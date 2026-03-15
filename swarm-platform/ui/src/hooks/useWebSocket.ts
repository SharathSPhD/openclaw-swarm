import { useEffect, useRef, useState, useCallback } from "react";
import type { WsMessage } from "../types";

export function useWebSocket(url?: string) {
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = url || `${protocol}://${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setTimeout(connect, 1500);
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as WsMessage;
        setLastMessage(msg);
      } catch { /* ignore */ }
    };
    wsRef.current = ws;
  }, [url]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  return { lastMessage, connected };
}
