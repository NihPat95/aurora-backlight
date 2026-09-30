"""HTTP API used by the React calibration and monitor UI."""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from pathlib import Path

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .cv_processor import (
    PerspectiveROI,
    detect_letterbox_content,
    sample_perimeter_rgb,
)
from .lighting import LightingLevel, lighting_colors
from .presentation import analyze_tv_capture
from .presets import delete_preset, load_presets, load_wled_layout, save_preset, save_wled_layout
from .web import mount_frontend
from .wled import get_led_count, set_color

app = FastAPI(title="Dynamic TV Backlight API")
TEST_IMAGES_PATH = Path(
    os.environ.get("BACKLIGHT_TEST_IMAGES_DIR", Path(__file__).resolve().parents[2] / "test_images")
)
logger = logging.getLogger(__name__)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    image: str = Field(max_length=16_000_000)
    lighting_level: LightingLevel = "low"
    corners: list[tuple[float, float]] = Field(min_length=4, max_length=4)
    brightness: int = Field(default=0, ge=-100, le=100)
    saturation: float = Field(default=1.0, ge=0, le=2)
    aspect_ratio: float = Field(default=16 / 9, gt=0, le=4)
    contrast: float = Field(default=1.0, gt=0, le=3)
    gamma: float = Field(default=1.0, gt=0, le=3)
    red_gain: float = Field(default=1.0, gt=0, le=3)
    green_gain: float = Field(default=1.0, gt=0, le=3)
    blue_gain: float = Field(default=1.0, gt=0, le=3)
    led_count: int | None = Field(default=None, ge=1, le=1200)
    perimeter_depth: int = Field(default=16, ge=1, le=300)
    letterbox_detection: bool = True
    highlight_protection: float = Field(default=0.35, ge=0, le=1)
    corner_blend: float = Field(default=0.35, ge=0, le=1)
    viewing_mode: str = Field(default="accurate", pattern="^(accurate|cinema|vivid|night)$")


class PresetRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    config: dict[str, object]


class WledTestRequest(BaseModel):
    url: str
    color: tuple[int, int, int] | None = None
    on: bool = True


class PerimeterColorsRequest(BaseModel):
    image: str | None = None
    test_image: str | None = Field(default=None, max_length=255)
    led_count: int = Field(ge=1, le=1200)


class WledLayoutRequest(BaseModel):
    url: str
    led_count: int = Field(ge=1, le=1200)
    led_offset: int = Field(ge=0, le=1199)
    test_image: str = Field(default="", max_length=255)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/presets")
def presets() -> dict[str, dict[str, object]]:
    return load_presets()


@app.get("/api/test-images")
def test_images() -> dict[str, list[str]]:
    """List local test images so additions appear in the UI without a rebuild."""
    extensions = {".jpg", ".jpeg", ".png"}
    images = sorted(path.name for path in TEST_IMAGES_PATH.glob("*") if path.suffix.lower() in extensions)
    return {"images": images}


@app.get("/api/wled/layout")
def get_wled_layout() -> dict[str, object]:
    return load_wled_layout()


@app.put("/api/wled/layout")
def put_wled_layout(request: WledLayoutRequest) -> dict[str, str]:
    save_wled_layout(request.model_dump())
    return {"status": "saved"}


@app.get("/api/test-images/{filename}")
def test_image(filename: str) -> FileResponse:
    """Serve a named local test image after validating the filename."""
    path = TEST_IMAGES_PATH / Path(filename).name
    if path.suffix.lower() not in {".jpg", ".jpeg", ".png"} or not path.is_file():
        raise HTTPException(status_code=404, detail="Test image not found.")
    return FileResponse(path)


@app.put("/api/presets")
def put_preset(request: PresetRequest) -> dict[str, str]:
    save_preset(request.name, request.config)
    return {"status": "saved"}


@app.delete("/api/presets/{name}")
def remove_preset(name: str) -> dict[str, str]:
    if not delete_preset(name):
        raise HTTPException(status_code=404, detail="Preset not found.")
    return {"status": "deleted"}


@app.post("/api/wled/test")
def test_wled(request: WledTestRequest) -> dict[str, str | float]:
    started = time.perf_counter()
    try:
        set_color(request.url, request.color, on=request.on)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=f"WLED test failed: {exc}") from exc
    return {"status": "sent", "wled_request_ms": round((time.perf_counter() - started) * 1000, 1)}


