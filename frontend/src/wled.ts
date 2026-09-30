type ControllerInfo = { led_count: number; ip?: string };

/** Read WLED's initial WebSocket info before falling back to server-side DNS. */
export async function readControllerInfo(address: string, apiUrl: string): Promise<ControllerInfo> {
  try {
    return await new Promise<ControllerInfo>((resolve, reject) => {
      const url = new URL(address);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
      const socket = new WebSocket(url);
      const finish = (result?: ControllerInfo) => {
        clearTimeout(timer); socket.onerror = null; socket.onclose = null; socket.close();
        if (result) resolve(result); else reject(new Error("Controller discovery timed out."));
      };
      const timer = window.setTimeout(() => finish(), 1500);
      socket.onmessage = event => {
        try {
          const { info } = JSON.parse(event.data);
          const count = info?.leds?.count;
          if (Number.isInteger(count) && count > 0 && count <= 1200) {
            const ip = typeof info.ip === "string" && /^(\d{1,3}\.){3}\d{1,3}$/.test(info.ip) && info.ip.split(".").every((part: string) => Number(part) <= 255) ? info.ip : undefined;
            finish({ led_count: count, ip });
          }
        } catch { /* Ignore unrelated state messages. */ }
      };
      socket.onerror = () => finish();
      socket.onclose = () => finish();
    });
  } catch {
    const response = await fetch(`${apiUrl}/api/wled/info?url=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok || !Number.isInteger(result.led_count) || result.led_count < 1 || result.led_count > 1200) {
      throw new Error(result.detail || "Could not read your lights. Check the controller address and try again.");
    }
    return { led_count: result.led_count };
  }
}
