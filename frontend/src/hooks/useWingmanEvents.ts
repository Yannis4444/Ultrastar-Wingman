import { useEffect, useRef } from "react";

/**
 * Message the backend sends over `/api/v1/ws`: flat JSON with an `event`
 * discriminator, the payload fields alongside it (e.g.
 * `{"event": "setting.changed", "key": "usdb.username", "value": "bob"}`).
 * Subscribers narrow the whole message by its event name.
 */
export interface WingmanEvent {
  event: string;
}

type Listener = (event: WingmanEvent) => void;

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

const listeners = new Map<string, Set<Listener>>();
let socket: WebSocket | null = null;
let reconnectDelay = RECONNECT_MIN_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

function socketUrl(): string {
  // Same origin as the page — the dev server proxies /api to the backend, so
  // no port is ever hardcoded here.
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/v1/ws`;
}

function dispatch(raw: string): void {
  let message: WingmanEvent;
  try {
    message = JSON.parse(raw) as WingmanEvent;
  } catch {
    console.warn("Ignoring unparseable Wingman event", raw);
    return;
  }
  for (const listener of listeners.get(message.event) ?? []) {
    listener(message);
  }
}

function connect(): void {
  if (socket) return;

  const ws = new WebSocket(socketUrl());
  socket = ws;

  ws.onopen = () => {
    reconnectDelay = RECONNECT_MIN_MS;
  };
  ws.onmessage = (event: MessageEvent<string>) => dispatch(event.data);
  ws.onerror = () => ws.close(); // onclose does the reconnecting
  ws.onclose = () => {
    if (socket !== ws) return; // superseded by a newer connection
    socket = null;
    if (listeners.size === 0) return;
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  };
}

function subscribe(event: string, listener: Listener): () => void {
  let forEvent = listeners.get(event);
  if (!forEvent) {
    forEvent = new Set();
    listeners.set(event, forEvent);
  }
  forEvent.add(listener);
  connect();

  return () => {
    forEvent.delete(listener);
    if (forEvent.size === 0) listeners.delete(event);
    if (listeners.size === 0) {
      clearTimeout(reconnectTimer);
      const ws = socket;
      socket = null;
      ws?.close();
    }
  };
}

/**
 * Subscribe to one backend event by name for the lifetime of the component.
 * The shared socket is opened on the first subscription and closed when the
 * last one goes away; drops are retried with exponential backoff.
 */
export function useWingmanEvent<T extends WingmanEvent>(
  event: string,
  handler: (message: T) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(
    () => subscribe(event, (message) => handlerRef.current(message as T)),
    [event],
  );
}
