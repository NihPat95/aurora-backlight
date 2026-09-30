import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { useLightingOutput } from "./useLightingOutput";
import { readControllerInfo } from "./wled";

type Preset = Record<string, unknown>;
type Screen = "welcome" | "camera" | "calibrate" | "monitor" | "light-map" | "music" | "session";

const API_URL = import.meta.env.VITE_API_URL || "";
type LightingLevel = "low" | "medium" | "high";
type SessionMode = "screen" | "music" | "blend";

const defaultCorners = () => [[14, 15], [86, 15], [86, 85], [14, 85]];

function App() {
  const video = useRef<HTMLVideoElement>(null);
  const calibrationVideo = useRef<HTMLVideoElement>(null);
  const monitorVideo = useRef<HTMLVideoElement>(null);
  const [screen, setScreen] = useState<Screen>("welcome");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [cameraRefresh, setCameraRefresh] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraListError, setCameraListError] = useState("");
  const [cameraScanMessage, setCameraScanMessage] = useState("");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState("");
  const [testMicrophone, setTestMicrophone] = useState(false);
  const [microphoneError, setMicrophoneError] = useState("");
  const [microphoneListError, setMicrophoneListError] = useState("");
  const [microphoneScanMessage, setMicrophoneScanMessage] = useState("");
  const [microphoneLevel, setMicrophoneLevel] = useState(0);
  const [audioActive, setAudioActive] = useState(false);
  const [volumeReactive, setVolumeReactive] = useState(false);
  const [lightingLevel, setLightingLevel] = useState<LightingLevel>("high");
  const [sessionMode, setSessionMode] = useState<SessionMode>("screen");
  const [ceiling, setCeiling] = useState(20);
  const [musicColor, setMusicColor] = useState("#7456e8");
  const [serviceError, setServiceError] = useState("");
  const [controllerStatus, setControllerStatus] = useState("Not checked");
  const runGeneration = useRef(0);
  const sceneGeneration = useRef(0);

  const [minReactiveBrightness, setMinReactiveBrightness] = useState(35);
  const [maxReactiveBrightness, setMaxReactiveBrightness] = useState(180);
  const [presets, setPresets] = useState<Record<string, Preset>>({});
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState("");
  const [corners, setCorners] = useState(defaultCorners);
  const [brightness, setBrightness] = useState(0);
  const [saturation, setSaturation] = useState(1);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [contrast, setContrast] = useState(1);
  const [gamma, setGamma] = useState(1);
  const [redGain, setRedGain] = useState(1);
  const [greenGain, setGreenGain] = useState(1);
  const [blueGain, setBlueGain] = useState(1);
  const [perimeterDepth, setPerimeterDepth] = useState(16);
  const [letterboxDetection, setLetterboxDetection] = useState(true);
  const [highlightProtection, setHighlightProtection] = useState(0.35);
  const [cornerBlend, setCornerBlend] = useState(0.35);
  const [viewingMode, setViewingMode] = useState("accurate");
  const audioEnabled = sessionMode === "music" || (sessionMode === "blend" && volumeReactive && viewingMode !== "night");
  const [corrected, setCorrected] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  const [rgb, setRgb] = useState<[number, number, number] | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetMessage, setPresetMessage] = useState("");
  const [videoSize, setVideoSize] = useState([16, 9]);
  const [wledUrl, setWledUrl] = useState(() => localStorage.getItem("wled-url") || "");
  const [wledMessage, setWledMessage] = useState("");
  const [ledCount, setLedCount] = useState(100);
  const [ledOffset, setLedOffset] = useState(0);
  const [layoutMessage, setLayoutMessage] = useState("");
  const [detectingLights, setDetectingLights] = useState(false);
  const [controllerIp, setControllerIp] = useState("");
  const controllerScan = useRef(0);
  const [turningOff, setTurningOff] = useState(false);
  const [activeCorner, setActiveCorner] = useState<number | null>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const [testImages, setTestImages] = useState<string[]>([]);
  const [testImage, setTestImage] = useState("");
  const [isBacklightRunning, setIsBacklightRunning] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const isAnalyzing = useRef(false);
  const isSendingLedFrame = useRef(false);
  const targetColors = useRef<[number, number, number][] | null>(null);
  const smoothedMicrophoneLevel = useRef(0);

  useEffect(() => {
    fetch(`${API_URL}/api/presets`)
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then(setPresets)
      .catch(() => setServiceError("Cannot reach the local service. Start the backend, then reload to access your scenes."));
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/wled/layout`)
      .then((response) => (response.ok ? response.json() : {}))
      .then((config: Record<string, unknown>) => {
        if (typeof config.url === "string") setWledUrl(config.url);
        if (typeof config.led_count === "number" && config.led_count >= 1) setLedCount(Math.min(1200, Math.round(config.led_count)));
        if (typeof config.led_offset === "number" && config.led_offset >= 0) setLedOffset(config.led_offset);
        if (typeof config.test_image === "string") setTestImage(config.test_image);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/test-images`)
      .then((response) => (response.ok ? response.json() : { images: [] }))
      .then((result: { images?: unknown }) => {
        const images = Array.isArray(result.images) ? result.images.filter((image): image is string => typeof image === "string") : [];
        setTestImages(images);
        setTestImage((current) => current && images.includes(current) ? current : images[0] ?? "");
      })
      .catch(() => setTestImages([]));
  }, []);

  // Discovery must not depend on opening the default camera: it may be
  // unavailable even when another (for example USB) camera works.
  useEffect(() => {
    if (screen !== "camera" || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    let request = 0;
    const refreshDevices = async () => {
      const current = ++request;
      try {
        const available = await navigator.mediaDevices.enumerateDevices();
        if (cancelled || current !== request) return;
        setDevices(available.filter(device => device.kind === "videoinput" && device.deviceId));
        setCameraListError("");
      } catch {
        if (!cancelled && current === request) setCameraListError("Could not list cameras. Allow camera access in your browser, then refresh cameras.");
      }
    };
    void refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    window.addEventListener("focus", refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
      window.removeEventListener("focus", refreshDevices);
    };
  }, [screen, cameraRefresh]);

  const scanCameras = async () => {
    const generation = sceneGeneration.current;
    setCameraListError("");
    setCameraScanMessage("Checking camera permission and scanning USB devices…");
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
      setCameraListError("Camera access requires HTTPS or localhost. Open the app through a secure connection.");
      setCameraScanMessage("");
      return;
    }

    let permissionStream: MediaStream | null = null;
    try {
      // Safari and Chromium may hide external cameras (and all useful labels)
      // until getUserMedia has been granted from a direct user action.
      if (!cameraReady) permissionStream = await navigator.mediaDevices.getUserMedia({ video: true });
      const available = await navigator.mediaDevices.enumerateDevices();
      if (generation !== sceneGeneration.current) return;
      const cameras = available.filter(device => device.kind === "videoinput" && device.deviceId);
      setDevices(cameras);
      setCameraScanMessage(cameras.length
        ? `Found ${cameras.length} camera${cameras.length === 1 ? "" : "s"}. Select the USB camera above.`
        : "No browser-accessible cameras were found.");
      setCameraRefresh(value => value + 1);
    } catch (error) {
      if (generation !== sceneGeneration.current) return;
      const name = error instanceof DOMException ? error.name : "";
      setCameraListError(name === "NotAllowedError"
        ? "Camera permission is blocked. In your browser’s site settings, allow Camera access. On macOS also enable the browser under System Settings → Privacy & Security → Camera."
        : "The browser could not open a camera while scanning. Close FaceTime, Zoom, OBS, and other camera apps, then scan again.");
      // Enumeration can still reveal a previously authorized USB camera when
      // the default camera is busy, so always try it after a probe failure.
      try {
        const available = await navigator.mediaDevices.enumerateDevices();
      if (generation !== sceneGeneration.current) return;
        const cameras = available.filter(device => device.kind === "videoinput" && device.deviceId);
        setDevices(cameras);
        if (cameras.length) {
          setCameraScanMessage(`Found ${cameras.length} camera${cameras.length === 1 ? "" : "s"}. Select one above.`);
          setCameraListError("");
        } else {
          setCameraScanMessage("");
        }
      } catch {
        setCameraScanMessage("");
      }
    } finally {
      permissionStream?.getTracks().forEach(track => track.stop());
    }
  };

  useEffect(() => {
    if (screen !== "camera" || !navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const refreshMicrophones = async () => {
      try {
        const available = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setMicrophones(available.filter(device => device.kind === "audioinput" && device.deviceId));
      } catch {
        if (!cancelled) setMicrophoneListError("Could not list microphones. Allow microphone access, then scan again.");
      }
    };
    void refreshMicrophones();
    navigator.mediaDevices.addEventListener("devicechange", refreshMicrophones);
    window.addEventListener("focus", refreshMicrophones);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", refreshMicrophones);
      window.removeEventListener("focus", refreshMicrophones);
    };
  }, [screen]);

  const scanMicrophones = async () => {
    const generation = sceneGeneration.current;
    setMicrophoneError("");
    setMicrophoneListError("");
    setMicrophoneScanMessage("Checking microphone permission and scanning USB audio devices…");
    if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
      setMicrophoneListError("Microphone access requires HTTPS or localhost. Open the app through a secure connection.");
      setMicrophoneScanMessage("");
      return;
    }

    let permissionStream: MediaStream | null = null;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const available = await navigator.mediaDevices.enumerateDevices();
      if (generation !== sceneGeneration.current) return;
      const inputs = available.filter(device => device.kind === "audioinput" && device.deviceId);
      setMicrophones(inputs);
      setMicrophoneScanMessage(inputs.length
        ? `Found ${inputs.length} microphone${inputs.length === 1 ? "" : "s"}. Select the USB microphone below.`
        : "No browser-accessible microphones were found.");
    } catch (error) {
      if (generation !== sceneGeneration.current) return;
      const name = error instanceof DOMException ? error.name : "";
      setMicrophoneListError(name === "NotAllowedError"
        ? "Microphone permission is blocked. In your browser’s site settings, allow Microphone access. On macOS also enable the browser under System Settings → Privacy & Security → Microphone."
        : "The browser could not open a microphone. Close apps using exclusive audio input, then scan again.");
      try {
        const available = await navigator.mediaDevices.enumerateDevices();
      if (generation !== sceneGeneration.current) return;
        const inputs = available.filter(device => device.kind === "audioinput" && device.deviceId);
        setMicrophones(inputs);
        if (inputs.length) {
          setMicrophoneScanMessage(`Found ${inputs.length} microphone${inputs.length === 1 ? "" : "s"}. Select one below.`);
          setMicrophoneListError("");
        } else {
          setMicrophoneScanMessage("");
        }
      } catch {
        setMicrophoneScanMessage("");
      }
    } finally {
      permissionStream?.getTracks().forEach(track => track.stop());
    }
  };

  useEffect(() => {
    if (screen !== "camera" || !video.current) return;
    let activeStream: MediaStream | null = null;
    let cancelled = false;
    const preview = video.current;
    setCameraReady(false);
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera access requires HTTPS or localhost. Open the app through a secure connection.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach(track => track.stop()); return; }
        activeStream = stream;
        preview.srcObject = stream;
        setCameraReady(true);
        stream.getVideoTracks().forEach(track => {
          track.onended = () => {
            if (cancelled) return;
            setCameraReady(false);
            setCameraError("The camera disconnected. Reconnect it and refresh cameras, or choose another camera.");
          };
        });
      })
      .catch((error: DOMException) => {
        if (cancelled) return;
        const message = error.name === "NotAllowedError"
          ? "Camera permission is blocked. Allow camera access in your browser’s site settings, then refresh cameras."
          : error.name === "NotReadableError" || error.name === "AbortError"
          ? "This camera could not start. Close other apps using it, or select your USB camera below."
          : error.name === "NotFoundError" || error.name === "OverconstrainedError"
          ? "The selected camera is unavailable. Connect your USB camera, refresh cameras, and select it below."
          : "Could not start this camera. Choose another camera or refresh cameras to retry.";
        setCameraError(message);
      });
    return () => {
      cancelled = true;
      activeStream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
      preview.srcObject = null;
    };
  }, [screen, deviceId, cameraRefresh]);

  useEffect(() => {
    if (screen !== "camera" || !testMicrophone) return;
    let activeStream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError("Camera and microphone access requires HTTPS or localhost. Open the app through a secure connection."); return; }
    let audioContext: AudioContext | null = null;
    let frameId = 0;
    setMicrophoneError("");
    navigator.mediaDevices
      .getUserMedia({ audio: microphoneId ? { deviceId: { exact: microphoneId } } : true })
      .then(async (stream) => {
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        activeStream = stream;
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setMicrophones((allDevices ?? []).filter((device) => device.kind === "audioinput"));
        audioContext = new AudioContext();
        void audioContext.resume();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        const readLevel = () => {
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
          setMicrophoneLevel(Math.min(100, Math.round(rms * 260)));
          frameId = requestAnimationFrame(readLevel);
        };
        readLevel();
      })
      .catch(() => { if (!cancelled) setMicrophoneError("Microphone access was not granted or the selected microphone is unavailable."); });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      activeStream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
      setMicrophoneLevel(0);
    };
  }, [screen, microphoneId, testMicrophone]);

  useEffect(() => {
    if ((screen !== "monitor" && screen !== "calibrate" && screen !== "music") || !isBacklightRunning || !audioEnabled) return;
    let activeStream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError("Camera and microphone access requires HTTPS or localhost. Open the app through a secure connection."); return; }
    let audioContext: AudioContext | null = null;
    let socket: WebSocket | null = null;
    let frameId = 0;
    let lastSent = 0;
    let lastBrightness = -1;
    setAudioActive(false);
    let socketUrl: URL;
    try { socketUrl = new URL(wledUrl); } catch { setMicrophoneError("Enter a valid controller URL in Settings."); return; }
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.pathname = `${socketUrl.pathname.replace(/\/$/, "")}/ws`;
    try { socket = new WebSocket(socketUrl); } catch { setMicrophoneError("Could not connect to WLED for audio-reactive brightness."); return; }
    socket.onerror = () => { if (!cancelled) { setMicrophoneError("WLED audio connection failed. Check Settings and restart."); setIsBacklightRunning(false); } };
    setMicrophoneError("");
    navigator.mediaDevices.getUserMedia({ audio: microphoneId ? { deviceId: { exact: microphoneId } } : true })
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        activeStream = stream;
        audioContext = new AudioContext();
        void audioContext.resume();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        audioContext.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let lastTick = performance.now();
        let rollingPower = 0;
        const updateBrightness = (now: number) => {
          if (cancelled) return;
          const dt = Math.min(100, Math.max(1, now - lastTick));
          lastTick = now;
          analyser.getByteTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
          // Decibels give a more natural perceived-loudness response than a
          // linear RMS value. The -48 dB floor ignores room noise; the curve
          // boosts useful quiet sounds without jumping at the noise floor.
          rollingPower += (rms * rms - rollingPower) * (1 - Math.exp(-dt / 200));
          const db = 10 * Math.log10(Math.max(rollingPower, 0.0000000001));
          const gatedLevel = Math.max(0, Math.min(1, (db + 48) / 30));
          const shapedLevel = gatedLevel ** 0.65;
          const smoothing = 1 - Math.exp(-dt / (shapedLevel > smoothedMicrophoneLevel.current ? 220 : 1100));
          smoothedMicrophoneLevel.current += (shapedLevel - smoothedMicrophoneLevel.current) * smoothing;
          const level = Math.round(smoothedMicrophoneLevel.current * 100);
          setMicrophoneLevel(level);
          setAudioActive(audioContext?.state === "running" && socket?.readyState === WebSocket.OPEN);
          if (socket?.readyState === WebSocket.OPEN && now - lastSent >= 150) {
            const base = sessionMode === "music" ? Math.min(5, ceiling) : ceiling * 0.75;
            const boost = ceiling - base;
            const brightness = Math.round(Math.min(ceiling, base + level / 100 * boost) * 2.55);
            if (Math.abs(brightness - lastBrightness) >= 2) {
              socket.send(JSON.stringify({ on: true, bri: brightness, tt: 0, transition: 0 }));
              lastBrightness = brightness;
              lastSent = now;
            }
          }
          frameId = requestAnimationFrame(updateBrightness);
        };
        updateBrightness(performance.now());
      })
      .catch(() => { if (!cancelled) { setMicrophoneError("Microphone access was not granted or the saved microphone is unavailable."); setIsBacklightRunning(false); } });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      activeStream?.getTracks().forEach((track) => track.stop());
      void audioContext?.close();
      socket?.close();
      smoothedMicrophoneLevel.current = 0;
      setAudioActive(false);
      setMicrophoneLevel(0);
    };
  }, [isBacklightRunning, maxReactiveBrightness, microphoneId, minReactiveBrightness, screen, audioEnabled, ceiling, sessionMode, wledUrl]);

  useEffect(() => {
    if (screen !== "monitor" || !monitorVideo.current) return;
    let activeStream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError("Camera and microphone access requires HTTPS or localhost. Open the app through a secure connection."); return; }
    const constraints = deviceId ? { video: { deviceId: { exact: deviceId } } } : { video: true };
    navigator.mediaDevices.getUserMedia(constraints)
      .then((stream) => {
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
        activeStream = stream;
        if (monitorVideo.current) monitorVideo.current.srcObject = stream;
        setCameraError("");
        setRunMessage("Starting lighting…");
        setIsBacklightRunning(true);
      })
      .catch(() => {
        if (cancelled) return;
        targetColors.current = null;
        setIsBacklightRunning(false);
        setRunMessage("");
        setCameraError("The saved camera is unavailable. Choose a camera to keep this scene's calibration.");
      });
    return () => { cancelled = true; activeStream?.getTracks().forEach((track) => track.stop()); };
  }, [screen, deviceId]);

  useEffect(() => {
    if (screen !== "calibrate" || !calibrationVideo.current) return;
    let activeStream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) { setCameraError("Camera and microphone access requires HTTPS or localhost. Open the app through a secure connection."); return; }
    navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : true })
      .then((stream) => { if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; } activeStream = stream; if (calibrationVideo.current) calibrationVideo.current.srcObject = stream; })
      .catch(() => { if (!cancelled) setCameraError("Camera access was not granted or the selected camera is unavailable."); });
    return () => { cancelled = true; activeStream?.getTracks().forEach((track) => track.stop()); };
  }, [screen, deviceId]);

  useEffect(() => {
    if (!wledUrl.trim()) { setControllerStatus("Not configured"); return; }
    let active = true;
    const abort = new AbortController();
    setControllerStatus("Checking…");
    let socket: WebSocket | null = null;
    let timer = 0;
    let settled = false;
    const fallback = () => fetch(`${API_URL}/api/wled/info?url=${encodeURIComponent(wledUrl)}`, { signal: abort.signal })
      .then(response => { if (active) setControllerStatus(response.ok ? "Connected" : "Offline"); })
      .catch(() => { if (active) setControllerStatus("Offline"); });
    try {
      const socketUrl = new URL(wledUrl);
      socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
      socketUrl.pathname = `${socketUrl.pathname.replace(/\/$/, "")}/ws`;
      socket = new WebSocket(socketUrl);
      timer = window.setTimeout(() => { if (settled) return; settled = true; socket?.close(); void fallback(); }, 1200);
      socket.onopen = () => { settled = true; window.clearTimeout(timer); if (active) setControllerStatus("Connected"); socket?.close(); };
      socket.onerror = () => { if (settled) return; settled = true; window.clearTimeout(timer); socket?.close(); void fallback(); };
    } catch { void fallback(); }
    return () => { active = false; window.clearTimeout(timer); abort.abort(); socket?.close(); };
  }, [wledUrl]);

  const loadPreset = (name: string) => {
    const config = presets[name];
    if (!config) return;
    resetScene();
    const savedCorners = config.corners;
    if (Array.isArray(savedCorners) && savedCorners.length === 4) {
      const parsed = savedCorners.map((point) => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null);
      if (parsed.every((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]))) {
        setCorners(parsed as number[][]);
      }
    }
    const setNumber = (value: unknown, setter: (number: number) => void) => {
      if (typeof value === "number" && Number.isFinite(value)) setter(value);
    };
    setNumber(config.brightness, setBrightness); setNumber(config.saturation, setSaturation);
    setNumber(config.aspectRatio, setAspectRatio); setNumber(config.contrast, setContrast);
    setNumber(config.gamma, setGamma); setNumber(config.redGain, setRedGain);
    setNumber(config.greenGain, setGreenGain); setNumber(config.blueGain, setBlueGain);
    setNumber(config.perimeterDepth, setPerimeterDepth);
    setNumber(config.highlightProtection, setHighlightProtection);
    setNumber(config.cornerBlend, setCornerBlend);
    if (typeof config.letterboxDetection === "boolean") setLetterboxDetection(config.letterboxDetection);
    if (typeof config.viewingMode === "string" && ["accurate", "cinema", "vivid", "night"].includes(config.viewingMode)) setViewingMode(config.viewingMode);
    if (typeof config.deviceId === "string") setDeviceId(config.deviceId);
    if (typeof config.microphoneId === "string") setMicrophoneId(config.microphoneId);
    if (typeof config.volumeReactive === "boolean") setVolumeReactive(config.volumeReactive);
    setNumber(config.minReactiveBrightness, setMinReactiveBrightness);
    setNumber(config.maxReactiveBrightness, setMaxReactiveBrightness);
    setLightingLevel(["low", "medium", "high"].includes(String(config.lightingLevel)) ? config.lightingLevel as LightingLevel : "low");
    setCeiling(typeof config.ceiling === "number" ? Math.max(1, Math.min(100, config.ceiling)) : 20);
    setSessionMode(config.sessionMode === "blend" ? "blend" : "screen");
    setVolumeReactive(config.volumeReactive === true && config.sessionMode === "blend");
    setSelectedPreset(name);
    setPresetName(name);
    setCameraError("");
    setRunMessage("Opening saved camera…");
    setIsBacklightRunning(false);
    setScreen("monitor");
    window.scrollTo(0, 0);
  };

  const moveCorner = (index: number, event: React.PointerEvent<SVGCircleElement>) => {
    const box = event.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box) return;
    const x = Math.max(0, Math.min(100, ((event.clientX - box.left) / box.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - box.top) / box.height) * 100));
    setCorners((current) => current.map((point, pointIndex) => pointIndex === index ? [x, y] : point));
  };

  const analyzeFrame = useCallback(async () => {
    const source = calibrationVideo.current ?? monitorVideo.current;
    if (!source || !source.videoWidth || isAnalyzing.current) return;
    isAnalyzing.current = true;
    const generation = runGeneration.current;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(640, source.videoWidth); canvas.height = Math.round(source.videoHeight * canvas.width / source.videoWidth);
    canvas.getContext("2d")?.drawImage(source, 0, 0);
    const payload = {
      image: canvas.toDataURL("image/jpeg", 0.9),
      corners: corners.map(([x, y]) => [x * canvas.width / 100, y * canvas.height / 100]),
      brightness, saturation, aspect_ratio: aspectRatio, contrast, gamma,
      red_gain: redGain, green_gain: greenGain, blue_gain: blueGain,
    };
    setAnalysisError("");
    try {
      const response = await fetch(`${API_URL}/api/analyze`, { signal: AbortSignal.timeout(5000), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Analysis failed.");
      if (generation !== runGeneration.current) return;
      setCorrected(`data:image/jpeg;base64,${result.corrected}`);
      setRgb(result.rgb);
    } catch (error) { if (generation === runGeneration.current) setAnalysisError(error instanceof Error ? error.message : "Analysis failed."); }
    finally { isAnalyzing.current = false; }
  }, [aspectRatio, blueGain, brightness, contrast, corners, gamma, greenGain, redGain, saturation]);

  useEffect(() => {
    if ((screen !== "calibrate" && screen !== "monitor") || isBacklightRunning) return;
    analyzeFrame();
    const interval = window.setInterval(analyzeFrame, 700);
    return () => window.clearInterval(interval);
  }, [screen, analyzeFrame, isBacklightRunning]);

  const sendLedColors = useCallback(async (colors: [number, number, number][]) => {
    const total = Math.max(1, Math.round(ledCount));
    const hexColors = colors.map((_, physicalIndex) => {
      const logicalIndex = ((physicalIndex - ledOffset) % total + total) % total;
      return colors[logicalIndex].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase();
    });
    const socketUrl = new URL(wledUrl);
    socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
    socketUrl.pathname = `${socketUrl.pathname.replace(/\/$/, "")}/ws`;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(socketUrl);
      const timeout = window.setTimeout(() => { socket.close(); reject(new Error("WLED WebSocket timed out.")); }, 1500);
      socket.onopen = () => {
        socket.send(JSON.stringify({ on: true, bri: Math.round(ceiling * 2.55), transition: lightingLevel === "low" ? 15 : lightingLevel === "medium" ? 7 : 4 }));
        for (let start = 0; start < hexColors.length; start += 256) socket.send(JSON.stringify({ seg: [{ id: 0, i: [start, ...hexColors.slice(start, start + 256)] }] }));
        window.setTimeout(() => { window.clearTimeout(timeout); socket.close(); resolve(); }, 100);
      };
      socket.onerror = () => { window.clearTimeout(timeout); socket.close(); reject(new Error("WLED WebSocket connection failed.")); };
    });
  }, [ledCount, ledOffset, wledUrl, ceiling, lightingLevel, audioEnabled]);

  const runBacklightFrame = useCallback(async () => {
    const source = calibrationVideo.current ?? monitorVideo.current;
    if (!source || !source.videoWidth || isSendingLedFrame.current) return;
    isSendingLedFrame.current = true;
    const generation = runGeneration.current;
    const canvas = document.createElement("canvas");
    canvas.width = Math.min(640, source.videoWidth); canvas.height = Math.round(source.videoHeight * canvas.width / source.videoWidth);
    canvas.getContext("2d")?.drawImage(source, 0, 0);
    const payload = {
      image: canvas.toDataURL("image/jpeg", 0.9),
      corners: corners.map(([x, y]) => [x * canvas.width / 100, y * canvas.height / 100]),
      brightness, saturation, aspect_ratio: aspectRatio, contrast, gamma,
      red_gain: redGain, green_gain: greenGain, blue_gain: blueGain,
      led_count: Math.max(1, Math.round(ledCount)), perimeter_depth: perimeterDepth,
      letterbox_detection: letterboxDetection, highlight_protection: highlightProtection,
      corner_blend: cornerBlend, viewing_mode: viewingMode, lighting_level: lightingLevel,
    };
    try {
      const response = await fetch(`${API_URL}/api/analyze`, { signal: AbortSignal.timeout(5000), method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "TV frame analysis failed.");
      if (generation !== runGeneration.current) return;
      const incoming = result.led_colors as [number, number, number][];
      targetColors.current = incoming;
      if (generation !== runGeneration.current) return;
      setCorrected(`data:image/jpeg;base64,${result.corrected}`);
      setDiagnostic(result.diagnostic ? `data:image/jpeg;base64,${result.diagnostic}` : "");
      setRgb(result.rgb);
      const average = incoming.length ? incoming.reduce((sum, color) => color.map((channel, index) => sum[index] + channel) as [number, number, number], [0, 0, 0]).map(channel => Math.round(channel / incoming.length)) : result.rgb;
      setRunMessage(`Live · RGB ${average.join(", ")} · ${new Date().toLocaleTimeString()}`);
    } catch (error) { if (generation === runGeneration.current) setRunMessage(error instanceof Error ? error.message : "Backlight update failed."); }
    finally { isSendingLedFrame.current = false; }
  }, [aspectRatio, blueGain, brightness, contrast, cornerBlend, corners, gamma, greenGain, highlightProtection, ledCount, letterboxDetection, perimeterDepth, redGain, saturation, sendLedColors, viewingMode, lightingLevel]);

  useEffect(() => {
    if (!isBacklightRunning || (screen !== "calibrate" && screen !== "monitor")) return;
    runBacklightFrame();
    const interval = window.setInterval(runBacklightFrame, lightingLevel === "low" ? 1000 : lightingLevel === "medium" ? 250 : 167);
    return () => { runGeneration.current++; window.clearInterval(interval); };
  }, [isBacklightRunning, runBacklightFrame, screen, lightingLevel]);

  const savePreset = async () => {
    const name = presetName.trim();
    if (!name) return;
    if (presets[name] && name !== selectedPreset) {
      setPresetMessage("A scene with this name already exists. Choose a different name, or open that scene to edit it.");
      return;
    }
    setPresetMessage("");
    const generation = sceneGeneration.current;
    try {
      const response = await fetch(`${API_URL}/api/presets`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config: { corners, brightness, saturation, aspectRatio, contrast, gamma, redGain, greenGain, blueGain, perimeterDepth, letterboxDetection, highlightProtection, cornerBlend, viewingMode, deviceId, microphoneId, volumeReactive, minReactiveBrightness, maxReactiveBrightness, lightingLevel, ceiling, sessionMode } }),
      });
      if (!response.ok) throw new Error("Preset could not be saved.");
      if (generation === sceneGeneration.current) {
        setSelectedPreset(name);
        setPresetMessage(`Saved “${name}”.`);
      }
      setPresets((current) => ({ ...current, [name]: { corners, brightness, saturation, aspectRatio, contrast, gamma, redGain, greenGain, blueGain, perimeterDepth, letterboxDetection, highlightProtection, cornerBlend, viewingMode, deviceId, microphoneId, volumeReactive, minReactiveBrightness, maxReactiveBrightness, lightingLevel, ceiling, sessionMode } }));
    } catch (error) { if (generation === sceneGeneration.current) setPresetMessage(error instanceof Error ? error.message : "Preset could not be saved."); }
  };

  const stopBacklight = () => {
    runGeneration.current++;
    setIsBacklightRunning(false);
    targetColors.current = null;
    setRunMessage("Lights frozen. They keep their current colors until you resume or turn them off.");
  };

  const deletePreset = async (name: string) => {
    if (!window.confirm(`Delete the “${name}” preset?`)) return;
    try {
      const response = await fetch(`${API_URL}/api/presets/${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Preset could not be deleted.");
      setPresets((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    } catch (error) { setPresetMessage(error instanceof Error ? error.message : "Preset could not be deleted."); }
  };

  const testWled = async (color: [number, number, number] | null) => {
    localStorage.setItem("wled-url", wledUrl);
    setWledMessage("Sending…");
    const started = performance.now();
    try {
      const socketUrl = new URL(wledUrl);
      socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
      socketUrl.pathname = `${socketUrl.pathname.replace(/\/$/, "")}/ws`;
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(socketUrl);
        const timeout = window.setTimeout(() => { socket.close(); reject(new Error("WLED WebSocket timed out.")); }, 1500);
        socket.onopen = () => {
          socket.send(JSON.stringify({ on: color !== null, tt: 0, transition: 0, bri: 180, ...(color ? { seg: [{ id: 0, fx: 0, frz: false, col: [color] }] } : {}) }));
          window.setTimeout(() => { window.clearTimeout(timeout); socket.close(); resolve(); }, 100);
        };
        socket.onerror = () => { window.clearTimeout(timeout); socket.close(); reject(new Error("WLED WebSocket connection failed.")); };
      });
      setWledMessage(`${color ? "Test color sent" : "Lights turned off"} · direct WLED connection · ${Math.round(performance.now() - started)} ms`);
    } catch {
      try {
        const response = await fetch(`${API_URL}/api/wled/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: wledUrl, color, on: color !== null }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "WLED test failed.");
        setWledMessage(`${color ? "Test color sent" : "Lights turned off"} · backend fallback ${result.wled_request_ms ?? "?"} ms`);
      } catch (error) { setWledMessage(error instanceof Error ? error.message : "WLED test failed."); }
    }
  };

  const detectLedCount = async () => {
    if (!wledUrl.trim()) {
      setLayoutMessage("Enter your controller’s LAN IP address in Advanced controller settings, then detect your lights.");
      return;
    }
    const generation = ++controllerScan.current;
    setDetectingLights(true);
    setControllerIp("");
    setLayoutMessage("Finding your lights and reading the LED count…");
    try {
      const result = await readControllerInfo(wledUrl, API_URL);
      if (generation !== controllerScan.current) return;
      setLedCount(result.led_count);
      setLedOffset(current => current % result.led_count);
      setControllerIp(result.ip ?? "");
      setLayoutMessage(`Found your lights · ${result.led_count} LEDs. Save layout to keep these settings.`);
    } catch (error) { if (generation === controllerScan.current) setLayoutMessage(error instanceof Error ? error.message : "Could not read the WLED LED count."); }
    finally { if (generation === controllerScan.current) setDetectingLights(false); }
  };

  useEffect(() => {
    setDetectingLights(false); setControllerIp("");
    if (screen !== "light-map") return;
    const timer = window.setTimeout(() => void detectLedCount(), 400);
    return () => { window.clearTimeout(timer); controllerScan.current++; };
  }, [screen, wledUrl]);

  const saveWledLayout = async () => {
    setLayoutMessage("Saving layout…");
    try {
      const response = await fetch(`${API_URL}/api/wled/layout`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: wledUrl, led_count: Math.max(1, Math.round(ledCount)), led_offset: Math.max(0, Math.round(ledOffset)), test_image: testImage }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Could not save the light layout.");
      localStorage.setItem("wled-url", wledUrl);
      setLayoutMessage("TV-light layout saved. It will be restored after restarting the server.");
    } catch (error) { setLayoutMessage(error instanceof Error ? error.message : "Could not save the light layout."); }
  };

  const sendLayoutTest = async () => {
    const total = Math.max(1, Math.round(ledCount));
    const started = performance.now();
    setLayoutMessage("Sending layout test…");
    let stage = "sending the selected test image to the perimeter sampler";
    try {
      if (!testImage) throw new Error("Choose a test image first.");
      const colorResponse = await fetch(`${API_URL}/api/perimeter-colors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test_image: testImage, led_count: total }) });
      const colorResult = await colorResponse.json();
      if (!colorResponse.ok) throw new Error(colorResult.detail || "Could not sample the test image perimeter.");
      const sampledColors = colorResult.colors as [number, number, number][];
      const colors = sampledColors.map((_, physicalIndex) => {
        const logicalIndex = ((physicalIndex - ledOffset) % total + total) % total;
        return sampledColors[logicalIndex].map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase();
      });
      const socketUrl = new URL(wledUrl);
      socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
      socketUrl.pathname = `${socketUrl.pathname.replace(/\/$/, "")}/ws`;
      stage = "connecting to WLED";
      await new Promise<void>((resolve, reject) => {
        const socket = new WebSocket(socketUrl);
        const timeout = window.setTimeout(() => { socket.close(); reject(new Error("WLED WebSocket timed out.")); }, 1500);
        socket.onopen = () => {
          socket.send(JSON.stringify({ on: true, bri: 180, tt: 0, transition: 0 }));
          for (let start = 0; start < colors.length; start += 256) {
            socket.send(JSON.stringify({ seg: [{ id: 0, i: [start, ...colors.slice(start, start + 256)] }] }));
          }
          window.setTimeout(() => { window.clearTimeout(timeout); socket.close(); resolve(); }, 100);
        };
        socket.onerror = () => { window.clearTimeout(timeout); socket.close(); reject(new Error("WLED WebSocket connection failed.")); };
      });
      setLayoutMessage(`Test-image perimeter sent · ${total} LEDs · ${Math.round(performance.now() - started)} ms`);
    } catch (error) {
      console.error(`WLED layout test failed while ${stage}.`, error);
      const message = error instanceof Error ? error.message : "Could not send the layout test.";
      setLayoutMessage(`Failed while ${stage}: ${message}`);
    }
  };

  useLightingOutput({ enabled: isBacklightRunning && (screen === "monitor" || screen === "calibrate"), url: wledUrl, offset: ledOffset, ceiling, level: lightingLevel, audio: audioEnabled, target: targetColors, onError: message => { setRunMessage(message); setIsBacklightRunning(false); } });

  function resetScene() {
    sceneGeneration.current++;
    stopBacklight();
    setSelectedPreset(null); setPresetName(""); setPresetMessage("");
    setCorners(defaultCorners()); setActiveCorner(null); setVideoSize([16, 9]);
    setBrightness(0); setSaturation(1); setAspectRatio(16 / 9);
    setContrast(1); setGamma(1); setRedGain(1); setGreenGain(1); setBlueGain(1);
    setPerimeterDepth(16); setLetterboxDetection(true); setHighlightProtection(0.35);
    setCornerBlend(0.35); setViewingMode("accurate");
    setDeviceId(""); setMicrophoneId(""); setTestMicrophone(false); setCameraReady(false);
    setCameraError(""); setCameraListError(""); setCameraScanMessage("");
    setMicrophoneError(""); setMicrophoneListError(""); setMicrophoneScanMessage("");
    setMicrophoneLevel(0); setAudioActive(false); setVolumeReactive(false);
    setMinReactiveBrightness(35); setMaxReactiveBrightness(180);
    setLightingLevel("high"); setCeiling(20); setSessionMode("screen"); setMusicColor("#7456e8");
    setCorrected(""); setDiagnostic(""); setRgb(null); setAnalysisError("");
    setRunMessage(""); setWledMessage("");
  }

  function startScene(mode: SessionMode = "screen") {
    resetScene();
    setSessionMode(mode); setVolumeReactive(mode === "blend");
    setScreen(mode === "music" ? "music" : "camera"); window.scrollTo(0, 0);
  }

  async function turnLightsOff() {
    stopBacklight(); setRunMessage(""); setTurningOff(true);
    try { await testWled(null); } finally { setTurningOff(false); }
  }

  useEffect(() => {
    if (activeCorner === null) return;
    let frame = 0;
    const draw = () => {
      const source = calibrationVideo.current;
      const canvas = loupe.current;
      if (source?.videoWidth && canvas) {
        const context = canvas.getContext("2d");
        if (context) {
          const [x, y] = corners[activeCorner];
          const size = source.videoWidth / 5;
          context.fillStyle = "#030508"; context.fillRect(0, 0, 160, 160);
          context.drawImage(source, x / 100 * source.videoWidth - size / 2, y / 100 * source.videoHeight - size / 2, size, size, 0, 0, 160, 160);
          context.strokeStyle = "#fff"; context.lineWidth = 2;
          context.beginPath(); context.moveTo(68, 80); context.lineTo(92, 80);
          context.moveTo(80, 68); context.lineTo(80, 92); context.stroke();
        }
      }
      frame = requestAnimationFrame(draw);
    };
    draw(); return () => cancelAnimationFrame(frame);
  }, [activeCorner, corners]);

  const audioControls = <section className="audio-status">
    <label className="checkbox"><input type="checkbox" checked={volumeReactive} onChange={event => { setVolumeReactive(event.target.checked); setSessionMode(event.target.checked ? "blend" : "screen"); }} /> Let sound gently lift brightness</label>
    {volumeReactive && <p className="muted">{viewingMode === "night" ? "Night keeps lighting calm. Audio lift is disabled until you choose another mood." : isBacklightRunning ? (audioActive ? `Audio lift active · ${microphoneLevel}% energy · capped at ${ceiling}% brightness` : "Starting audio lift… Allow microphone access when prompted.") : "Audio lift will start with your lights. Your microphone stays on this device."}</p>}
    {audioActive && <div className="level-meter" role="meter" aria-label="Audio lift energy" aria-valuenow={microphoneLevel} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${microphoneLevel}%` }} /></div>}
    {microphoneError && <p className="error" role="alert">{microphoneError}</p>}
  </section>;
  const offControl = <><button className="secondary" disabled={turningOff} onClick={() => void turnLightsOff()}>{turningOff ? "Turning lights off…" : "Turn lights off"}</button>{wledMessage && <p role="status" className="notice">{wledMessage}</p>}</>;

  function navigate(next: Screen) { sceneGeneration.current++; stopBacklight(); setRunMessage(""); setTestMicrophone(false); setWledMessage(""); setCameraError(""); setMicrophoneError(""); setScreen(next); window.scrollTo(0, 0); }
  const lightingControls = <section className="lighting-controls"><div className="section-heading"><h2>Light style</h2></div><div className="level-options">{(["low", "medium", "high"] as const).map((level, index) => <button key={level} aria-pressed={lightingLevel === level} className={lightingLevel === level ? "selected" : "secondary"} onClick={() => setLightingLevel(level)}><strong>{["Glow", "Balanced", "Immersive"][index]}</strong><small>{["1 color", "6 zones", "12 zones"][index]}</small></button>)}</div><p className="style-description">{lightingLevel === "low" ? "Calm, soft light for dialogue and relaxed viewing." : lightingLevel === "medium" ? "More movement without becoming distracting." : "Screen-edge color matching for action, animation, and games."}</p><label>Brightness <output>{ceiling}%</output><input aria-label="Brightness" type="range" min="1" max="100" value={ceiling} onChange={e => setCeiling(Number(e.target.value))} /></label></section>;

  return (
    <main className={["camera", "calibrate", "monitor"].includes(screen) ? "focused-flow" : ""}>
      <header className="app-header"><button className="brand" onClick={() => navigate("welcome")} aria-label="Aurora home"><span>Λ</span> AURORA</button><button className="room" onClick={() => navigate("light-map")}><span className={controllerStatus === "Connected" ? "status-dot connected" : "status-dot"} /><span>Living Room<small>{controllerStatus}</small></span><span>⌄</span></button></header>
      {serviceError && <p role="alert" className="error banner">{serviceError}</p>}
      {screen === "welcome" && <section className="welcome">
        <div className="hero-art" role="img" aria-label="A television showing mountains surrounded by blue and violet ambient lighting" />
        <div className="hero-copy"><p className="eyebrow">YOUR ROOM. A DIFFERENT FEELING.</p><h1>Make your room<br />feel alive.</h1><p className="intro">Match the TV, follow the music, or blend both.</p><button className="start-session" onClick={() => navigate("session")}>Start a session <span>→</span></button><p className="hero-footnote">A little light. A whole new atmosphere.</p></div>
        <section className="preset-panel"><div className="section-heading"><h2>Saved scenes</h2><button className="text-button" onClick={() => startScene()}>New scene ＋</button></div>
          <div className="preset-list">{Object.keys(presets).length ? Object.keys(presets).map(name => <div className="preset-row" key={name}><button className="preset" onClick={() => loadPreset(name)}><span className="scene-art" /><span>{name}<small>{presets[name].sessionMode === "blend" ? "TV with gentle audio energy" : "Your calibrated TV lighting"}</small></span><span aria-hidden="true">↗</span></button><button className="delete-preset" aria-label={`Delete ${name}`} onClick={() => deletePreset(name)}>×</button></div>) : <div className="empty-scenes"><span className="scene-symbol">✧</span><div><h3>Your next favorite evening starts here.</h3><p>Set up your TV and save a scene to start it with one tap.</p></div><button className="secondary" onClick={() => startScene()}>Create a scene →</button></div>}</div>
          {presetMessage && <p role="status" className="notice">{presetMessage}</p>}
        </section></section>}
      {screen === "session" && <section className="session-screen"><p className="eyebrow">SET THE MOOD</p><h1>What’s on tonight?</h1><p className="intro">Choose what your lights follow. You can change the feeling at any time.</p><div className="mode-cards">{(["screen", "music", "blend"] as const).map(mode => <button className="mode-card" key={mode} onClick={() => startScene(mode)}><span className="mode-icon">{mode === "screen" ? "▣" : mode === "music" ? "♫" : "✧"}</span><h2>{mode === "screen" ? "Watch TV" : mode === "music" ? "Listen to music" : "TV + music"}</h2><p>{mode === "screen" ? "Bring the picture into your room." : mode === "music" ? "Let sound set the energy. No camera needed." : "Screen colors, with an optional gentle audio lift."}</p><span>Get started →</span></button>)}</div></section>}
      {screen === "music" && <section className="music-screen"><p className="eyebrow">SOUND MEETS ATMOSPHERE</p><h1>Give your music<br />some color.</h1><p className="intro">A steady color with brightness that follows the room’s sound. Soft rises, slow fades.</p><div className="music-orb" style={{ background: musicColor, boxShadow: `0 0 ${40 + microphoneLevel}px ${musicColor}66` }} /><section className="music-controls"><label>Room color<input aria-label="Music color" type="color" value={musicColor} disabled={isBacklightRunning} onChange={e => setMusicColor(e.target.value)} /></label><label>Maximum brightness <output>{ceiling}%</output><input aria-label="Brightness" type="range" min="1" max="100" value={ceiling} onChange={e => setCeiling(Number(e.target.value))} /></label><div className="level-meter" role="meter" aria-label="Microphone level" aria-valuenow={microphoneLevel} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${microphoneLevel}%` }} /></div><p className="muted">Your microphone stays on this device. Allow access when you start.</p><button disabled={turningOff} onClick={async () => { if (isBacklightRunning) { stopBacklight(); return; } setSessionMode("music"); setWledMessage(""); const generation = runGeneration.current; try { await sendLedColors(Array.from({ length: ledCount }, () => [parseInt(musicColor.slice(1,3),16), parseInt(musicColor.slice(3,5),16), parseInt(musicColor.slice(5,7),16)])); if (generation === runGeneration.current) setIsBacklightRunning(true); } catch { setMicrophoneError("Cannot connect to your lights. Check the controller in Settings."); } }}>{isBacklightRunning ? "Freeze lights" : "Start music lighting →"}</button><p className="muted">Freeze keeps the current colors. Turn off switches the lights off.</p>{offControl}{microphoneError && <p className="error" role="alert">{microphoneError}</p>}{cameraError && <p className="error">{cameraError}</p>}</section></section>}

      {screen === "light-map" && (
        <section className="light-map-screen">
          <button className="text-button" onClick={() => navigate("welcome")}>← Home</button>
          <p className="eyebrow">ROOM SETTINGS</p><h1>Make the connection.</h1>
          <p className="intro">Use a color-rich test image on your TV, then rotate the WLED mapping until the physical strip follows the matching screen edges.</p>
          <p className="mirror-note">For this step, screen mirroring is recommended: mirror this browser window to the TV so the same test image is visible on both screens.</p>
          <div className="light-map-grid">
            <section className="light-map-settings">
              <h2>{controllerStatus === "Connected" ? "Your lights are connected" : "Connect your lights"}</h2>
              <p className="muted controller-status">{controllerStatus} · {ledCount} LEDs</p>
              <button className="secondary" disabled={detectingLights} onClick={() => void detectLedCount()}>{detectingLights ? "Finding your lights…" : "Detect LED count"}</button>
              {wledUrl.includes(".local") && <p className="notice">For faster connections, use your controller’s IP address. A .local address can take several seconds to resolve.</p>}
              {controllerIp && wledUrl.includes(".local") && <button className="secondary" onClick={() => { setWledUrl(`http://${controllerIp}`); setLayoutMessage("Direct IP selected. Save layout to keep this address."); }}>Use direct IP · {controllerIp}</button>}
              <details className="controller-advanced"><summary>Advanced controller settings</summary>
                <label>WLED controller URL<input value={wledUrl} onChange={(event) => { setWledUrl(event.target.value); setControllerIp(""); }} /></label>
                <label>LED count<input type="number" min="1" max="1200" value={ledCount} onChange={(event) => { const count = Math.min(1200, Math.max(1, Number(event.target.value))); setLedCount(count); setLedOffset(current => current % count); }} /></label>
                <label>Layout offset <input type="range" min="0" max={Math.max(0, ledCount - 1)} step="1" value={ledOffset} onChange={(event) => setLedOffset(Number(event.target.value))} /><output>{ledOffset} LEDs</output></label>
              </details>
              <div className="wled-actions"><button onClick={() => testWled([255, 0, 0])}>Red</button><button onClick={() => testWled([0, 255, 0])}>Green</button><button onClick={() => testWled([0, 0, 255])}>Blue</button><button onClick={() => testWled([255, 255, 255])}>White</button><button className="off" onClick={() => testWled(null)}>Off</button></div>
              {wledMessage && <p className="notice">{wledMessage}</p>}
              <h2>Physical layout</h2>
              <p className="muted">LED 0 starts at bottom centre and travels clockwise. The test sends the actual colors sampled from the selected TV test image—no artificial color pattern.</p>
              <p className="muted">Show the test image, then move the colors until they line up with your TV.</p>
              <div className="rotation-controls"><button className="secondary" onClick={() => setLedOffset(current => (current - 1 + ledCount) % ledCount)}>↶ Move counterclockwise</button><button className="secondary" onClick={() => setLedOffset(current => (current + 1) % ledCount)}>Move clockwise ↷</button></div>
              <p className="muted">Position {ledOffset + 1} of {ledCount} · press Show layout test to see the change.</p>
              <div className="layout-actions"><button onClick={sendLayoutTest}>Show layout test</button><button className="secondary" onClick={saveWledLayout}>Save layout</button></div>
              {layoutMessage && <p className="notice">{layoutMessage}</p>}
            </section>
            <section className="test-image-panel">
              <h2>TV test image</h2>
              {testImage ? <img src={`${API_URL}/api/test-images/${encodeURIComponent(testImage)}`} alt={`Color test image ${testImage}`} /> : <div className="empty-preview">No test images found in test_images.</div>}
              <div className="image-picker">{testImages.map((image) => <button className={testImage === image ? "active" : "secondary"} key={image} onClick={() => setTestImage(image)}>{image.replace(/\.[^.]+$/, "")}</button>)}</div>
              <p className="muted">Choose an image, mirror it to the TV, then use the offset slider until the physical lights match the perimeter pattern. New files added to test_images appear here after a refresh.</p>
            </section>
          </div>
        </section>
      )}

      {screen === "camera" && (
        <section className="setup">
          <button className="text-button" onClick={() => navigate("welcome")}>← Welcome</button>
          <h1>Choose your camera.</h1>
          <p className="intro">Pick the camera pointed at your TV.</p>
          <p className="eyebrow">SETUP · 1 OF 2</p>
          {selectedPreset && <p className="notice">Editing “{selectedPreset}”. Your saved alignment and tuning are loaded.</p>}
          <div className="device-row"><label>Camera<select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">Default camera</option>{deviceId && !devices.some(device => device.deviceId === deviceId) && <option value={deviceId}>Selected camera (unavailable)</option>}{devices.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}</select></label><button className="secondary" onClick={() => void scanCameras()}>Refresh</button></div>
          {cameraScanMessage && <p className="notice" role="status">{cameraScanMessage}</p>}
          {cameraListError && <p className="error" role="alert">{cameraListError}</p>}
          {!cameraReady && !cameraError && <p role="status" className="muted">Waiting for camera access… You can select another camera while waiting.</p>}
          {cameraError && <p className="error" role="alert">{cameraError}</p>}<video ref={video} autoPlay muted playsInline />
          <details className="microphone-test" open={sessionMode === "blend" || undefined}>
            <summary>Microphone <span>Optional</span></summary>
            {audioControls}
            <button className="secondary" onClick={() => void scanMicrophones()}>Refresh microphones</button>
            {microphoneScanMessage && <p className="notice" role="status">{microphoneScanMessage}</p>}
            {microphoneListError && <p className="error" role="alert">{microphoneListError}</p>}
            <label>TV microphone
              <select value={microphoneId} onChange={(event) => setMicrophoneId(event.target.value)}>
                <option value="">Default microphone</option>
                {microphoneId && !microphones.some(device => device.deviceId === microphoneId) && <option value={microphoneId}>Selected microphone (unavailable)</option>}
                {microphones.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
              </select>
            </label>
            <button className="secondary" onClick={() => setTestMicrophone(!testMicrophone)}>{testMicrophone ? "Stop microphone test" : "Test selected microphone"}</button>
            {microphoneError ? <p className="error">{microphoneError}</p> : <div className="level-meter" aria-label={`Microphone level ${microphoneLevel}%`}><div style={{ width: `${microphoneLevel}%` }} /></div>}
          </details>
          <button className="continue" disabled={!cameraReady || !!cameraError} onClick={() => navigate("calibrate")}>Continue →</button>
        </section>
      )}

      {screen === "calibrate" && (
        <section className="calibration">
          <button className="text-button" onClick={() => navigate("camera")}>← Choose another camera</button>
          <p className="eyebrow">SETUP · 2 OF 2</p><h1>Frame your TV.</h1>
          <p className="intro">Place dots 1–4 on the visible picture corners, inside the bezel and light glow. Drag or use arrow keys for precision.</p>
          <div className="calibration-grid">
            <aside className="controls">{lightingControls}{audioControls}
              {isBacklightRunning ? <button className="stop primary-action" onClick={stopBacklight}>Freeze lights</button> : <button className="primary-action" disabled={turningOff || !!cameraError} onClick={() => { setWledMessage(""); setRunMessage("Starting lighting…"); setIsBacklightRunning(true); }}>Preview on lights</button>}
              {offControl}
              {runMessage && <p className={/^(Live|Starting|Opening|Lights frozen)/.test(runMessage) ? "notice live-status" : "error"}>{runMessage}</p>}
              <details className="advanced-settings"><summary>Advanced calibration</summary><label>Exposure <input type="range" min="-100" max="100" value={brightness} onChange={(event) => setBrightness(Number(event.target.value))} /><output>{brightness}</output></label><label>Saturation <input type="range" min="0" max="2" step="0.05" value={saturation} onChange={(event) => setSaturation(Number(event.target.value))} /><output>{saturation.toFixed(2)}</output></label><label>TV shape <select value={aspectRatio} onChange={(event) => setAspectRatio(Number(event.target.value))}><option value={16 / 9}>16:9</option><option value={21 / 9}>21:9</option><option value={4 / 3}>4:3</option></select></label><label>Edge depth <input type="range" min="2" max="80" step="1" value={perimeterDepth} onChange={(event) => setPerimeterDepth(Number(event.target.value))} /><output>{perimeterDepth} px</output></label><label>Color mood <select value={viewingMode} onChange={(event) => setViewingMode(event.target.value)}><option value="accurate">Natural</option><option value="cinema">Cinema</option><option value="vivid">Vivid</option><option value="night">Night</option></select></label><label className="checkbox"><input type="checkbox" checked={letterboxDetection} onChange={(event) => setLetterboxDetection(event.target.checked)} /> Ignore black bars</label><details className="fine-tuning"><summary>Fine color controls</summary><label>Contrast <input type="range" min="0.5" max="2" step="0.05" value={contrast} onChange={(event) => setContrast(Number(event.target.value))} /><output>{contrast.toFixed(2)}</output></label><label>Gamma <input type="range" min="0.5" max="2" step="0.05" value={gamma} onChange={(event) => setGamma(Number(event.target.value))} /><output>{gamma.toFixed(2)}</output></label><label>Red <input type="range" min="0.5" max="2" step="0.05" value={redGain} onChange={(event) => setRedGain(Number(event.target.value))} /><output>{redGain.toFixed(2)}</output></label><label>Green <input type="range" min="0.5" max="2" step="0.05" value={greenGain} onChange={(event) => setGreenGain(Number(event.target.value))} /><output>{greenGain.toFixed(2)}</output></label><label>Blue <input type="range" min="0.5" max="2" step="0.05" value={blueGain} onChange={(event) => setBlueGain(Number(event.target.value))} /><output>{blueGain.toFixed(2)}</output></label><label>Highlight protection <input type="range" min="0" max="1" step="0.05" value={highlightProtection} onChange={(event) => setHighlightProtection(Number(event.target.value))} /><output>{Math.round(highlightProtection * 100)}%</output></label><label>Corner blending <input type="range" min="0" max="1" step="0.05" value={cornerBlend} onChange={(event) => setCornerBlend(Number(event.target.value))} /><output>{Math.round(cornerBlend * 100)}%</output></label></details></details>
              <div className="save-scene"><label>Scene name <input value={presetName} placeholder="Living room" onChange={(event) => setPresetName(event.target.value)} /></label><button className="save" onClick={savePreset} disabled={!presetName.trim()}>{selectedPreset === presetName.trim() ? "Update scene" : "Save scene"}</button></div>
              {presetMessage && <p className="notice">{presetMessage}</p>}
              {analysisError && <p className="error">{analysisError}</p>}
            </aside>
            <div>{cameraError && <p className="error" role="alert">{cameraError}</p>}<h2>Camera feed</h2><div className="corner-editor" style={{ aspectRatio: `${videoSize[0]} / ${videoSize[1]}` }}><video ref={calibrationVideo} onLoadedMetadata={(event) => setVideoSize([event.currentTarget.videoWidth, event.currentTarget.videoHeight])} autoPlay muted playsInline /><svg viewBox="0 0 100 100" preserveAspectRatio="none">{corners.map(([x, y], index) => <circle key={index} cx={0} cy={0} transform={`translate(${x} ${y}) scale(1 ${videoSize[0] / videoSize[1]})`} r="2" tabIndex={0} role="slider" aria-label={`TV corner ${index + 1}`} aria-valuetext={`${Math.round(x)}%, ${Math.round(y)}%`} onKeyDown={(event) => { const delta: Record<string, number[]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }; if (delta[event.key]) { event.preventDefault(); const [dx, dy] = delta[event.key]; setCorners(current => current.map((point, i) => i === index ? [Math.max(0, Math.min(100, point[0] + dx)), Math.max(0, Math.min(100, point[1] + dy))] : point)); } }} onFocus={() => setActiveCorner(index)} onBlur={() => setActiveCorner(null)} onLostPointerCapture={() => setActiveCorner(null)} onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setActiveCorner(null); }} onPointerDown={(event) => { setActiveCorner(index); event.currentTarget.setPointerCapture(event.pointerId); moveCorner(index, event); }} onPointerMove={(event) => event.currentTarget.hasPointerCapture(event.pointerId) && moveCorner(index, event)} />)}{corners.map(([x, y], index) => <text key={`label-${index}`} x={0} y={0} transform={`translate(${x} ${y}) scale(1 ${videoSize[0] / videoSize[1]})`} className="corner-label" textAnchor="middle" dominantBaseline="central">{index + 1}</text>)}<polygon points={corners.map(([x,y]) => `${x},${y}`).join(" ")} /></svg></div><div className="alignment-help"><button className="secondary" onClick={() => setCorners(defaultCorners())}>Reset corners</button><p className="muted">Check all four corners against the corrected image before saving.</p>{activeCorner !== null && <figure className="corner-loupe"><canvas ref={loupe} width={160} height={160} /><figcaption>Corner {activeCorner + 1} · magnified</figcaption></figure>}</div></div>
            <div><h2>Corrected TV image</h2>{corrected ? <img className="corrected" src={corrected} alt="Perspective-corrected TV" /> : <div className="empty-preview">Capture a frame after aligning the four corners.</div>}{diagnostic && <details className="sampling-diagnostic"><summary>Show sampling diagnostic</summary><img className="corrected" src={diagnostic} alt="TV edge sampling diagnostic" /><p className="muted">Green marks active picture content; yellow marks the inward sampling boundary.</p></details>}</div>
          </div>
        </section>
      )}

      {screen === "monitor" && (
        <section className="monitor">
          <button className="text-button" onClick={() => { stopBacklight(); setScreen("welcome"); }}>← Home</button>
          <h1>{isBacklightRunning ? "Backlight is running." : "Backlight is stopped."}</h1>
          <p className="intro">{selectedPreset ? `Using the “${selectedPreset}” preset.` : "Using the current calibration."} Your lights follow the corrected picture with smooth, level-specific fades.</p>
          {lightingControls}
          {audioControls}
          {cameraError ? <div className="error-recovery"><p className="error">{cameraError}</p><button onClick={() => { setCameraError(""); setScreen("camera"); window.scrollTo(0, 0); }}>Choose camera</button></div> : <div className="monitor-grid"><div><h2>Live camera feed</h2><video ref={monitorVideo} autoPlay muted playsInline /></div><div><h2>Corrected TV image</h2>{corrected ? <img className="corrected" src={corrected} alt="Live corrected TV" /> : <div className="empty-preview">Loading the saved calibration…</div>}<p className="rgb">LED output: {rgb ? `RGB (${rgb.join(", ")})` : "Calculating…"}</p>{diagnostic && <details className="sampling-diagnostic"><summary>Show sampling diagnostic</summary><img className="corrected" src={diagnostic} alt="TV edge sampling diagnostic" /><p className="muted">Green: active picture. Yellow: sampling boundary.</p></details>}</div></div>}
          {runMessage && <p className={/^(Live|Starting|Opening|Lights frozen)/.test(runMessage) ? "notice" : "error"}>{runMessage}</p>}
          <div className="layout-actions">{isBacklightRunning ? <button className="stop" onClick={stopBacklight}>Freeze lights</button> : <button disabled={!!cameraError || turningOff} onClick={() => { setWledMessage(""); setRunMessage("Starting lighting…"); setIsBacklightRunning(true); }}>Run backlight</button>}<button className="secondary" onClick={() => { stopBacklight(); setScreen("calibrate"); }}>Edit this preset</button>{offControl}</div>
        </section>
      )}
      {!["camera", "calibrate", "monitor"].includes(screen) && <nav className="bottom-nav" aria-label="Main navigation">{([["welcome", "⌂", "Home"], ["music", "♫", "Music"], ["light-map", "⚙", "Settings"]] as const).map(([page, icon, label]) => <button key={page} aria-current={screen === page ? "page" : undefined} onClick={() => page === "music" ? startScene("music") : navigate(page)}><span aria-hidden="true">{icon}</span>{label}</button>)}</nav>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
