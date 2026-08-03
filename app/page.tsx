"use client";

import { PointerEvent, useCallback, useEffect, useRef, useState } from "react";

type Mode = "home" | "pair" | "control" | "receiver";
type LinkState = "idle" | "waiting" | "connecting" | "connected" | "offline";
type BridgeState = "missing" | "detected" | "connected" | "error";
type LocalRequestInit = RequestInit & { targetAddressSpace?: "loopback" };
type RemoteMessage =
  | { type: "pointer"; x: number; y: number }
  | { type: "slide"; direction: 1 | -1 }
  | { type: "laser"; active: boolean }
  | { type: "blackout"; active: boolean };

const SLIDE_COPY = [
  ["LA IDEA", "Presenta sin quedarte junto a la laptop", "Tu teléfono se convierte en un control preciso y siempre disponible."],
  ["EL CONTROL", "Desliza, señala y avanza", "Un panel táctil amplio mantiene toda la atención en tu mensaje."],
  ["LA CONEXIÓN", "Sin cables y sin instalar en Android", "La PWA se enlaza mediante una sala privada entre ambos dispositivos."],
  ["EL RESULTADO", "Una presentación más natural", "Controla el ritmo, enfatiza ideas y muévete con libertad."],
];

function createRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function formatCode(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 6);
  return digits.length > 3 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : digits;
}

