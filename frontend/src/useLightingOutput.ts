import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";

export type Color = [number, number, number];

/** Ease between sampled frames independently of capture/network latency. */
export function useLightingOutput(options: {
  enabled: boolean; url: string; offset: number; ceiling: number;
  level: "low" | "medium" | "high"; audio: boolean;
  target: MutableRefObject<Color[] | null>;
  onError: (message: string) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (!options.enabled) return;
    let socket: WebSocket;
    let current: number[][] | null = null;
    let sent: Color[] | null = null;
    let lastBrightness = -1;
    let wasAudio = false;
    let lastTime = performance.now();
    try {
      const url = new URL(options.url);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/ws";
      socket = new WebSocket(url);
    } catch { options.onError("Enter a valid WLED http(s) address in Settings."); return; }
    const timeout = window.setTimeout(() => {
      if (socket.readyState !== WebSocket.OPEN) { socket.close(); latest.current.onError("WLED connection timed out. Check Settings and restart lighting."); }
    }, 3000);
    socket.onerror = () => latest.current.onError("Lost connection to WLED. Check Settings and restart lighting.");
    socket.onopen = () => window.clearTimeout(timeout);
    const timer = window.setInterval(() => {
      const { target, level, ceiling, offset, audio } = latest.current;
      const incoming = target.current;
      const now = performance.now();
      const dt = Math.min(100, now - lastTime);
      lastTime = now;
      if (!incoming || socket.readyState !== WebSocket.OPEN) return;
      if (!current || current.length !== incoming.length) current = incoming.map(() => [0, 0, 0]);
      const averageChange = incoming.reduce((sum, color, i) => sum + color.reduce((n, c, j) => n + Math.abs(c - current![i][j]), 0), 0) / (incoming.length * 3);
      const sceneCut = averageChange > 46 && level !== "low";
      current = incoming.map((color, i) => color.map((value, j) => {
        const rising = value > current![i][j];
        const tau = level === "low" ? (rising ? 800 : 1500) : level === "medium" ? (rising ? 250 : 700) : (rising ? 150 : 450);
        const alpha = 1 - Math.exp(-dt / (sceneCut ? Math.min(tau, 180) : tau));
        return current![i][j] + (value - current![i][j]) * alpha;
      }));
      const colors = current.map(c => c.map(Math.round) as Color);
      const bri = Math.round(ceiling * (audio ? 0.75 : 1) * 2.55);
      if (!audio && (lastBrightness < 0 || bri !== lastBrightness || wasAudio)) {
        socket.send(JSON.stringify({ on: true, bri, transition: 0 })); lastBrightness = bri;
      }
      wasAudio = audio;
      if (sent && colors.every((c, i) => c.every((v, j) => Math.abs(v - sent![i][j]) < 2))) return;
      const hex = colors.map((_, i) => colors[((i - offset) % colors.length + colors.length) % colors.length].map(c => c.toString(16).padStart(2, "0")).join(""));
      socket.send(JSON.stringify({ on: true, tt: 0 }));
      for (let start = 0; start < hex.length; start += 256) socket.send(JSON.stringify({ seg: [{ id: 0, i: [start, ...hex.slice(start, start + 256)] }] }));
      sent = colors;
    }, 50);
    return () => { clearInterval(timer); clearTimeout(timeout); socket.onerror = null; socket.close(); };
  }, [options.enabled, options.url]);
}
