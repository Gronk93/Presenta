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
const RECEIVER_ROOM_STORAGE = "presenta.receiverRoom";
const REPLAYABLE_MESSAGE_TYPES = new Set<RemoteMessage["type"]>(["laser", "blackout", "board", "clear-drawing"]);

function isReplayableMessage(message: RemoteMessage) {
  return REPLAYABLE_MESSAGE_TYPES.has(message.type);
}

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
  const [frozen, setFrozen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [padActive, setPadActive] = useState(false);
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
  const [reconnectNonce, setReconnectNonce] = useState(0);
  const relayRoomRef = useRef("");
  const relayQueueRef = useRef<RemoteMessage[]>([]);
  const relayFlushTimerRef = useRef<number | null>(null);
  const relayFlushingRef = useRef(false);
  const bridgeCodeRef = useRef("");
  const pointerFrame = useRef<number | null>(null);
  const pointerPositionRef = useRef({ x: 0.5, y: 0.5 });
  const pointerTargetRef = useRef({ x: 0.5, y: 0.5 });
  const pointerSmoothingFrameRef = useRef<number | null>(null);
  const pendingPointer = useRef({ x: 0.5, y: 0.5 });
  const bridgePointerPendingRef = useRef<{ x: number; y: number } | null>(null);
  const bridgePointerFrameRef = useRef<number | null>(null);
  const bridgePointerInFlightRef = useRef(false);
  const lastPointerSample = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const activeStrokeIdRef = useRef<string | null>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mobileDrawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingFrameRef = useRef<number | null>(null);
  const strokesRef = useRef<DrawingStroke[]>([]);
  const boardModeRef = useRef<BoardMode>("transparent");
  const devicePresenceRef = useRef<DevicePresence>({ deviceId: "pending", name: "Este celular", platform: "Móvil" });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const presentationRef = useRef<HTMLDivElement | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const renderDrawing = useCallback(() => {
    const canvases = [drawingCanvasRef.current, mobileDrawingCanvasRef.current].filter((canvas): canvas is HTMLCanvasElement => canvas !== null);
    for (const canvas of canvases) {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (!width || !height) continue;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.round(width * ratio);
      const pixelHeight = Math.round(height * ratio);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      const context = canvas.getContext("2d");
      if (!context) continue;
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
      const savedReceiverRoom = window.localStorage.getItem(RECEIVER_ROOM_STORAGE) ?? "";
      if (/^\d{6}$/.test(savedReceiverRoom)) {
        setRoom(savedReceiverRoom);
        setLinkState("connecting");
        setMode("receiver");
      } else {
        setMode("home");
      }
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
    screenStreamRef.current = screenStream;
    if (videoRef.current) {
      videoRef.current.srcObject = screenStream;
      if (frozen) videoRef.current.pause();
      else void videoRef.current.play().catch(() => undefined);
    }
  }, [frozen, screenStream]);

  useEffect(() => {
    if (mode !== "receiver" || !presentationRef.current) return;
    const observer = new ResizeObserver(() => renderDrawing());
    observer.observe(presentationRef.current);
    renderDrawing();
    return () => observer.disconnect();
  }, [boardMode, mode, renderDrawing, screenStream]);

  useEffect(() => {
    if (mode !== "control" || !mobileDrawingCanvasRef.current) return;
    const canvas = mobileDrawingCanvasRef.current;
    const observer = new ResizeObserver(() => renderDrawing());
    observer.observe(canvas);
    renderDrawing();
    return () => observer.disconnect();
  }, [boardMode, interactionMode, mode, renderDrawing]);

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

  const smoothPointerTo = useCallback((next: { x: number; y: number }) => {
    pointerTargetRef.current = next;
    if (pointerSmoothingFrameRef.current !== null) return;
    let previousTime = performance.now();
    const animate = (now: number) => {
      const elapsed = Math.min(48, Math.max(1, now - previousTime));
      previousTime = now;
      const current = pointerPositionRef.current;
      const target = pointerTargetRef.current;
      const alpha = 1 - Math.exp(-elapsed / 38);
      const updated = {
        x: current.x + (target.x - current.x) * alpha,
        y: current.y + (target.y - current.y) * alpha,
      };
      const remaining = Math.hypot(target.x - updated.x, target.y - updated.y);
      if (remaining < 0.00015) {
        pointerPositionRef.current = target;
        setPointer(target);
        pointerSmoothingFrameRef.current = null;
        return;
      }
      pointerPositionRef.current = updated;
      setPointer(updated);
      pointerSmoothingFrameRef.current = window.requestAnimationFrame(animate);
    };
    pointerSmoothingFrameRef.current = window.requestAnimationFrame(animate);
  }, []);

  const scheduleBridgePointer = useCallback((next: { x: number; y: number }) => {
    bridgePointerPendingRef.current = next;
    if (bridgePointerInFlightRef.current || bridgePointerFrameRef.current !== null) return;
    const drain = () => {
      const latest = bridgePointerPendingRef.current;
      if (!latest || bridgePointerInFlightRef.current) return;
      bridgePointerPendingRef.current = null;
      bridgePointerInFlightRef.current = true;
      void forwardToBridge({ type: "pointer", ...latest }).finally(() => {
        bridgePointerInFlightRef.current = false;
        if (bridgePointerPendingRef.current && bridgePointerFrameRef.current === null) {
          bridgePointerFrameRef.current = window.requestAnimationFrame(() => {
            bridgePointerFrameRef.current = null;
            drain();
          });
        }
      });
    };
    bridgePointerFrameRef.current = window.requestAnimationFrame(() => {
      bridgePointerFrameRef.current = null;
      drain();
    });
  }, [forwardToBridge]);

  useEffect(() => () => {
    if (pointerFrame.current !== null) window.cancelAnimationFrame(pointerFrame.current);
    if (pointerSmoothingFrameRef.current !== null) window.cancelAnimationFrame(pointerSmoothingFrameRef.current);
    if (bridgePointerFrameRef.current !== null) window.cancelAnimationFrame(bridgePointerFrameRef.current);
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
      smoothPointerTo(next);
      // Conserva sólo la posición más reciente y envíala en serie. Así una
      // respuesta local atrasada no puede hacer retroceder el láser.
      if (!screenStreamRef.current) scheduleBridgePointer(next);
    }
    if (message.type === "slide") setSlide((current) => Math.max(1, current + message.direction));
    if (message.type === "laser") setLaser(message.active);
    if (message.type === "blackout") setFrozen(message.active);
    if (message.type === "presentation") setPresenting(message.action === "start");
    if (message.type === "device") setRemoteDevice({ deviceId: message.deviceId, name: message.name, platform: message.platform, lastSeen: new Date() });
    if (message.type === "pen" || message.type === "board" || message.type === "clear-drawing") applyDrawingMessage(message);
    const isVisualOverlay = message.type === "pointer" || message.type === "laser" || message.type === "blackout" || message.type === "pen" || message.type === "board" || message.type === "clear-drawing";
    if (message.type !== "pointer" && (!isVisualOverlay || !screenStreamRef.current)) void forwardToBridge(message);
  }, [applyDrawingMessage, forwardToBridge, scheduleBridgePointer, smoothPointerTo]);

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
      let retryDelay = 8;
      try {
        const response = await fetch("/api/signal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room: activeRoom, role: "controller", kind: "commands", payload: messages }),
        });
        if (!response.ok) throw new Error("relay_unavailable");
      } catch {
        // Los movimientos, trazos y cambios de diapositiva dejan de ser válidos
        // cuando llegan tarde. Sólo se conservan estados que sí deben restaurarse.
        relayQueueRef.current.unshift(...messages.filter(isReplayableMessage));
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
    let consecutiveFailures = 0;
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
        consecutiveFailures = 0;
        const data = await response.json() as { signals: Array<{ id: number; kind: string; payload: string }> };
        for (const signal of data.signals) {
          lastSignalId = Math.max(lastSignalId, signal.id);
          try { handleRelaySignal(signal); } catch { /* Descarta un paquete incompleto y continúa. */ }
        }
      } catch {
        consecutiveFailures += 1;
        if (!stopped) setLinkState("offline");
      } finally {
        polling = false;
        if (!stopped) {
          const retryDelay = consecutiveFailures > 0
            ? Math.min(3200, 300 * (2 ** Math.min(consecutiveFailures - 1, 4)))
            : document.visibilityState === "visible" ? 32 : 1100;
          pollTimer = window.setTimeout(poll, retryDelay);
        }
      }
    };

    const wake = () => {
      if (document.visibilityState !== "visible") return;
      setLinkState("connecting");
      consecutiveFailures = 0;
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
  }, [flushRelayQueue, mode, receiveMessage, reconnectNonce, room]);

  const sendRemote = useCallback((message: RemoteMessage) => {
    if ((!navigator.onLine || linkState === "offline") && !isReplayableMessage(message)) {
      setToast("Sin Internet: la orden no se guardó para evitar que se ejecute tarde");
      return;
    }
    if (isReplayableMessage(message)) {
      relayQueueRef.current = relayQueueRef.current.filter((queued) => queued.type !== message.type);
    }
    if (message.type === "pointer") {
      // Un movimiento atrasado ya no aporta información. Mantener sólo la
      // posición absoluta más reciente evita colas y recorridos repetidos.
      relayQueueRef.current = relayQueueRef.current.filter((queued) => queued.type !== "pointer");
      relayQueueRef.current.push({ type: "pointer", x: message.x, y: message.y });
    } else {
      relayQueueRef.current.push(message);
    }
    const immediate = message.type === "slide" || message.type === "laser" || message.type === "blackout" || message.type === "presentation" || message.type === "board" || message.type === "clear-drawing";
    if (immediate) void flushRelayQueue();
    else if (relayFlushTimerRef.current === null) relayFlushTimerRef.current = window.setTimeout(() => void flushRelayQueue(), 20);
  }, [flushRelayQueue, linkState]);

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
    const nextRoom = createRoomCode();
    window.localStorage.setItem(RECEIVER_ROOM_STORAGE, nextRoom);
    setRoom(nextRoom);
    setLinkState("idle");
    setMode("receiver");
  };

  const returnToLanding = () => {
    screenStream?.getTracks().forEach((track) => track.stop());
    setScreenStream(null);
    window.localStorage.removeItem(RECEIVER_ROOM_STORAGE);
    setRoom("");
    setLinkState("idle");
    setMode("home");
  };

  const reconnectRoom = () => {
    setLinkState("connecting");
    setReconnectNonce((current) => current + 1);
    setToast("Reconectando con el mismo código de sala");
  };

  const createNewReceiverRoom = () => {
    const nextRoom = createRoomCode();
    window.localStorage.setItem(RECEIVER_ROOM_STORAGE, nextRoom);
    setRemoteDevice(null);
    setRoom(nextRoom);
    setLinkState("waiting");
    setReconnectNonce((current) => current + 1);
    setToast("Se creó un código nuevo");
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
    const message: Extract<RemoteMessage, { type: "board" }> = { type: "board", mode: nextMode };
    applyDrawingMessage(message);
    sendRemote(message);
  };

  const clearDrawing = () => {
    const message: Extract<RemoteMessage, { type: "clear-drawing" }> = { type: "clear-drawing" };
    applyDrawingMessage(message);
    sendRemote(message);
    setToast("Anotaciones borradas");
  };

  const toggleFreeze = () => {
    const active = !frozen;
    setFrozen(active);
    sendRemote({ type: "blackout", active });
    setToast(active ? "Imagen congelada; puedes señalar o escribir encima" : "Proyección en vivo");
  };

  const startPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    setPadActive(true);
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
      const message: Extract<RemoteMessage, { type: "pen" }> = { type: "pen", phase: "start", id: strokeId, ...point, color: penColor, width: penWidth, tool: penTool };
      applyDrawingMessage(message);
      sendRemote(message);
    }
  };

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return;
    event.preventDefault();
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
      if (activeStrokeIdRef.current) {
        const message: Extract<RemoteMessage, { type: "pen" }> = { type: "pen", phase: "move", id: activeStrokeIdRef.current, ...point, color: penColor, width: penWidth, tool: penTool };
        applyDrawingMessage(message);
        sendRemote(message);
      }
      return;
    }
    const pixelX = event.clientX - previous.x;
    const pixelY = event.clientY - previous.y;
    lastPointerSample.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    const distance = Math.hypot(pixelX, pixelY);
    if (distance < 0.28) return;
    const acceleration = 0.9 + Math.min(0.65, distance / 34);
    const dx = Math.max(-0.085, Math.min(0.085, (pixelX / bounds.width) * 1.18 * acceleration));
    const dy = Math.max(-0.085, Math.min(0.085, (pixelY / bounds.height) * 1.18 * acceleration));
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return;
    const next = {
      x: Math.max(0, Math.min(1, pointerPositionRef.current.x + dx)),
      y: Math.max(0, Math.min(1, pointerPositionRef.current.y + dy)),
    };
    pointerPositionRef.current = next;
    pointerTargetRef.current = next;
    setPointer(next);
    pendingPointer.current = next;
    if (pointerFrame.current === null) {
      pointerFrame.current = window.requestAnimationFrame(() => {
        const update = { ...pendingPointer.current };
        sendRemote({ type: "pointer", ...update });
        pointerFrame.current = null;
      });
    }
  };

  const endPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) return;
    event.preventDefault();
    setPadActive(false);
    if (interactionMode === "pen" && activeStrokeIdRef.current) {
      const bounds = event.currentTarget.getBoundingClientRect();
      const message: Extract<RemoteMessage, { type: "pen" }> = {
        type: "pen",
        phase: "end",
        id: activeStrokeIdRef.current,
        x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
        y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
        color: penColor,
        width: penWidth,
        tool: penTool,
      };
      applyDrawingMessage(message);
      sendRemote(message);
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
      screenStreamRef.current = stream;
      setScreenStream(stream);
      // El visor ya pinta su propio láser y anotaciones; apaga la capa nativa
      // para que nunca aparezcan dos punteros sobre la misma imagen.
      await forwardToBridge({ type: "laser", active: false });
      await forwardToBridge({ type: "blackout", active: false });
      await forwardToBridge({ type: "board", mode: "transparent" });
      await forwardToBridge({ type: "clear-drawing" });
      setToast("Ventana lista para presentar");
    } catch {
      setToast("No se seleccionó ninguna pantalla");
    }
  };

  const stopScreenShare = () => {
    screenStream?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
    void forwardToBridge({ type: "laser", active: laser });
    void forwardToBridge({ type: "blackout", active: frozen });
    void forwardToBridge({ type: "board", mode: boardMode });
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
    if (action === "start" && screenStreamRef.current) stopScreenShare();
    const sent = await forwardToBridge({ type: "presentation", action });
    if (sent) setPresenting(action === "start");
    setToast(sent ? (action === "start" ? "PowerPoint inició la presentación" : "Presentación detenida") : "Abre PowerPoint y vuelve a intentarlo");
  };

  const toggleRemotePresentation = () => {
    const next = !presenting;
    setPresenting(next);
    sendRemote({ type: "presentation", action: next ? "start" : "stop" });
    setToast(next ? "Solicitando PowerPoint en pantalla completa" : "Finalizando presentación");
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
      await forwardToBridge({ type: "blackout", active: frozen });
      setShowBridgeDialog(false);
      setToast("Presenta Bridge conectado");
    } else {
      setToast("No se encontró el Bridge o el código no coincide");
    }
  };

  const bridgeLabel = bridgeState === "connected" ? "Bridge conectado" : bridgeState === "detected" ? "Bridge detectado" : bridgeState === "error" ? "Código incorrecto" : "Conectar Bridge";
  const pwaReady = linkState === "connected" && remoteDevice !== null;
  const bridgeReady = bridgeState === "connected";

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
            <article><span>01</span><div><strong>Primero, conecta la PWA</strong><p>Abre Presenta en el celular y escribe el código de seis dígitos de la computadora.</p></div></article>
            <article><span>02</span><div><strong>Después, conecta el Bridge</strong><p>Abre Presenta Bridge en Windows y escribe su contraseña para controlar PowerPoint directamente.</p></div></article>
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
        <section className={`controller-view remote-only-view ${interactionMode === "pen" ? "is-pen-mode" : ""} ${laser ? "is-laser-mode" : ""}`}>
          <div className="controller-heading">
            <div><span className="eyebrow">PRESENTA · CONTROL</span><h1>Sala {formatCode(room)}</h1></div>
            <span className={`link-pill state-${linkState}`}><i />{statusLabel(linkState)}</span>
          </div>
          <div className="mobile-identity"><span>Este dispositivo</span><strong>{localDeviceName}</strong><small>{linkState === "connected" ? "Conectado por Internet con la computadora" : "Buscando la sala por Internet"}</small></div>

          <div className={`touch-area ${padActive ? "is-touching" : ""}`} onPointerDown={startPointer} onPointerMove={movePointer} onPointerUp={endPointer} onPointerCancel={endPointer}>
            <span className="touch-grid" aria-hidden="true" />
            <canvas ref={mobileDrawingCanvasRef} className="mobile-drawing-canvas" aria-label="Vista previa del trazo" />
            <span className="finger-dot" style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} />
            <span className="touch-instruction">{interactionMode === "pen" ? (penTool === "eraser" ? "Desliza sobre un trazo para borrarlo" : "Escribe aquí para dibujar en la presentación") : "Úsalo como trackpad: desliza varias veces para recorrer la pantalla"}</span>
            {interactionMode === "pen" && <span className="rotate-writing-hint">Gira el celular para escribir a pantalla completa</span>}
          </div>

          <div className="tool-row">
            <button className={laser ? "is-active" : ""} onClick={toggleLaser}><i className="laser-icon" />Láser</button>
            <button className={interactionMode === "pen" ? "is-active" : ""} onClick={togglePen}><i className="pen-icon" />Lápiz</button>
            <button className={frozen ? "is-active freeze-active" : ""} onClick={toggleFreeze}><i className="freeze-icon" />{frozen ? "Reanudar" : "Congelar"}</button>
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
          <button className={`presentation-toggle ${presenting ? "is-presenting" : ""}`} onClick={toggleRemotePresentation}>{presenting ? "Finalizar pantalla completa" : "Presentar PowerPoint en pantalla completa"}</button>
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
              <span className={`link-pill state-${linkState}`}><i />{statusLabel(linkState)}</span>
            </div>
          </div>

          {!online && <div className="recovery-banner"><strong>Se perdió Internet.</strong><span>No cambies el código: Presenta retomará esta misma sala al volver la red.</span></div>}

          <div className="setup-phases" aria-label="Configuración en dos fases">
            <article className={`setup-phase ${pwaReady ? "is-complete" : "is-current"}`}>
              <div className="phase-number">1</div>
              <div className="phase-copy">
                <span>PRIMERO · PWA</span>
                <strong>{pwaReady ? `${remoteDevice.name} conectado` : "Conecta el celular"}</strong>
                <p>{pwaReady ? `${remoteDevice.platform} controla esta sala por Internet.` : `Abre la PWA en el celular y escribe ${formatCode(room)}.`}</p>
                {remoteDevice && <small>Última señal: {remoteDevice.lastSeen.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small>}
              </div>
              <div className="phase-actions">
                <span className={`phase-state ${pwaReady ? "is-ready" : ""}`}>{pwaReady ? "Listo" : statusLabel(linkState)}</span>
                {!pwaReady && <button onClick={reconnectRoom}>Reconectar ahora</button>}
                <button className="phase-link" onClick={createNewReceiverRoom}>Código nuevo</button>
              </div>
            </article>

            <article className={`setup-phase ${bridgeReady ? "is-complete" : pwaReady ? "is-current" : "is-locked"}`}>
              <div className="phase-number">2</div>
              <div className="phase-copy">
                <span>DESPUÉS · WINDOWS</span>
                <strong>{bridgeReady ? "Bridge conectado" : "Conecta Presenta Bridge"}</strong>
                <p>{bridgeReady ? "PowerPoint, láser y lápiz ya pueden controlarse directamente." : "Abre el Bridge e introduce su contraseña de ocho caracteres."}</p>
              </div>
              <div className="phase-actions">
                <span className={`phase-state ${bridgeReady ? "is-ready" : ""}`}>{bridgeReady ? "Listo" : bridgeLabel}</span>
                {!bridgeReady && <button disabled={!pwaReady} onClick={() => setShowBridgeDialog(true)}>{pwaReady ? "Conectar Bridge" : "Completa fase 1"}</button>}
              </div>
            </article>
          </div>

          {!screenStream && boardMode === "transparent" ? (
            <div className="direct-stage">
              <span className="eyebrow">MODO RECOMENDADO</span>
              <h1>PowerPoint directo en la pantalla</h1>
              <p>Abre tu archivo de PowerPoint y pulsa el botón. La presentación ocupará toda la pantalla; Presenta quedará detrás y el celular seguirá controlando diapositivas, láser, lápiz, pizarras y congelación de imagen.</p>
              <div className="direct-stage-actions">
                <button className="direct-primary" disabled={!pwaReady || !bridgeReady} onClick={() => void controlPowerPoint("start")}>{pwaReady && bridgeReady ? "Presentar PowerPoint directamente" : "Completa las dos fases"} <span>→</span></button>
                <button onClick={startScreenShare}>Usar visor de Presenta</button>
              </div>
              <small>{pwaReady && bridgeReady ? "Todo listo. El Bridge controla Windows y la PWA del celular envía las órdenes por Internet." : "Primero conecta la PWA del celular y después el Bridge de Windows. Presenta conserva el código si la red se interrumpe."}</small>
            </div>
          ) : (
            <>
              <div className="screen-share-controls">
                <button className="share-button" onClick={startScreenShare}>{screenStream ? "Cambiar ventana" : "Elegir ventana"}</button>
                {screenStream && <button onClick={enterFullscreen}>Ampliar a pantalla completa</button>}
                {screenStream && <button className="stop-share" onClick={stopScreenShare}>Cerrar visor</button>}
              </div>
              <div ref={presentationRef} className={`presentation-canvas board-${boardMode} ${screenStream ? "has-share" : ""} ${frozen ? "is-frozen" : ""}`}>
                {screenStream ? <video ref={videoRef} className="shared-screen" autoPlay muted playsInline /> : <div className="presentation-empty"><h1>{boardMode === "white" ? "Pizarra blanca" : "Pizarra negra"}</h1></div>}
                <canvas ref={drawingCanvasRef} className="drawing-canvas" aria-label="Anotaciones de Presenta" />
                <div className={`laser-pointer ${laser ? "" : "is-hidden"}`} style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} />
                {frozen && screenStream && <div className="freeze-badge">Imagen congelada</div>}
              </div>
            </>
          )}
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
            <a className="bridge-download" href="/downloads/PresentaBridgeSetup.exe?v=083" download>Descargar Presenta Bridge 0.8.3 para Windows</a>
            <small>Instala 0.8.3 encima de tu versión actual: corrige la visibilidad del láser, cierra la versión anterior y conserva tu contraseña.</small>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
