"use client";

import { PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Mode = "loading" | "home" | "pair" | "control" | "receiver";
type LinkState = "idle" | "waiting" | "connecting" | "connected" | "offline";
type BridgeState = "missing" | "detected" | "connected" | "error";
type LocalRequestInit = RequestInit & { targetAddressSpace?: "loopback" };
type SafeDisplayMediaOptions = DisplayMediaStreamOptions & {
  selfBrowserSurface?: "exclude" | "include";
  monitorTypeSurfaces?: "exclude" | "include";
  surfaceSwitching?: "exclude" | "include";
  preferCurrentTab?: boolean;
};
type PenColor = "#ef3340" | "#2563eb" | "#111827";
type PenWidth = 3 | 7 | 12;
type BoardMode = "transparent" | "white" | "black";
type StrokePoint = { x: number; y: number };
type DrawingStroke = { id: string; color: PenColor; width: PenWidth; points: StrokePoint[] };
type DevicePresence = { deviceId: string; name: string; platform: string };
type RemoteMessage =
  | { type: "pointer"; x: number; y: number; dx?: number; dy?: number; relative?: boolean }
  | { type: "slide"; direction: 1 | -1 }
  | { type: "laser"; active: boolean }
  | { type: "blackout"; active: boolean }
  | { type: "presentation"; action: "start" | "stop" }
  | { type: "pen"; phase: "start" | "move" | "end"; id: string; x: number; y: number; color: PenColor; width: PenWidth; tool: "pen" | "eraser" }
  | { type: "board"; mode: BoardMode }
  | { type: "clear-drawing" }
  | ({ type: "device" } & DevicePresence);
type RelayPresence = { sentAt: number; device?: DevicePresence };

const ROOM_STORAGE = "presenta.remoteRoom";

function createRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function createConnectionId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatCode(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

function normalizeBridgePassword(value: string) {
  return value.replace(/[^A-Za-z2-9]/g, "").toUpperCase().slice(0, 8);
}

function formatBridgePassword(value: string) {
  const clean = normalizeBridgePassword(value);
  return clean.length > 4 ? `${clean.slice(0, 4)} ${clean.slice(4)}` : clean;
}

function statusLabel(state: LinkState) {
  if (state === "connected") return "Conectado";
  if (state === "connecting") return "Reconectando";
  if (state === "waiting") return "Esperando celular";
  if (state === "offline") return "Sin conexión";
  return "Listo";
}

function detectDevicePresence(): DevicePresence {
  const userAgent = navigator.userAgent;
  const androidModel = userAgent.match(/Android[^;]*;\s*(?:[a-z]{2}[-_][a-z]{2};\s*)?([^;)]+?)(?:\s+Build\/|\))/i)?.[1]?.trim();
  const platform = /Android/i.test(userAgent) ? "Android" : /iPhone|iPad/i.test(userAgent) ? "iOS" : navigator.platform || "Dispositivo móvil";
  let deviceId = window.localStorage.getItem("presenta.deviceId");
  if (!deviceId) {
    deviceId = createConnectionId();
    window.localStorage.setItem("presenta.deviceId", deviceId);
  }
  return { deviceId, name: androidModel || (/iPhone/i.test(userAgent) ? "iPhone" : /iPad/i.test(userAgent) ? "iPad" : platform), platform };
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("loading");
  const [room, setRoom] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [linkState, setLinkState] = useState<LinkState>("idle");
  const [slide, setSlide] = useState(1);
  const [laser, setLaser] = useState(false);
  const [blackout, setBlackout] = useState(false);
  const [interactionMode, setInteractionMode] = useState<"pointer" | "pen">("pointer");
  const [penColor, setPenColor] = useState<PenColor>("#ef3340");
  const [penWidth, setPenWidth] = useState<PenWidth>(7);
  const [penTool, setPenTool] = useState<"pen" | "eraser">("pen");
  const [boardMode, setBoardMode] = useState<BoardMode>("transparent");
  const [remoteDevice, setRemoteDevice] = useState<(DevicePresence & { lastSeen: Date }) | null>(null);
  const [localDeviceName, setLocalDeviceName] = useState("Este celular");
  const [pointer, setPointer] = useState({ x: 0.5, y: 0.5 });
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState("");
  const [bridgeState, setBridgeState] = useState<BridgeState>("missing");
  const [bridgeInput, setBridgeInput] = useState("");
  const [showBridgeDialog, setShowBridgeDialog] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const relayRoomRef = useRef("");
  const relayQueueRef = useRef<RemoteMessage[]>([]);
  const relayFlushTimerRef = useRef<number | null>(null);
  const relayFlushingRef = useRef(false);
  const bridgeCodeRef = useRef("");
  const pointerFrame = useRef<number | null>(null);
  const pointerPositionRef = useRef({ x: 0.5, y: 0.5 });
  const pendingPointer = useRef({ x: 0.5, y: 0.5, dx: 0, dy: 0 });
  const lastPointerSample = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const activeStrokeIdRef = useRef<string | null>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingFrameRef = useRef<number | null>(null);
  const strokesRef = useRef<DrawingStroke[]>([]);
  const boardModeRef = useRef<BoardMode>("transparent");
  const devicePresenceRef = useRef<DevicePresence>({ deviceId: "pending", name: "Este celular", platform: "Móvil" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const presentationRef = useRef<HTMLDivElement | null>(null);

  const renderDrawing = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (boardModeRef.current !== "transparent") {
      context.fillStyle = boardModeRef.current === "white" ? "#fffefa" : "#101318";
      context.fillRect(0, 0, width, height);
    }
    context.lineCap = "round";
    context.lineJoin = "round";
    for (const stroke of strokesRef.current) {
      if (!stroke.points.length) continue;
      context.beginPath();
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
      for (let index = 1; index < stroke.points.length; index += 1) {
        context.lineTo(stroke.points[index].x * width, stroke.points[index].y * height);
      }
      if (stroke.points.length === 1) context.lineTo(stroke.points[0].x * width + 0.01, stroke.points[0].y * height + 0.01);
      context.stroke();
    }
  }, []);

  const scheduleDrawingRender = useCallback(() => {
    if (drawingFrameRef.current !== null) return;
    drawingFrameRef.current = window.requestAnimationFrame(() => {
      drawingFrameRef.current = null;
      renderDrawing();
    });
  }, [renderDrawing]);

  useEffect(() => {
    devicePresenceRef.current = detectDevicePresence();
    setLocalDeviceName(devicePresenceRef.current.name);
    const isAndroid = /Android/i.test(navigator.userAgent);
    const remoteRequested = new URL(window.location.href).searchParams.get("remote") === "1";
    const installed = window.matchMedia("(display-mode: standalone)").matches;
    const remoteDevice = isAndroid || remoteRequested || (installed && navigator.maxTouchPoints > 0);
    if (remoteDevice) {
      const savedRoom = window.localStorage.getItem(ROOM_STORAGE) ?? "";
      if (/^\d{6}$/.test(savedRoom)) {
        setRoom(savedRoom);
        setRoomInput(savedRoom);
        setMode("control");
      } else {
        setMode("pair");
      }
    } else {
      setMode("home");
    }

    setOnline(navigator.onLine);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener("beforeinstallprompt", onInstall);
    const savedBridgeCode = window.localStorage.getItem("presenta.bridgeCode") ?? "";
    if (/^[A-Z2-9]{8}$/.test(savedBridgeCode)) {
      bridgeCodeRef.current = savedBridgeCode;
      setBridgeInput(savedBridgeCode);
    }
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = screenStream;
  }, [screenStream]);

  useEffect(() => {
    if (mode !== "receiver" || !presentationRef.current) return;
    const observer = new ResizeObserver(() => renderDrawing());
    observer.observe(presentationRef.current);
    renderDrawing();
    return () => observer.disconnect();
  }, [mode, renderDrawing]);

  const forwardToBridge = useCallback((message: RemoteMessage | { type: "ping" }) => {
    const code = bridgeCodeRef.current;
    if (!code) return Promise.resolve(false);
    const options: LocalRequestInit = {
      method: "POST",
      mode: "cors",
      targetAddressSpace: "loopback",
      headers: { "content-type": "application/json", "X-Presenta-Code": code },
      body: JSON.stringify(message),
    };
    return fetch("http://127.0.0.1:51794/command", options)
      .then((response) => {
        setBridgeState(response.ok || response.status !== 401 ? "connected" : "error");
        return response.ok;
      })
      .catch(() => {
        setBridgeState("missing");
        return false;
      });
  }, []);

  const applyDrawingMessage = useCallback((message: Extract<RemoteMessage, { type: "pen" | "board" | "clear-drawing" }>) => {
    if (message.type === "board") {
      boardModeRef.current = message.mode;
      setBoardMode(message.mode);
      scheduleDrawingRender();
      return;
    }
    if (message.type === "clear-drawing") {
      strokesRef.current = [];
      scheduleDrawingRender();
      return;
    }
    if (message.tool === "eraser") {
      if (message.phase === "end") return;
      const radius = message.width === 3 ? 0.018 : message.width === 7 ? 0.032 : 0.052;
      strokesRef.current = strokesRef.current.filter((stroke) => !stroke.points.some((point) => Math.hypot(point.x - message.x, point.y - message.y) <= radius));
      scheduleDrawingRender();
      return;
    }
    if (message.phase === "start") {
      strokesRef.current.push({ id: message.id, color: message.color, width: message.width, points: [{ x: message.x, y: message.y }] });
    } else if (message.phase === "move") {
      const stroke = strokesRef.current.find((item) => item.id === message.id);
      if (stroke) stroke.points.push({ x: message.x, y: message.y });
    }
    scheduleDrawingRender();
  }, [scheduleDrawingRender]);

  const receiveMessage = useCallback((message: RemoteMessage) => {
    if (message.type === "pointer") {
      const next = { x: message.x, y: message.y };
      pointerPositionRef.current = next;
      setPointer(next);
    }
    if (message.type === "slide") setSlide((current) => Math.max(1, current + message.direction));
    if (message.type === "laser") setLaser(message.active);
    if (message.type === "blackout") setBlackout(message.active);
    if (message.type === "device") setRemoteDevice({ deviceId: message.deviceId, name: message.name, platform: message.platform, lastSeen: new Date() });
    if (message.type === "pen" || message.type === "board" || message.type === "clear-drawing") applyDrawingMessage(message);
    void forwardToBridge(message);
  }, [applyDrawingMessage, forwardToBridge]);

  useEffect(() => {
    if (mode !== "receiver") return;
    let stopped = false;
    let timer: number | undefined;
    const checkBridge = async () => {
      try {
        const options: LocalRequestInit = { method: "GET", mode: "cors", cache: "no-store", targetAddressSpace: "loopback" };
        const response = await fetch("http://127.0.0.1:51794/health", options);
        if (!stopped) {
          if (!response.ok) setBridgeState("missing");
          else if (bridgeCodeRef.current) await forwardToBridge({ type: "ping" });
          else setBridgeState("detected");
        }
      } catch {
        if (!stopped) setBridgeState("missing");
      } finally {
        if (!stopped) timer = window.setTimeout(checkBridge, 3000);
      }
    };
    void checkBridge();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [forwardToBridge, mode]);

  const flushRelayQueue = useCallback(() => {
    if (relayFlushTimerRef.current !== null) {
      window.clearTimeout(relayFlushTimerRef.current);
      relayFlushTimerRef.current = null;
    }
    if (relayFlushingRef.current) return;

    const sendBatch = async () => {
      const activeRoom = relayRoomRef.current;
      const messages = relayQueueRef.current.splice(0, 60);
      if (!activeRoom || messages.length === 0) return;
      relayFlushingRef.current = true;
      let retryDelay = 35;
      try {
        const response = await fetch("/api/signal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room: activeRoom, role: "controller", kind: "commands", payload: messages }),
        });
        if (!response.ok) throw new Error("relay_unavailable");
      } catch {
        relayQueueRef.current.unshift(...messages);
        setLinkState("offline");
        retryDelay = 900;
      } finally {
        relayFlushingRef.current = false;
        if (relayQueueRef.current.length > 0 && relayFlushTimerRef.current === null) {
          relayFlushTimerRef.current = window.setTimeout(() => {
            relayFlushTimerRef.current = null;
            void sendBatch();
          }, retryDelay);
        }
      }
    };
    void sendBatch();
  }, []);

  useEffect(() => {
    relayRoomRef.current = room;
    if (!room || (mode !== "control" && mode !== "receiver")) return;
    let stopped = false;
    let lastSignalId = 0;
    let lastRemoteSeen = 0;
    let polling = false;
    let pollTimer: number | undefined;
    let presenceTimer: number | undefined;
    let watchdogTimer: number | undefined;
    const role = mode === "receiver" ? "receiver" : "controller";
    const postPresence = async () => {
      const payload: RelayPresence = {
        sentAt: Date.now(),
        ...(role === "controller" ? { device: devicePresenceRef.current } : {}),
      };
      try {
        const response = await fetch("/api/signal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room, role, kind: "presence", payload }),
        });
        if (!response.ok) throw new Error("presence_unavailable");
      } catch {
        if (!stopped) setLinkState("offline");
      }
    };

    const handleRelaySignal = (signal: { id: number; kind: string; payload: string }) => {
      if (signal.kind === "presence") {
        const presence = JSON.parse(signal.payload) as RelayPresence;
        lastRemoteSeen = Date.now();
        setLinkState("connected");
        if (role === "receiver" && presence.device) {
          receiveMessage({ type: "device", ...presence.device });
        }
        return;
      }
      if (signal.kind === "commands" && role === "receiver") {
        const messages = JSON.parse(signal.payload) as RemoteMessage[];
        lastRemoteSeen = Date.now();
        setLinkState("connected");
        for (const message of messages) receiveMessage(message);
      }
    };

    const poll = async () => {
      if (polling || stopped) return;
      polling = true;
      try {
        const response = await fetch(`/api/signal?room=${room}&role=${role}&after=${lastSignalId}`, { cache: "no-store" });
        if (!response.ok) throw new Error("poll_unavailable");
        const data = await response.json() as { signals: Array<{ id: number; kind: string; payload: string }> };
        for (const signal of data.signals) {
          lastSignalId = Math.max(lastSignalId, signal.id);
          try { handleRelaySignal(signal); } catch { /* Descarta un paquete incompleto y continúa. */ }
        }
      } catch {
        if (!stopped) setLinkState("offline");
      } finally {
        polling = false;
        if (!stopped) pollTimer = window.setTimeout(poll, document.visibilityState === "visible" ? 220 : 900);
      }
    };

    const wake = () => {
      if (document.visibilityState !== "visible") return;
      setLinkState("connecting");
      void postPresence();
      if (pollTimer) window.clearTimeout(pollTimer);
      void poll();
      if (role === "controller") void flushRelayQueue();
    };

    const start = async () => {
      setLinkState(role === "receiver" ? "waiting" : "connecting");
      if (role === "receiver") await fetch(`/api/signal?room=${room}&role=receiver`, { method: "DELETE" }).catch(() => undefined);
      if (stopped) return;
      await postPresence();
      presenceTimer = window.setInterval(() => void postPresence(), 1800);
      watchdogTimer = window.setInterval(() => {
        if (lastRemoteSeen && Date.now() - lastRemoteSeen > 6500) setLinkState(role === "receiver" ? "waiting" : "connecting");
      }, 1200);
      await poll();
    };

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("pageshow", wake);
    void start();

    return () => {
      stopped = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      if (presenceTimer) window.clearInterval(presenceTimer);
      if (watchdogTimer) window.clearInterval(watchdogTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("pageshow", wake);
      relayQueueRef.current = [];
      if (relayFlushTimerRef.current !== null) {
        window.clearTimeout(relayFlushTimerRef.current);
        relayFlushTimerRef.current = null;
      }
    };
  }, [flushRelayQueue, mode, receiveMessage, room]);

  const sendRemote = useCallback((message: RemoteMessage) => {
    if (message.type === "pointer") {
      const pending = relayQueueRef.current[relayQueueRef.current.length - 1];
      if (pending?.type === "pointer" && pending.relative && message.relative) {
        pending.dx = (pending.dx ?? 0) + (message.dx ?? 0);
        pending.dy = (pending.dy ?? 0) + (message.dy ?? 0);
        pending.x = message.x;
        pending.y = message.y;
      } else {
        relayQueueRef.current.push(message);
      }
    } else {
      relayQueueRef.current.push(message);
    }
    const immediate = message.type === "slide" || message.type === "laser" || message.type === "blackout" || message.type === "presentation" || message.type === "board" || message.type === "clear-drawing";
    if (immediate) void flushRelayQueue();
    else if (relayFlushTimerRef.current === null) relayFlushTimerRef.current = window.setTimeout(() => void flushRelayQueue(), 55);
  }, [flushRelayQueue]);

  const joinRoom = () => {
    const normalized = roomInput.replace(/\D/g, "");
    if (normalized.length !== 6) {
      setToast("Escribe los seis números de la sala");
      return;
    }
    window.localStorage.setItem(ROOM_STORAGE, normalized);
    setRoom(normalized);
    setMode("control");
  };

  const startPresentation = () => {
    setRoom(createRoomCode());
    setLinkState("idle");
    setMode("receiver");
  };

  const returnToLanding = () => {
    screenStream?.getTracks().forEach((track) => track.stop());
    setScreenStream(null);
    setRoom("");
    setLinkState("idle");
    setMode("home");
  };

  const changeRoom = () => {
    window.localStorage.removeItem(ROOM_STORAGE);
    setRoom("");
    setRoomInput("");
    setLinkState("idle");
    setMode("pair");
  };

  const changeSlide = (direction: 1 | -1) => {
    setSlide((current) => Math.max(1, current + direction));
    sendRemote({ type: "slide", direction });
    if (navigator.vibrate) navigator.vibrate(35);
  };

  const toggleLaser = () => {
    const active = !laser;
    setLaser(active);
    if (active) setInteractionMode("pointer");
    sendRemote({ type: "laser", active });
  };

  const togglePen = () => {
    const active = interactionMode !== "pen";
    setInteractionMode(active ? "pen" : "pointer");
    if (active && laser) {
      setLaser(false);
      sendRemote({ type: "laser", active: false });
    }
  };

  const selectBoard = (nextMode: BoardMode) => {
    setBoardMode(nextMode);
    boardModeRef.current = nextMode;
    if (nextMode === "black" && penColor === "#111827") setPenColor("#ef3340");
    setInteractionMode("pen");
    sendRemote({ type: "board", mode: nextMode });
  };

  const clearDrawing = () => {
    sendRemote({ type: "clear-drawing" });
    setToast("Anotaciones borradas");
  };

  const toggleBlackout = () => {
    const active = !blackout;
    setBlackout(active);
    sendRemote({ type: "blackout", active });
  };

  const startPointer = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    lastPointerSample.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    if (interactionMode === "pen") {
      const bounds = event.currentTarget.getBoundingClientRect();
      const point = {
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      };
      const strokeId = createConnectionId();
      activeStrokeIdRef.current = strokeId;
      pointerPositionRef.current = point;
      setPointer(point);
      sendRemote({ type: "pen", phase: "start", id: strokeId, ...point, color: penColor, width: penWidth, tool: penTool });
    }
  };

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    const previous = lastPointerSample.current;
    if (!previous || previous.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (interactionMode === "pen") {
      lastPointerSample.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      const point = {
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
      };
      pointerPositionRef.current = point;
      setPointer(point);
      if (activeStrokeIdRef.current) sendRemote({ type: "pen", phase: "move", id: activeStrokeIdRef.current, ...point, color: penColor, width: penWidth, tool: penTool });
      return;
    }
    const pixelX = event.clientX - previous.x;
    const pixelY = event.clientY - previous.y;
    lastPointerSample.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    const acceleration = 0.72 + Math.min(0.95, Math.hypot(pixelX, pixelY) / 22);
    const dx = Math.max(-0.12, Math.min(0.12, (pixelX / bounds.width) * 1.35 * acceleration));
    const dy = Math.max(-0.12, Math.min(0.12, (pixelY / bounds.height) * 1.35 * acceleration));
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return;
    const next = {
      x: Math.max(0, Math.min(1, pointerPositionRef.current.x + dx)),
      y: Math.max(0, Math.min(1, pointerPositionRef.current.y + dy)),
    };
    pointerPositionRef.current = next;
    setPointer(next);
    pendingPointer.current.x = next.x;
    pendingPointer.current.y = next.y;
    pendingPointer.current.dx += dx;
    pendingPointer.current.dy += dy;
    if (pointerFrame.current === null) {
      pointerFrame.current = window.requestAnimationFrame(() => {
        const update = { ...pendingPointer.current };
        pendingPointer.current.dx = 0;
        pendingPointer.current.dy = 0;
        sendRemote({ type: "pointer", ...update, relative: true });
        pointerFrame.current = null;
      });
    }
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (interactionMode === "pen" && activeStrokeIdRef.current) {
      const bounds = event.currentTarget.getBoundingClientRect();
      sendRemote({
        type: "pen",
        phase: "end",
        id: activeStrokeIdRef.current,
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
        color: penColor,
        width: penWidth,
        tool: penTool,
      });
      activeStrokeIdRef.current = null;
    }
    if (lastPointerSample.current?.pointerId === event.pointerId) lastPointerSample.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const promptInstall = async () => {
    if (!installEvent) {
      setToast("En Chrome, abre el menú y elige ‘Instalar aplicación’");
      return;
    }
    const prompt = installEvent as Event & { prompt: () => Promise<void> };
    await prompt.prompt();
    setInstallEvent(null);
  };

  const copyCode = async () => {
    await navigator.clipboard?.writeText(room);
    setToast("Código copiado");
  };

  const startScreenShare = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setToast("Este navegador no permite elegir una pantalla");
      return;
    }
    try {
      screenStream?.getTracks().forEach((track) => track.stop());
      const options: SafeDisplayMediaOptions = {
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: false,
        selfBrowserSurface: "exclude",
        monitorTypeSurfaces: "exclude",
        surfaceSwitching: "include",
        preferCurrentTab: false,
      };
      const stream = await navigator.mediaDevices.getDisplayMedia(options);
      const track = stream.getVideoTracks()[0];
      if (track?.getSettings().displaySurface === "monitor") {
        stream.getTracks().forEach((item) => item.stop());
        setToast("Para evitar el efecto espejo, elige Ventana y después PowerPoint");
        return;
      }
      if (track) track.addEventListener("ended", () => setScreenStream(null), { once: true });
      setScreenStream(stream);
      setToast("Ventana lista para presentar");
    } catch {
      setToast("No se seleccionó ninguna pantalla");
    }
  };

  const stopScreenShare = () => {
    screenStream?.getTracks().forEach((track) => track.stop());
    setScreenStream(null);
  };

  const enterFullscreen = async () => {
    if (!presentationRef.current) return;
    await presentationRef.current.requestFullscreen?.();
  };

  const controlPowerPoint = async (action: "start" | "stop") => {
    if (!bridgeCodeRef.current || bridgeState !== "connected") {
      setShowBridgeDialog(true);
      setToast("Conecta Presenta Bridge para controlar PowerPoint");
      return;
    }
    const sent = await forwardToBridge({ type: "presentation", action });
    setToast(sent ? (action === "start" ? "PowerPoint inició la presentación" : "Presentación detenida") : "Abre PowerPoint y vuelve a intentarlo");
  };

  const connectBridge = async () => {
    const code = normalizeBridgePassword(bridgeInput);
    if (!/^[A-Z2-9]{8}$/.test(code)) {
      setToast("Escribe la contraseña de ocho caracteres del Bridge");
      return;
    }
    bridgeCodeRef.current = code;
    window.localStorage.setItem("presenta.bridgeCode", code);
    const connected = await forwardToBridge({ type: "ping" });
    if (connected) {
      await forwardToBridge({ type: "laser", active: laser });
      await forwardToBridge({ type: "blackout", active: blackout });
      setShowBridgeDialog(false);
      setToast("Presenta Bridge conectado");
    } else {
      setToast("No se encontró el Bridge o el código no coincide");
    }
  };

  const bridgeLabel = bridgeState === "connected" ? "Bridge conectado" : bridgeState === "detected" ? "Bridge detectado" : bridgeState === "error" ? "Código incorrecto" : "Conectar Bridge";

  if (mode === "loading") return <main className="app-shell mode-loading"><div className="brand-mark" aria-hidden="true"><span /></div></main>;

  return (
    <main className={`app-shell mode-${mode}`}>
      {mode === "home" && (
        <section className="landing-view">
          <header className="desktop-header landing-header">
            <div className="brand"><span className="brand-mark" aria-hidden="true"><span /></span><span>Presenta</span></div>
            <div className="landing-nav">
              <span>PWA · computadora + celular</span>
              <Link href="/?remote=1">Abrir en el celular</Link>
            </div>
          </header>

          <div className="landing-hero">
            <div className="landing-copy">
              <span className="eyebrow">CONTROL REMOTO PARA PRESENTACIONES</span>
              <h1>Presenta con libertad.<br /><em>Tu celular lleva el control.</em></h1>
              <p>Abre Presenta en la computadora y en el celular, escribe el código de seis dígitos y controla diapositivas, láser y lápiz mediante Internet.</p>
              <div className="landing-actions">
                <button className="landing-primary" onClick={startPresentation}>Iniciar presentación <span>→</span></button>
                <Link href="/?remote=1">Abrir control del celular</Link>
              </div>
              <div className="landing-trust"><span><i />Sin Bluetooth</span><span><i />Sin instalar APK</span><span><i />Reconexión automática</span></div>
            </div>

            <div className="landing-product" aria-label="Vista previa de Presenta">
              <div className="product-window">
                <div className="product-window-bar"><span /><span /><span /><b>Presenta</b><small>Conectado</small></div>
                <div className="product-stage">
                  <div className="product-slide"><small>PRESENTA / EN VIVO</small><strong>Tu idea,<br />en pantalla.</strong><i /></div>
                  <div className="product-remote">
                  <div><span>CONTROL PWA</span><b>847 291</b></div>
                    <div className="remote-pad"><i /></div>
                    <div className="remote-buttons"><span>←</span><strong>12</strong><span>→</span></div>
                  </div>
                </div>
              </div>
              <div className="landing-code-card"><span>CÓDIGO DE CONEXIÓN</span><strong>847 291</strong><small>Relay de Internet listo</small></div>
            </div>
          </div>

          <div className="landing-steps">
            <article><span>01</span><div><strong>Elige qué presentar</strong><p>Una pantalla, una ventana de PowerPoint o una pestaña.</p></div></article>
            <article><span>02</span><div><strong>Abre la PWA móvil</strong><p>En el celular abre este mismo sitio y escribe el código de seis dígitos.</p></div></article>
            <article><span>03</span><div><strong>Controla por Internet</strong><p>Avanza, señala y dibuja aunque los dispositivos estén en redes distintas.</p></div></article>
          </div>
        </section>
      )}

      {mode === "pair" && (
        <section className="pair-view remote-only-view">
          <div className="remote-brand"><span className="brand-mark" aria-hidden="true"><span /></span><strong>Presenta</strong><small>Control Android</small></div>
          <div className="pair-panel">
            <span className="step-pill">CONECTAR POR INTERNET</span>
            <h1>Escribe el código de la laptop</h1>
            <p>La computadora mostrará seis números. La PWA enviará los controles por Internet y recordará esta sala.</p>
            <label htmlFor="room-code">Código de seis dígitos</label>
            <input id="room-code" inputMode="numeric" autoComplete="one-time-code" value={formatCode(roomInput)} onChange={(event) => setRoomInput(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000 000" autoFocus />
            <button className="primary-button" onClick={joinRoom}>Abrir control <span>→</span></button>
            <button className="install-control" onClick={promptInstall}>Instalar este control en el celular</button>
            <small>Sólo se envían las órdenes del control; el contenido de la presentación permanece en tu computadora.</small>
          </div>
        </section>
      )}

      {mode === "control" && (
        <section className="controller-view remote-only-view">
          <div className="controller-heading">
            <div><span className="eyebrow">PRESENTA · CONTROL</span><h1>Sala {formatCode(room)}</h1></div>
            <span className={`link-pill state-${linkState}`}><i />{statusLabel(linkState)}</span>
          </div>
          <div className="mobile-identity"><span>Este dispositivo</span><strong>{localDeviceName}</strong><small>{linkState === "connected" ? "Conectado por Internet con la computadora" : "Buscando la sala por Internet"}</small></div>

          <div className="touch-area" onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer}>
            <span className="touch-grid" aria-hidden="true" />
            <span className="finger-dot" style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} />
            <span className="touch-instruction">{interactionMode === "pen" ? (penTool === "eraser" ? "Desliza sobre un trazo para borrarlo" : "Escribe aquí para dibujar en la presentación") : "Úsalo como trackpad: desliza varias veces para recorrer la pantalla"}</span>
          </div>

          <div className="tool-row">
            <button className={laser ? "is-active" : ""} onClick={toggleLaser}><i className="laser-icon" />Láser</button>
            <button className={interactionMode === "pen" ? "is-active" : ""} onClick={togglePen}><i className="pen-icon" />Lápiz</button>
            <button className={blackout ? "is-active blackout-active" : ""} onClick={toggleBlackout}><i className="screen-icon" />Pantalla negra</button>
          </div>

          {interactionMode === "pen" && (
            <div className="pen-panel">
              <div className="pen-section board-options"><span>Superficie</span><div>
                <button className={boardMode === "transparent" ? "is-selected" : ""} onClick={() => selectBoard("transparent")}>Pantalla</button>
                <button className={boardMode === "white" ? "is-selected" : ""} onClick={() => selectBoard("white")}>Blanca</button>
                <button className={boardMode === "black" ? "is-selected dark-board" : ""} onClick={() => selectBoard("black")}>Negra</button>
              </div></div>
              <div className="pen-settings">
                <div className="pen-section"><span>Color</span><div className="color-options">
                  {(["#ef3340", "#2563eb", "#111827"] as PenColor[]).map((color) => <button key={color} className={penColor === color && penTool === "pen" ? "is-selected" : ""} style={{ "--pen-color": color } as React.CSSProperties} onClick={() => { setPenColor(color); setPenTool("pen"); }} aria-label={color === "#ef3340" ? "Rojo" : color === "#2563eb" ? "Azul" : "Negro"} />)}
                </div></div>
                <div className="pen-section"><span>Grosor</span><div className="width-options">
                  {([3, 7, 12] as PenWidth[]).map((width) => <button key={width} className={penWidth === width ? "is-selected" : ""} onClick={() => setPenWidth(width)} aria-label={`Grosor ${width}`}><i style={{ width, height: width }} /></button>)}
                </div></div>
                <div className="pen-actions"><button className={penTool === "eraser" ? "is-selected" : ""} onClick={() => setPenTool(penTool === "eraser" ? "pen" : "eraser")}><i className="eraser-icon" />Borrador</button><button onClick={clearDrawing}>Limpiar</button></div>
              </div>
            </div>
          )}

          <div className="slide-controls">
            <button onClick={() => changeSlide(-1)} aria-label="Diapositiva anterior">←</button>
            <div><strong>{slide}</strong><span>diapositiva</span></div>
            <button className="next-button" onClick={() => changeSlide(1)} aria-label="Diapositiva siguiente">→</button>
          </div>
          <button className="change-room" onClick={changeRoom}>Cambiar código de conexión</button>
          {linkState !== "connected" && <p className="reconnect-note">Puedes bloquear el teléfono. Al volver, Presenta intentará reconectarse automáticamente.</p>}
        </section>
      )}

      {mode === "receiver" && (
        <section className="receiver-view">
          <header className="desktop-header">
            <div className="brand"><span className="brand-mark" aria-hidden="true"><span /></span><span>Presenta</span></div>
            <div className="desktop-header-actions"><span className={`network ${online ? "is-online" : ""}`}><i />{online ? "En línea" : "Sin red"}</span><button className="quiet-button" onClick={returnToLanding}>Inicio</button></div>
          </header>
          <div className="receiver-toolbar">
            <div className="room-code-block"><span>CÓDIGO PARA EL CELULAR</span><button onClick={copyCode}>{formatCode(room)} <small>Copiar</small></button></div>
            <div className="receiver-status">
              <button className={`bridge-button bridge-${bridgeState}`} onClick={() => setShowBridgeDialog(true)}><i />{bridgeLabel}</button>
              <span className={`link-pill state-${linkState}`}><i />{statusLabel(linkState)}</span>
            </div>
          </div>

          <div className="connection-overview" aria-label="Estado de conexiones">
            <div className={`connection-device ${remoteDevice && linkState === "connected" ? "is-connected" : ""}`}><i /><span>Celular</span><strong>{remoteDevice?.name ?? "Esperando conexión"}</strong><small>{remoteDevice ? `${remoteDevice.platform} · última señal ${remoteDevice.lastSeen.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Escribe el código de la sala en la PWA"}</small></div>
            <div className={`connection-device ${online ? "is-connected" : ""}`}><i /><span>Canal de Internet</span><strong>{online ? "Relay activo" : "Sin Internet"}</strong><small>{online ? "Recibe controles aunque el celular use otra red" : "Conecta esta computadora a Internet"}</small></div>
          </div>

          <div className="screen-share-controls">
            <button className="share-button" onClick={startScreenShare}>{screenStream ? "Cambiar ventana" : "Elegir ventana de PowerPoint"}</button>
            {screenStream && <button onClick={enterFullscreen}>Presentar en pantalla completa</button>}
            {screenStream && <button className="stop-share" onClick={stopScreenShare}>Dejar de compartir</button>}
          </div>

          <div className="powerpoint-guide">
            <div><strong>Para PowerPoint</strong><span>Abre tu archivo y, en el selector, elige <b>Ventana → PowerPoint</b>. El Bridge sólo es opcional para enviar teclas directamente a PowerPoint.</span></div>
            <div className="powerpoint-actions"><button onClick={() => void controlPowerPoint("start")}>Iniciar diapositivas</button><button onClick={() => void controlPowerPoint("stop")}>Finalizar</button></div>
          </div>

          <div ref={presentationRef} className={`presentation-canvas board-${boardMode} ${screenStream ? "has-share" : ""} ${blackout ? "is-blackout" : ""}`}>
            {screenStream ? (
              <video ref={videoRef} className="shared-screen" autoPlay muted playsInline />
            ) : (
              <div className="presentation-empty">
                <span className="empty-screen-icon" aria-hidden="true" />
                <h1>Elige la ventana de PowerPoint</h1>
                <p>Selecciona <b>Ventana</b> y después PowerPoint. Presenta excluye su propia pantalla para evitar el efecto espejo.</p>
                <button className="primary-button" onClick={startScreenShare}>Elegir ventana <span>→</span></button>
              </div>
            )}
            <canvas ref={drawingCanvasRef} className="drawing-canvas" aria-label="Anotaciones de Presenta" />
            <div className={`laser-pointer ${laser ? "" : "is-hidden"}`} style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} />
            {blackout && <div className="blackout-message">Pantalla en pausa</div>}
          </div>
          <p className="receiver-hint">Mantén esta vista abierta. Presenta restablece automáticamente el enlace cuando el celular vuelve a estar disponible.</p>
        </section>
      )}

      {showBridgeDialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowBridgeDialog(false); }}>
          <section className="bridge-dialog" role="dialog" aria-modal="true" aria-labelledby="bridge-title">
            <button className="dialog-close" onClick={() => setShowBridgeDialog(false)} aria-label="Cerrar">×</button>
            <span className="step-pill">WINDOWS · PRESENTA BRIDGE</span>
            <h2 id="bridge-title">Conecta el complemento</h2>
            <p>Abre Presenta Bridge en Windows y escribe la contraseña que aparece en su ventana. Puedes renovarla desde el propio Bridge.</p>
            <label htmlFor="bridge-code">Contraseña del Bridge</label>
            <input id="bridge-code" inputMode="text" autoCapitalize="characters" autoComplete="off" value={formatBridgePassword(bridgeInput)} onChange={(event) => setBridgeInput(normalizeBridgePassword(event.target.value))} placeholder="ABCD EFGH" autoFocus />
            <button className="primary-button" onClick={connectBridge}>Conectar Bridge <span>→</span></button>
            <a className="bridge-download" href="/downloads/PresentaBridgeSetup.exe" download>Descargar instalador para Windows</a>
            <small>El Bridge es opcional y sólo se usa para controlar directamente otras aplicaciones de Windows. La conexión entre las dos PWA funciona por Internet sin él.</small>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
