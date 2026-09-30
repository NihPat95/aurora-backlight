const { test, expect } = require('@playwright/test');
const { runCameraSelection } = require('./camera-selection.cjs');
const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7z8AAAAASUVORK5CYII=';

async function mockRoom(page, presets = {}) {
  const writes = [];
  const analysis = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let json = {};
    if (path === '/api/presets') {
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON(); writes.push(body); presets[body.name] = body.config;
      } else json = presets;
    }
    if (path === '/api/wled/layout') json = { url: 'http://controller.test.local', led_count: 90, led_offset: 4 };
    if (path === '/api/wled/info') json = { led_count: 90 };
    if (path === '/api/analyze') {
      analysis.push(route.request().postDataJSON());
      json = { rgb: [100, 30, 70], corrected: pixel, led_colors: Array.from({ length: 90 }, () => [100, 30, 70]) };
    }
    await route.fulfill({ json });
  });
  await page.addInitScript(() => {
    window.room = { messages: [], sockets: [], videoRequests: 0, audioRequests: 0, gains: [], streams: [], info: true };
    class Socket extends EventTarget {
      static OPEN = 1; static CLOSED = 3;
      readyState = 0;
      constructor(url) {
        super(); this.url = String(url); window.room.sockets.push(this);
        setTimeout(() => {
          if (this.readyState === 3) return;
          this.readyState = 1; this.onopen?.();
          setTimeout(() => { if (this.readyState === 1 && window.room.info) this.onmessage?.({ data: JSON.stringify({ info: { leds: { count: 90 }, ip: '192.0.2.1' } }) }); }, 5);
        }, 5);
      }
      send(data) { if (this.readyState === 1) window.room.messages.push(JSON.parse(data)); }
      close() { this.readyState = 3; }
    }
    window.WebSocket = Socket;
    const media = new EventTarget();
    media.enumerateDevices = async () => [
      { kind: 'videoinput', deviceId: 'camera', label: 'Test TV camera' },
      { kind: 'audioinput', deviceId: 'mic', label: 'Test microphone' },
    ];
    media.getUserMedia = async constraints => {
      let stream;
      if (constraints.audio) {
        window.room.audioRequests++;
        const context = new AudioContext();
        const osc = context.createOscillator(); const gain = context.createGain();
        gain.gain.value = 0; osc.connect(gain);
        const destination = context.createMediaStreamDestination(); gain.connect(destination);
        osc.start(); await context.resume(); window.room.gains.push(gain);
        stream = destination.stream;
      } else {
        window.room.videoRequests++;
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        canvas.getContext('2d').fillRect(0, 0, 320, 180); stream = canvas.captureStream(5);
      }
      window.room.streams.push(stream); return stream;
    };
    Object.defineProperty(navigator, 'mediaDevices', { value: media });
  });
  await page.goto('/');
  return { writes, analysis };
}
async function calibrate(page, blend = false) {
  if (blend) {
    await page.getByRole('button', { name: 'Start a session' }).click();
    await page.getByRole('button', { name: /TV \+ music/ }).click();
  } else await page.getByRole('button', { name: 'New scene' }).click();
  await page.getByRole('button', { name: 'Continue →' }).click();
}
const lastBrightness = page => page.evaluate(() => window.room.messages.filter(m => m.bri !== undefined).at(-1)?.bri);

test('USB camera failure recovery, hot-plug and stream cleanup', async ({ page, baseURL }) => {
  process.env.APP_URL = baseURL;
  await runCameraSelection(page);
});

