import { useEffect, useRef, useState, useCallback } from "react";
import type { WsMessage } from "../types";

const MAX_EVENTS_PER_TYPE = 50;
const MAX_TOTAL_EVENTS = 200;

export type SwarmEventHandler = (msg: WsMessage) => void;

interface UseSwarmEventsResult {
  connected: boolean;
  lastMessage: WsMessage | null;
  eventsByType: Map<string, WsMessage[]>;
  allEvents: WsMessage[];
  getEvents: (type: string, limit?: number) => WsMessage[];
  subscribe: (type: string, handler: SwarmEventHandler) => () => void;
}

export function useSwarmEvents(url?: string): UseSwarmEventsResult {
  const [connected, setConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsMessage | null>(null);
  const [allEvents, setAllEvents] = useState<WsMessage[]>([]);
  const [eventsByType, setEventsByType] = useState<Map<string, WsMessage[]>>(new Map());
  const subscribersRef = useRef<Map<string, Set<SwarmEventHandler>>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);

  const getEvents = useCallback((type: string, limit = 20): WsMessage[] => {
    return (eventsByType.get(type) || []).slice(-limit);
  }, [eventsByType]);

  const subscribe = useCallback((type: string, handler: SwarmEventHandler): () => void => {
    if (!subscribersRef.current.has(type)) {
      subscribersRef.current.set(type, new Set());
    }
    subscribersRef.current.get(type)!.add(handler);
    return () => subscribersRef.current.get(type)?.delete(handler);
  }, []);

  const handleMessage = useCallback((msg: WsMessage) => {
    setLastMessage(msg);

    setAllEvents(prev => {
      const next = [...prev, msg];
      return next.slice(-MAX_TOTAL_EVENTS);
    });

    setEventsByType(prev => {
      const next = new Map(prev);
      const existing = next.get(msg.type) || [];
      next.set(msg.type, [...existing, msg].slice(-MAX_EVENTS_PER_TYPE));
      return next;
    });

    // Notify type-specific subscribers
    const typeSubs = subscribersRef.current.get(msg.type);
    if (typeSubs) typeSubs.forEach(h => h(msg));
    // Notify wildcard subscribers
    const allSubs = subscribersRef.current.get("*");
    if (allSubs) allSubs.forEach(h => h(msg));
  }, []);

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
        handleMessage(msg);
      } catch { /* ignore */ }
    };
    wsRef.current = ws;
  }, [url, handleMessage]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  return { connected, lastMessage, eventsByType, allEvents, getEvents, subscribe };
}
