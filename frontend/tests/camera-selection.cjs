// Standalone: run with Vite and npm-installed Playwright. Also included in npm test.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

async function runCameraSelection(page) {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.addInitScript(() => {
      window.WebSocket = class {
        static OPEN = 1;
        constructor() { this.readyState = 0; setTimeout(() => { if (this.readyState !== 3) { this.readyState = 1; this.onopen?.(); } }, 0); }
        send() {} close() { this.readyState = 3; }
      };
      const media = new EventTarget();
      window.cameraMock = { ids: ['usb-one'], microphoneIds: ['usb-mic-one'], streams: [], audioContexts: [], requests: [] };
      media.enumerateDevices = async () => [
        ...window.cameraMock.ids.map(deviceId => ({
          kind: 'videoinput', deviceId, label: `USB ${deviceId}`, groupId: deviceId,
        })),
        ...window.cameraMock.microphoneIds.map(deviceId => ({
          kind: 'audioinput', deviceId, label: `USB ${deviceId}`, groupId: deviceId,
        })),
      ];
      media.getUserMedia = async constraints => {
        const id = constraints.video?.deviceId?.exact || constraints.audio?.deviceId?.exact;
        window.cameraMock.requests.push(id || 'default');
        if (constraints.audio) {
          const context = new AudioContext();
          const oscillator = context.createOscillator();
          const destination = context.createMediaStreamDestination();
          oscillator.connect(destination); oscillator.start();
          window.cameraMock.audioContexts.push(context);
          window.cameraMock.streams.push(destination.stream);
          return destination.stream;
        }
        if (!id) throw new DOMException('Default camera busy', 'NotReadableError');
        const canvas = document.createElement('canvas');
        canvas.width = 320; canvas.height = 180;
        canvas.getContext('2d').fillRect(0, 0, 320, 180);
        const stream = canvas.captureStream(1);
        window.cameraMock.streams.push(stream);
        return stream;
      };
      Object.defineProperty(navigator, 'mediaDevices', { value: media });
    });
    await page.goto(process.env.APP_URL || 'http://localhost:5173');
    await page.getByRole('button', { name: 'Create a scene' }).click();
    const camera = page.getByRole('combobox').first();
    await page.getByText('This camera could not start.', { exact: false }).waitFor();
    assert.equal(await camera.locator('option').count(), 2, 'USB listed despite default failure');
    assert.equal(await page.getByRole('button', { name: 'Continue →' }).isDisabled(), true);
    await camera.selectOption('usb-one');
    await page.waitForFunction(() => document.querySelector('video')?.srcObject);
    assert.equal(await page.getByRole('button', { name: 'Continue →' }).isEnabled(), true);
    await page.evaluate(() => {
      window.cameraMock.ids.push('usb-two');
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    await page.waitForFunction(() => document.querySelector('option[value="usb-two"]'));
    await camera.selectOption('usb-two');
    await page.waitForFunction(() => window.cameraMock.requests.at(-1) === 'usb-two');
    assert.equal(await page.evaluate(() => window.cameraMock.streams[0].getTracks()[0].readyState), 'ended');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForFunction(() => window.cameraMock.requests.filter(id => id === 'usb-two').length === 2);
    await page.locator('summary').filter({ hasText: 'Microphone' }).click();
    await page.getByRole('button', { name: 'Refresh microphones' }).click();
    const microphone = page.getByRole('combobox').nth(1);
    await page.waitForFunction(() => document.querySelector('option[value="usb-mic-one"]'));
    await microphone.selectOption('usb-mic-one');
    await page.getByRole('button', { name: 'Test selected microphone' }).click();
    await page.waitForFunction(() => window.cameraMock.requests.at(-1) === 'usb-mic-one');
    await page.evaluate(() => {
      window.cameraMock.microphoneIds.push('usb-mic-two');
      navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    await page.waitForFunction(() => document.querySelector('option[value="usb-mic-two"]'));
    await page.getByRole('button', { name: 'Stop microphone test' }).click();
    await page.getByRole('button', { name: 'Continue →' }).click();
    await page.waitForFunction(() => window.cameraMock.requests.filter(id => id === 'usb-two').length === 3);
    assert.deepEqual(errors, []);
    console.log('PASS: USB camera/microphone selection, permission scan, hot-plug discovery, stream cleanup, and calibration continuity');
}

module.exports = { runCameraSelection };
if (require.main === module) {
  (async () => {
    const browser = await chromium.launch({ headless: true,
      ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    try { await runCameraSelection(await browser.newPage()); }
    finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