function statusLabel(state: LinkState) {
  if (state === "connected") return "Conectado";
  if (state === "connecting") return "Conectando";
  if (state === "waiting") return "Esperando celular";
  if (state === "offline") return "Sin conexión";
  return "Listo";
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("home");
  const [room, setRoom] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [linkState, setLinkState] = useState<LinkState>("idle");
  const [slide, setSlide] = useState(8);
  const [laser, setLaser] = useState(true);
  const [blackout, setBlackout] = useState(false);
  const [pointer, setPointer] = useState({ x: 0.58, y: 0.52 });
  const [installEvent, setInstallEvent] = useState<Event | null>(null);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState("");
  const [bridgeState, setBridgeState] = useState<BridgeState>("missing");
  const [bridgeInput, setBridgeInput] = useState("");
  const [showBridgeDialog, setShowBridgeDialog] = useState(false);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const bridgeCodeRef = useRef("");
  const pointerFrame = useRef<number | null>(null);
  const pendingPointer = useRef({ x: 0.58, y: 0.52 });

  useEffect(() => {
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
    if (/^\d{6}$/.test(savedBridgeCode)) {
      bridgeCodeRef.current = savedBridgeCode;
      setBridgeInput(savedBridgeCode);
    }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("beforeinstallprompt", onInstall);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

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
        setBridgeState(response.ok ? "connected" : "error");
        return response.ok;
      })
      .catch(() => {
        setBridgeState("missing");
        return false;
      });
  }, []);

  const receiveMessage = useCallback((message: RemoteMessage) => {
    if (message.type === "pointer") setPointer({ x: message.x, y: message.y });
    if (message.type === "slide") {
      setSlide((current) => Math.max(1, Math.min(24, current + message.direction)));
    }
    if (message.type === "laser") setLaser(message.active);
    if (message.type === "blackout") setBlackout(message.active);
    void forwardToBridge(message);
  }, [forwardToBridge]);

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

  useEffect(() => {
    if (!room || (mode !== "control" && mode !== "receiver")) return;
    let stopped = false;
    let lastSignalId = 0;
    let pollTimer: number | undefined;
    const role = mode === "receiver" ? "receiver" : "controller";
    const pc = new RTCPeerConnection({ iceServers: [] });
    const pendingCandidates: RTCIceCandidateInit[] = [];

    const broadcast = new BroadcastChannel(`presenta-${room}`);
    broadcastRef.current = broadcast;
    broadcast.onmessage = (event) => receiveMessage(event.data as RemoteMessage);

    const prepareChannel = (channel: RTCDataChannel) => {
      channelRef.current = channel;
      channel.onopen = () => setLinkState("connected");
      channel.onclose = () => setLinkState("offline");
      channel.onmessage = (event) => {
        try { receiveMessage(JSON.parse(event.data) as RemoteMessage); } catch { /* Ignore malformed peer data. */ }
      };
    };

    const postSignal = async (kind: string, payload: unknown) => {
      try {
        await fetch("/api/signal", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room, role, kind, payload }),
        });
      } catch {
        if (!stopped) setLinkState("offline");
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setLinkState("connected");
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) setLinkState("offline");
    };
    pc.onicecandidate = (event) => {
      if (event.candidate) void postSignal("candidate", event.candidate.toJSON());
    };
    pc.ondatachannel = (event) => prepareChannel(event.channel);

    const applyCandidate = async (candidate: RTCIceCandidateInit) => {
      if (!pc.remoteDescription) {
        pendingCandidates.push(candidate);
        return;
      }
      await pc.addIceCandidate(candidate);
    };

    const flushCandidates = async () => {
      while (pendingCandidates.length) await pc.addIceCandidate(pendingCandidates.shift()!);
    };

    const poll = async () => {
      try {
        const response = await fetch(`/api/signal?room=${room}&role=${role}&after=${lastSignalId}`, { cache: "no-store" });
        if (response.ok) {
          const data = await response.json() as { signals: Array<{ id: number; kind: string; payload: string }> };
          for (const signal of data.signals) {
            lastSignalId = Math.max(lastSignalId, signal.id);
            const payload = JSON.parse(signal.payload);
            if (signal.kind === "offer" && role === "controller" && !pc.remoteDescription) {
              setLinkState("connecting");
              await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
              await flushCandidates();
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              await postSignal("answer", pc.localDescription);
            } else if (signal.kind === "answer" && role === "receiver" && !pc.remoteDescription) {
              await pc.setRemoteDescription(payload as RTCSessionDescriptionInit);
              await flushCandidates();
            } else if (signal.kind === "candidate") {
              await applyCandidate(payload as RTCIceCandidateInit);
            }
          }
        }
      } catch {
        if (!stopped && !navigator.onLine) setLinkState("offline");
      } finally {
        if (!stopped) pollTimer = window.setTimeout(poll, 850);
      }
    };

    const start = async () => {
      setLinkState(role === "receiver" ? "waiting" : "connecting");
      if (role === "receiver") {
        const dataChannel = pc.createDataChannel("presenta", { ordered: false, maxRetransmits: 1 });
        prepareChannel(dataChannel);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await postSignal("offer", pc.localDescription);
      }
      await poll();
    };
    void start();

    return () => {
      stopped = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      broadcast.close();
      pc.close();
      channelRef.current = null;
      broadcastRef.current = null;
    };
  }, [mode, receiveMessage, room]);

  const sendRemote = useCallback((message: RemoteMessage) => {
    const encoded = JSON.stringify(message);
    if (channelRef.current?.readyState === "open") channelRef.current.send(encoded);
    broadcastRef.current?.postMessage(message);
  }, []);

  const chooseReceiver = () => {
    setRoom(createRoomCode());
    setMode("receiver");
  };

  const joinRoom = () => {
    const normalized = roomInput.replace(/\D/g, "");
    if (normalized.length !== 6) {
      setToast("Escribe los seis números de la sala");
      return;
    }
    setRoom(normalized);
    setMode("control");
  };

  const changeSlide = (direction: 1 | -1) => {
    setSlide((current) => Math.max(1, Math.min(24, current + direction)));
    sendRemote({ type: "slide", direction });
    if (navigator.vibrate) navigator.vibrate(35);
  };

  const toggleLaser = () => {
    const active = !laser;
    setLaser(active);
    sendRemote({ type: "laser", active });
  };

  const toggleBlackout = () => {
    const active = !blackout;
    setBlackout(active);
    sendRemote({ type: "blackout", active });
  };

  const movePointer = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    pendingPointer.current = {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
    setPointer(pendingPointer.current);
    if (pointerFrame.current === null) {
      pointerFrame.current = window.requestAnimationFrame(() => {
        sendRemote({ type: "pointer", ...pendingPointer.current });
        pointerFrame.current = null;
      });
    }
  };

  const promptInstall = async () => {
    if (!installEvent) {
      setToast("Abre el menú del navegador y elige “Instalar aplicación”");
      return;
    }
    const prompt = installEvent as Event & { prompt: () => Promise<void> };
    await prompt.prompt();
    setInstallEvent(null);
  };

  const goHome = () => {
    setMode("home");
    setRoom("");
    setLinkState("idle");
  };

  const copyCode = async () => {
    await navigator.clipboard?.writeText(room);
    setToast("Código copiado");
  };

  const connectBridge = async () => {
    const code = bridgeInput.replace(/\D/g, "");
    if (code.length !== 6) {
      setToast("Escribe el código de seis dígitos del Bridge");
      return;
    }
    bridgeCodeRef.current = code;
    window.localStorage.setItem("presenta.bridgeCode", code);
    const connected = await forwardToBridge({ type: "ping" });
    if (connected) {
      setShowBridgeDialog(false);
      setToast("Presenta Bridge conectado");
    } else {
      setToast("No se encontró el Bridge o el código no coincide");
    }
  };

  const bridgeLabel = bridgeState === "connected" ? "Bridge conectado" : bridgeState === "detected" ? "Bridge detectado" : bridgeState === "error" ? "Código incorrecto" : "Conectar Bridge";

  const slideCopy = SLIDE_COPY[(slide - 1) % SLIDE_COPY.length];

  return (
    <main className={`app-shell mode-${mode}`}>
      <header className="topbar">
        <button className="brand" onClick={goHome} aria-label="Ir al inicio de Presenta">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>Presenta</span>
        </button>
        <div className="top-actions">
          <span className={`network ${online ? "is-online" : ""}`}><i />{online ? "En línea" : "Sin red"}</span>
          {mode === "home" && <button className="quiet-button" onClick={promptInstall}>Instalar PWA</button>}
          {mode !== "home" && <button className="quiet-button" onClick={goHome}>Salir</button>}
        </div>
      </header>

      {mode === "home" && (
        <section className="home-view">
          <div className="hero-copy">
            <span className="eyebrow">CONTROL REMOTO PARA PRESENTACIONES</span>
            <h1>Tu presentación.<br /><em>En la palma de tu mano.</em></h1>
            <p>Conecta Android y Windows desde el navegador. Avanza diapositivas, mueve el puntero y mantén la atención donde importa.</p>
          </div>

          <div className="mode-grid" aria-label="Elige cómo usar este dispositivo">
            <button className="mode-card receiver-card" onClick={chooseReceiver}>
              <span className="mode-number">01</span>
              <span className="device-illustration laptop-shape" aria-hidden="true"><i /><b /></span>
              <span className="mode-copy"><strong>Recibir presentación</strong><small>Para tu laptop con Windows</small></span>
              <span className="mode-arrow">→</span>
            </button>
            <button className="mode-card control-card" onClick={() => setMode("pair")}>
              <span className="mode-number">02</span>
              <span className="device-illustration phone-shape" aria-hidden="true"><i /></span>
              <span className="mode-copy"><strong>Usar como control</strong><small>Para tu teléfono Android</small></span>
              <span className="mode-arrow">→</span>
            </button>
          </div>

          <div className="compatibility-strip">
            <span><i className="check">✓</i> Instalable</span>
            <span><i className="check">✓</i> Sin cable</span>
            <span><i className="check">✓</i> Sin cuenta</span>
            <span className="bridge-note">PowerPoint de escritorio requiere Presenta Bridge para Windows</span>
          </div>
        </section>
      )}

      {mode === "pair" && (
        <section className="pair-view">
          <button className="back-link" onClick={goHome}>← Volver</button>
          <div className="pair-panel">
            <span className="step-pill">ANDROID · PASO 1 DE 1</span>
            <h1>Conecta con la laptop</h1>
            <p>Escribe el código que aparece en la pantalla de Windows.</p>
            <label htmlFor="room-code">Código de seis dígitos</label>
            <input
              id="room-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={formatCode(roomInput)}
              onChange={(event) => setRoomInput(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000 000"
              autoFocus
            />
            <button className="primary-button" onClick={joinRoom}>Conectar ahora <span>→</span></button>
            <small>La sala sólo transmite órdenes de control. No sube tu presentación.</small>
          </div>
        </section>
      )}

      {mode === "control" && (
        <section className="controller-view">
          <div className="controller-heading">
            <div><span className="eyebrow">CONTROL ANDROID</span><h1>Sala {formatCode(room)}</h1></div>
            <span className={`link-pill state-${linkState}`}><i />{statusLabel(linkState)}</span>
          </div>

          <div className="touch-area" onPointerDown={movePointer} onPointerMove={(event) => { if (event.buttons === 1 || event.pointerType === "touch") movePointer(event); }}>
            <span className="touch-grid" aria-hidden="true" />
            <span className="finger-dot" style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} />
            <span className="touch-instruction">Desliza para mover el puntero</span>
          </div>

          <div className="tool-row">
            <button className={laser ? "is-active" : ""} onClick={toggleLaser}><i className="laser-icon" />Láser</button>
            <button className={blackout ? "is-active blackout-active" : ""} onClick={toggleBlackout}><i className="screen-icon" />Pantalla negra</button>
          </div>

          <div className="slide-controls">
            <button onClick={() => changeSlide(-1)} aria-label="Diapositiva anterior">←</button>
            <div><strong>{slide}</strong><span>de 24</span></div>
            <button className="next-button" onClick={() => changeSlide(1)} aria-label="Diapositiva siguiente">→</button>
          </div>
        </section>
      )}

      {mode === "receiver" && (
        <section className="receiver-view">
          <div className="receiver-toolbar">
            <div className="room-code-block"><span>CÓDIGO DE CONEXIÓN</span><button onClick={copyCode}>{formatCode(room)} <small>Copiar</small></button></div>
            <div className="receiver-status">
              <button className={`bridge-button bridge-${bridgeState}`} onClick={() => setShowBridgeDialog(true)}><i />{bridgeLabel}</button>
              <span className={`link-pill state-${linkState}`}><i />{statusLabel(linkState)}</span>
              <span>Diapositiva {slide} de 24</span>
            </div>
          </div>
          <div className={`presentation-canvas ${blackout ? "is-blackout" : ""}`}>
            <div className="deck-brand">PRESENTA / DEMO</div>
            <div className="deck-copy"><span>{slideCopy[0]}</span><h1>{slideCopy[1]}</h1><p>{slideCopy[2]}</p></div>
            <div className="deck-visual" aria-hidden="true"><span /><span /><span /></div>
            <div className={`laser-pointer ${laser ? "" : "is-hidden"}`} style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} />
            {blackout && <div className="blackout-message">Pantalla en pausa</div>}
          </div>
          <p className="receiver-hint">Abre esta vista en pantalla completa. El complemento de Windows permitirá controlar PowerPoint y colocar este puntero sobre cualquier aplicación.</p>
        </section>
      )}

      {showBridgeDialog && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowBridgeDialog(false); }}>
          <section className="bridge-dialog" role="dialog" aria-modal="true" aria-labelledby="bridge-title">
            <button className="dialog-close" onClick={() => setShowBridgeDialog(false)} aria-label="Cerrar">×</button>
            <span className="step-pill">WINDOWS · PRESENTA BRIDGE</span>
            <h2 id="bridge-title">Conecta el complemento</h2>
            <p>Abre Presenta Bridge en Windows y escribe el código que aparece en su ventana.</p>
            <label htmlFor="bridge-code">Código del Bridge</label>
            <input
              id="bridge-code"
              inputMode="numeric"
              value={formatCode(bridgeInput)}
              onChange={(event) => setBridgeInput(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="000 000"
              autoFocus
            />
            <button className="primary-button" onClick={connectBridge}>Conectar Bridge <span>→</span></button>
            <a className="bridge-download" href="/downloads/PresentaBridge.exe" download>Descargar Presenta Bridge para Windows</a>
            <small>El complemento sólo escucha en esta computadora y valida el código antes de ejecutar órdenes.</small>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
