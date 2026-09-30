# Aurora Backlight

Aurora turns TV pictures and room audio into ambient lighting for a WLED-controlled LED strip. A React browser app handles camera/microphone capture and guided calibration; a FastAPI service uses OpenCV to correct perspective and sample screen colors.

## Features

- Live browser camera preview and draggable, numbered TV corner alignment.
- Perspective correction, image tuning, black-bar detection, and sampling diagnostics.
- Glow, Balanced, and Immersive lighting with smooth transitions and adjustable brightness.
- Optional microphone-driven brightness for TV + music, plus a camera-free Music mode.
- Named scenes and a shared rectangular WLED layout with LED-count detection and rotation.
- Direct browser-to-WLED WebSocket output; Freeze retains colors and Off switches the lights off.

## Quick start with Docker

Install Docker Engine with Compose on Linux, or a Linux-container runtime such as Docker Desktop on macOS/Windows. Colima is also supported on macOS. Start your container runtime, then run these commands from the repository root:

```sh
docker compose up --build -d
```

Open [Aurora](http://localhost:8000). [API health](http://localhost:8000/api/health) should return `{"status":"ok"}`.

The frontend and backend run in **one container**, served by one non-root Uvicorn process. The multi-stage build uses Node only to compile the frontend, then packages the result with Python 3.12 slim and headless OpenCV. Build tools and development dependencies are excluded from the runtime image. The Dockerfile supports Linux amd64 and arm64; Raspberry Pi requires a 64-bit OS.

If port 8000 is occupied, create a root `.env` file containing `BACKLIGHT_PORT=8080`, then run the same command and open port 8080. `.env` files are ignored by Git.

```sh
docker compose ps             # check health
docker compose logs --tail=50
docker compose down           # stop; saved settings remain
```

### First-time setup

1. Open **Settings**, expand **Advanced controller settings**, and enter your WLED controller's LAN IP URL. No controller address is built into the application.
2. Detect the LED count, show a layout test, adjust the rotation, and save the layout. Mirroring the test image to the TV helps align the physical LEDs.
3. Return Home and start a TV or TV + music session. Select the camera pointing at the TV and allow browser access.
4. Align the four corners, preview the lights, adjust brightness, and save a named scene.

Keep the browser open while lighting runs. A microphone is optional for TV scenes; audio lift is disabled in Night mode. Browser media capture stays on the browser's device; selected video frames are sent to the backend for analysis.

### Data and configuration

Scenes and the shared WLED layout are stored in the named `backlight-data` volume, mounted at `/data`. Container recreation and `docker compose down` preserve it. **`docker compose down --volumes` deletes saved settings.** Local configuration and credentials are excluded from Git and the Docker build context.

| Setting | Container default | Purpose |
| --- | --- | --- |
| `BACKLIGHT_PORT` | `8000` | Compose's published host port |
| `BACKLIGHT_DATA_DIR` | `/data` | Backend preset and layout storage |
| `BACKLIGHT_FRONTEND_DIR` | `/app/frontend` | Compiled frontend served by FastAPI |
| `BACKLIGHT_TEST_IMAGES_DIR` | `/app/test_images` | Calibration image directory |

`BACKLIGHT_PORT` is read by Compose from the environment or a root `.env` file. To override the backend settings, add them to the service's `environment` section. Optional bind mounts can replace `/app/test_images` with a read-only directory of JPEG/PNG images.

To migrate an existing local setup into a running container, use a POSIX shell (macOS/Linux or WSL) and copy only files that exist. These commands overwrite the corresponding container settings and preserve the application's write permissions:

```sh
docker compose exec -T backlight python -c "import sys; from pathlib import Path; Path('/data/.backlight_presets.json').write_text(sys.stdin.read())" < backend/.backlight_presets.json
docker compose exec -T backlight python -c "import sys; from pathlib import Path; Path('/data/.backlight_wled_layout.json').write_text(sys.stdin.read())" < backend/.backlight_wled_layout.json
```

### Browser and network requirements

Camera/microphone access works on `localhost`. Access from a phone or another LAN device requires HTTPS, and browser-to-WLED output from an HTTPS page requires a secure WLED WebSocket endpoint, such as a trusted local TLS proxy.

A browser on another device sees that device's cameras. Containerization does not provide remote Raspberry Pi camera streaming or USB passthrough. Use the controller's reachable LAN IP; `localhost` inside a container refers to the container, and `.local` names may resolve slowly or fail.

The application is intended for a trusted local network. It does not include authentication or automatic TLS; do not expose the API directly to the public internet.

## Local development

Requirements: Python 3.10+, Poetry 2.x, Node.js 22.12+, and npm 9+.

Start the backend:

```sh
cd backend
poetry install
poetry run backlight-tracker
```

In a second terminal, start the frontend:

```sh
cd frontend
npm ci
npm run dev
```

Vite serves the UI at `http://localhost:5173` and proxies `/api` to `http://127.0.0.1:8000`. Stop the container first or use a different container host port to avoid an API port conflict. Development settings are saved under `backend/.backlight_*.json`. `VITE_API_URL` is a build-time override for deployments that deliberately use a separately hosted API.

## Validation

```sh
# Backend
cd backend
poetry run pytest
poetry run ruff check backlight_tracker tests ../scripts/smoke-container.py

# Frontend
cd ../frontend
npm run build
npm run test:install
npm test

# Running container
cd ..
python3 scripts/smoke-container.py http://localhost:8000
```

Start the sequence above from the repository root. Browser tests start their own Vite server on port 5175 and simulate cameras, microphones, APIs, and WLED. Set `CHROME_PATH` to an installed Chrome executable to skip the Chromium download. The container smoke check requires only Python's standard library, verifies frontend assets and API/CV processing, creates and deletes a unique temporary scene, and never sends commands to physical lights.

For a builder with multi-platform support and an image store that can load multi-platform images:

```sh
docker buildx build --platform linux/arm64,linux/amd64 --load -t aurora-backlight:local .
```

Automated checks complement physical testing: confirm camera alignment, LED mapping, scene transitions, and quiet/loud audio response with your own hardware before extended use.

## Repository layout

```text
frontend/       React + Vite application and browser regressions
backend/        FastAPI + OpenCV service and unit tests
scripts/        Container smoke check
test_images/    Bundled calibration images
Dockerfile      Multi-stage, single-container build
compose.yaml    Runtime service and persistent volume
```

Internal planning, agent instructions, research, and user-testing notes are intentionally excluded from version control. The root README is the public setup and maintenance guide.