test('TV + music responds below the ceiling, survives style changes and explains Night', async ({ page }) => {
  const { writes } = await mockRoom(page);
  await calibrate(page, true);
  await expect(page.getByLabel('Let sound gently lift brightness')).toBeChecked();
  await page.getByRole('button', { name: 'Preview on lights' }).click();
  await expect(page.getByText(/Audio lift active/)).toBeVisible();
  await expect.poll(() => lastBrightness(page)).toBe(38);
  await page.evaluate(() => window.room.gains.forEach(g => { g.gain.value = 0.6; }));
  await expect.poll(() => lastBrightness(page)).toBeGreaterThan(45);
  await expect.poll(() => lastBrightness(page)).toBeLessThanOrEqual(51);
  await page.getByRole('button', { name: /Glow/ }).click();
  await expect(page.getByText(/Audio lift active/)).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Brightness', exact: true })).toHaveValue('20');
  await page.getByText('Advanced calibration', { exact: true }).click();
  await page.getByLabel('Color mood').selectOption('night');
  await expect(page.getByText(/Night keeps lighting calm/)).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Audio lift energy' })).toHaveCount(0);
  await page.getByLabel('Color mood').selectOption('accurate');
  await expect(page.getByText(/Audio lift active/)).toBeVisible();
  await page.getByLabel('Scene name').fill('Sound scene');
  await page.getByRole('button', { name: 'Save scene', exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].config.volumeReactive).toBe(true);
  await page.getByRole('button', { name: 'Aurora home' }).click();
  await page.getByRole('button', { name: /^Sound scene/ }).click();
  await expect(page.getByText(/Audio lift active/)).toBeVisible();
  await page.getByLabel('Let sound gently lift brightness').uncheck();
  await expect(page.getByRole('meter', { name: 'Audio lift energy' })).toHaveCount(0);
});

test('new scenes reset geometry, devices, messages and tuning; edits preserve settings and prevent overwrite', async ({ page }) => {
  const saved = { corners: [[5, 6], [95, 6], [95, 94], [5, 94]], brightness: 35, saturation: 1.4, ceiling: 42, deviceId: 'camera', microphoneId: 'mic', sessionMode: 'blend', volumeReactive: true, viewingMode: 'night' };
  const { writes } = await mockRoom(page, { Favorite: saved, Other: { brightness: 5 } });
  await page.getByRole('button', { name: /^Favorite/ }).click();
  await page.getByRole('button', { name: 'Edit this preset' }).click();
  await expect(page.getByLabel('Scene name')).toHaveValue('Favorite');
  await expect(page.getByRole('slider', { name: 'TV corner 1', exact: true })).toHaveAttribute('aria-valuetext', '5%, 6%');
  await page.getByRole('button', { name: 'Update scene' }).click();
  await expect(page.getByText('Saved “Favorite”.')).toBeVisible();
  await page.getByRole('button', { name: 'Aurora home' }).click();
  await calibrate(page, true);
  await expect(page.getByLabel('Scene name')).toHaveValue('');
  await expect(page.getByText('Saved “Favorite”.')).toHaveCount(0);
  await expect(page.getByRole('slider', { name: 'TV corner 1', exact: true })).toHaveAttribute('aria-valuetext', '14%, 15%');
  await page.getByText('Advanced calibration', { exact: true }).click();
  await expect(page.getByLabel('Exposure')).toHaveValue('0');
  await expect(page.getByLabel('Saturation')).toHaveValue('1');
  await expect(page.getByLabel('Color mood')).toHaveValue('accurate');
  await page.getByLabel('Scene name').fill('Favorite');
  await page.getByRole('button', { name: 'Save scene', exact: true }).click();
  await expect(page.getByText(/A scene with this name already exists/)).toBeVisible();
  expect(writes.length).toBe(1);
  await page.getByRole('button', { name: 'Choose another camera' }).click();
  await expect(page.getByRole('combobox', { name: 'Camera', exact: true })).toHaveValue('');
  await expect(page.getByLabel('TV microphone')).toHaveValue('');
  await page.getByRole('button', { name: 'Aurora home' }).click();
  await page.getByRole('button', { name: /Other.*Your calibrated TV/ }).click();
  await page.getByRole('button', { name: 'Edit this preset' }).click();
  await page.getByText('Advanced calibration', { exact: true }).click();
  await expect(page.getByLabel('Saturation')).toHaveValue('1');
  await expect(page.getByLabel('Exposure')).toHaveValue('5');
});