@app.get("/api/wled/info")
def wled_info(url: str) -> dict[str, int]:
    """Read the configured controller's physical LED count."""
    try:
        return {"led_count": get_led_count(url)}
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail=f"Could not read WLED info: {exc}") from exc


@app.post("/api/perimeter-colors")
def perimeter_colors(request: PerimeterColorsRequest) -> dict[str, list[tuple[int, int, int]]]:
    """Sample one LED color per position around an image perimeter."""
    try:
        if request.test_image:
            path = TEST_IMAGES_PATH / Path(request.test_image).name
            if path.suffix.lower() not in {".jpg", ".jpeg", ".png"} or not path.is_file():
                raise ValueError("Test image was not found.")
            image = cv2.imread(str(path), cv2.IMREAD_COLOR)
        elif request.image:
            encoded = request.image.split(",", 1)[-1]
            image = cv2.imdecode(np.frombuffer(base64.b64decode(encoded), np.uint8), cv2.IMREAD_COLOR)
        else:
            raise ValueError("Provide either an image or a test image filename.")
        if image is None:
            raise ValueError("Image could not be decoded.")
        logger.info("Sampling test-image perimeter: %s, LEDs=%s", image.shape, request.led_count)
        colors = sample_perimeter_rgb(image, request.led_count)
        logger.info("Perimeter sampling complete: %s colors", len(colors))
        return {"colors": colors}
    except (ValueError, cv2.error) as exc:
        logger.warning("Perimeter sampling failed: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/api/analyze")
def analyze(request: AnalyzeRequest) -> dict[str, object]:
    try:
        encoded = request.image.split(",", 1)[-1]
        frame = cv2.imdecode(np.frombuffer(base64.b64decode(encoded), np.uint8), cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Image could not be decoded.")
        result = analyze_tv_capture(
            frame,
            perspective_roi=PerspectiveROI(*[(int(x), int(y)) for x, y in request.corners]),
            border_width=24,
            sample_step=2,
            brightness=request.brightness,
            saturation=request.saturation,
            target_aspect_ratio=request.aspect_ratio,
            contrast=request.contrast,
            gamma=request.gamma,
            red_gain=request.red_gain,
            green_gain=request.green_gain,
            blue_gain=request.blue_gain,
        )
        ok, output = cv2.imencode(".jpg", result.tv_image)
        if not ok:
            raise ValueError("Corrected image could not be encoded.")
        payload: dict[str, object] = {"rgb": result.rgb, "corrected": base64.b64encode(output).decode()}
        if request.led_count is not None:
            content, (top, bottom) = detect_letterbox_content(
                result.tv_image, enabled=request.letterbox_detection
            )
            colors = lighting_colors(
                content, request.led_count, request.lighting_level, depth=request.perimeter_depth,
                highlight=request.highlight_protection,
                blend=request.corner_blend,
                mode=request.viewing_mode,
            )
            diagnostic = result.tv_image.copy()
            cv2.rectangle(diagnostic, (0, top), (diagnostic.shape[1] - 1, bottom - 1), (80, 230, 140), 2)
            visual_depth = min(request.perimeter_depth, diagnostic.shape[1] // 4, (bottom - top) // 4)
            if visual_depth > 0:
                cv2.rectangle(
                    diagnostic,
                    (visual_depth, top + visual_depth),
                    (diagnostic.shape[1] - visual_depth - 1, bottom - visual_depth - 1),
                    (50, 200, 255),
                    1,
                )
            ok, diagnostic_output = cv2.imencode(".jpg", diagnostic)
            if not ok:
                raise ValueError("Sampling diagnostic could not be encoded.")
            payload.update(
                {
                    "led_colors": colors,
                    "diagnostic": base64.b64encode(diagnostic_output).decode(),
                    "content_bounds": [top, bottom],
                }
            )
        return payload
    except (ValueError, cv2.error) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# Register static serving last so /api and API documentation retain precedence.
# Local development still uses Vite unless this production setting is supplied.
if frontend_directory := os.environ.get("BACKLIGHT_FRONTEND_DIR"):
    mount_frontend(app, Path(frontend_directory))