test('styles preserve actual brightness; freeze stops writes and off stays off', async ({ page }) => {
  await mockRoom(page); await calibrate(page);
  await page.getByRole('button', { name: 'Preview on lights' }).click();
  await expect.poll(() => lastBrightness(page)).toBe(51);
  for (const name of ['Glow', 'Balanced', 'Immersive']) {
    await page.getByRole('button', { name: new RegExp(name) }).click();
    await expect(page.getByRole('slider', { name: 'Brightness', exact: true })).toHaveValue('20');
    await page.waitForTimeout(200);
    expect(await lastBrightness(page)).toBe(51);
  }
  await page.getByRole('button', { name: 'Freeze lights' }).click();
  const frozen = await page.evaluate(() => window.room.messages.length);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.room.messages.length)).toBe(frozen);
  await page.getByRole('button', { name: 'Preview on lights' }).click();
  await page.getByRole('button', { name: 'Turn lights off', exact: true }).click();
  await expect(page.getByText(/Lights turned off/)).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.room.messages.at(-1).on)).toBe(false);
});

for (const width of [320, 390, 1440]) test(`layout and corner controls at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await mockRoom(page);
  await expect(page.getByRole('navigation')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const brand = await page.locator('.brand').boundingBox();
  expect(brand.height).toBeLessThan(55);
  await calibrate(page);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  const corner = page.getByRole('slider', { name: 'TV corner 1', exact: true });
  await corner.focus(); await corner.press('ArrowRight');
  await expect(corner).toHaveAttribute('aria-valuetext', '15%, 15%');
  await expect(page.locator('.corner-loupe')).toBeVisible();
  await page.getByRole('button', { name: 'Reset corners' }).click();
  await expect(corner).toHaveAttribute('aria-valuetext', '14%, 15%');
  expect(await page.locator('.corner-label').allTextContents()).toEqual(['1', '2', '3', '4']);
  await page.getByLabel('Scene name').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/calibration-${width}.png`, fullPage: true });
});

test('controller discovery uses direct info, retains rotation and offers verified IP', async ({ page }) => {
  await mockRoom(page);
  let serverLookups = 0;
  page.on('request', req => { if (req.url().includes('/api/wled/info')) serverLookups++; });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/Found your lights · 90 LEDs/)).toBeVisible();
  expect(serverLookups).toBe(0);
  await expect(page.getByText(/Position 5 of 90/)).toBeVisible();
  await page.getByRole('button', { name: /Use direct IP/ }).click();
  await page.getByText('Advanced controller settings', { exact: true }).click();
  await expect(page.getByLabel('WLED controller URL')).toHaveValue('http://192.0.2.1');
  await page.getByRole('button', { name: /Move clockwise/ }).click();
  await expect(page.getByLabel('Layout offset')).toHaveValue('5');
  await page.evaluate(() => { window.room.info = false; });
  await page.getByRole('button', { name: 'Detect LED count' }).click();
  await expect(page.getByText(/Found your lights · 90 LEDs/)).toBeVisible();
  expect(serverLookups).toBe(1);
});

test('Music starts without camera and provides freeze and off', async ({ page }) => {
  await mockRoom(page);
  await page.getByRole('button', { name: 'Music', exact: true }).click();
  await page.getByRole('button', { name: 'Start music lighting' }).click();
  await expect.poll(() => page.evaluate(() => window.room.audioRequests)).toBe(1);
  expect(await page.evaluate(() => window.room.videoRequests)).toBe(0);
  await page.getByRole('button', { name: 'Freeze lights', exact: true }).click();
  await page.getByRole('button', { name: 'Turn lights off', exact: true }).click();
  await expect(page.getByText(/Lights turned off/)).toBeVisible();
});


test('fresh installs require an explicit controller address', async ({ page }) => {
  await mockRoom(page);
  await page.route('**/api/wled/layout', route => route.fulfill({ json: {} }));
  await page.reload();
  await expect(page.getByText('Not configured', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText(/Enter your controller’s LAN IP address/)).toBeVisible();
  await page.getByText('Advanced controller settings', { exact: true }).click();
  await expect(page.getByLabel('WLED controller URL')).toHaveValue('');
  expect(await page.evaluate(() => window.room.sockets.filter(socket => !socket.url.includes('5175')).length)).toBe(0);
});
