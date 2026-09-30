"""Application services that prepare captured frames for the Streamlit UI."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .cv_processor import (
    BGRFrame,
    BorderMode,
    PerspectiveROI,
    RectROI,
    RGBTuple,
    average_border_rgb,
    draw_roi_overlay,
    warp_perspective,
)


@dataclass(frozen=True, slots=True)
class AnalysisResult:
    """Data ready for display, with no dependency on Streamlit state or widgets."""

    rgb: RGBTuple
    overlay: BGRFrame
    tv_image: BGRFrame
    living_room: BGRFrame


def correct_tv_image(
    frame: BGRFrame,
    roi: PerspectiveROI,
    *,
    brightness: int = 0,
    saturation: float = 1.0,
    target_aspect_ratio: float | None = None,
    contrast: float = 1.0,
    gamma: float = 1.0,
    red_gain: float = 1.0,
    green_gain: float = 1.0,
    blue_gain: float = 1.0,
) -> BGRFrame:
    """Rectify a TV quadrilateral and apply lightweight visual corrections."""
    corrected = warp_perspective(frame, roi, target_aspect_ratio=target_aspect_ratio)
    if saturation != 1.0:
        hsv = cv2.cvtColor(corrected, cv2.COLOR_BGR2HSV).astype(np.float32)
        hsv[:, :, 1] = np.clip(hsv[:, :, 1] * saturation, 0, 255)
        corrected = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)
    if min(contrast, gamma, red_gain, green_gain, blue_gain) <= 0:
        raise ValueError("Color correction gains, contrast, and gamma must be positive.")
    adjusted = corrected.astype(np.float32)
    adjusted[:, :, 0] *= blue_gain
    adjusted[:, :, 1] *= green_gain
    adjusted[:, :, 2] *= red_gain
    adjusted = np.clip(adjusted * contrast + brightness, 0, 255).astype(np.uint8)
    if gamma != 1.0:
        lookup = np.asarray(
            [min(255, round(((value / 255) ** (1 / gamma)) * 255)) for value in range(256)],
            dtype=np.uint8,
        )
        adjusted = cv2.LUT(adjusted, lookup)
    corrected = adjusted
    return corrected


def analyze_tv_capture(
    frame: BGRFrame,
    *,
    perspective_roi: PerspectiveROI,
    border_width: int,
    border_mode: BorderMode = BorderMode.INSIDE,
    sample_step: int,
    brightness: int = 0,
    saturation: float = 1.0,
    target_aspect_ratio: float | None = None,
    contrast: float = 1.0,
    gamma: float = 1.0,
    red_gain: float = 1.0,
    green_gain: float = 1.0,
    blue_gain: float = 1.0,
) -> AnalysisResult:
    """Rectify, correct, analyze, and render one TV frame."""
    tv_image = correct_tv_image(
        frame,
        perspective_roi,
        brightness=brightness,
        saturation=saturation,
        target_aspect_ratio=target_aspect_ratio,
        contrast=contrast,
        gamma=gamma,
        red_gain=red_gain,
        green_gain=green_gain,
        blue_gain=blue_gain,
    )
    rgb = average_border_rgb(
        tv_image,
        rect_roi=RectROI(0, 0, tv_image.shape[1], tv_image.shape[0]),
        border_width=border_width,
        border_mode=border_mode,
        sample_step=sample_step,
    )
    overlay = draw_roi_overlay(frame, perspective_roi=perspective_roi)
    return AnalysisResult(rgb, overlay, tv_image, render_living_room_tv(tv_image, rgb))


def render_living_room_tv(tv_image: BGRFrame, rgb: RGBTuple) -> BGRFrame:
    """Place a captured/rectified image inside a simple, realistic TV scene."""
    canvas_height, canvas_width = 720, 1280
    scene = np.zeros((canvas_height, canvas_width, 3), dtype=np.uint8)

    # Wall gradient, floor, and a soft backlight halo around the TV.
    wall = np.linspace(64, 39, canvas_height, dtype=np.uint8)[:, None]
    scene[:, :, 0] = wall
    scene[:, :, 1] = wall + 7
    scene[:, :, 2] = wall + 16
    floor_y = 565
    scene[floor_y:] = (35, 32, 31)
    cv2.line(scene, (0, floor_y), (canvas_width, floor_y), (104, 92, 80), 3)

    tv_x, tv_y, tv_w, tv_h = 270, 105, 740, 416
    rgb_color = np.asarray(rgb, dtype=np.float32)
    glow_bgr = tuple(int(value) for value in rgb_color[::-1] * 0.45)
    glow = np.zeros_like(scene)
    cv2.rectangle(glow, (tv_x - 35, tv_y - 35), (tv_x + tv_w + 35, tv_y + tv_h + 35), glow_bgr, -1)
    glow = cv2.GaussianBlur(glow, (0, 0), 45)
    scene = cv2.addWeighted(scene, 1.0, glow, 0.65, 0)

    # Cabinet and TV housing.
    cv2.rectangle(scene, (190, 535), (1090, 615), (30, 28, 27), -1)
    cv2.rectangle(scene, (218, 612), (1062, 630), (20, 19, 19), -1)
    cv2.rectangle(
        scene, (tv_x - 16, tv_y - 16), (tv_x + tv_w + 16, tv_y + tv_h + 16), (12, 12, 12), -1
    )
    cv2.rectangle(
        scene, (tv_x - 10, tv_y - 10), (tv_x + tv_w + 10, tv_y + tv_h + 10), (42, 42, 42), 2
    )

    fitted = cv2.resize(tv_image, (tv_w, tv_h), interpolation=cv2.INTER_AREA)
    scene[tv_y : tv_y + tv_h, tv_x : tv_x + tv_w] = fitted
    cv2.rectangle(scene, (tv_x, tv_y), (tv_x + tv_w, tv_y + tv_h), (6, 6, 6), 4)
    cv2.rectangle(
        scene,
        (tv_x + tv_w // 2 - 72, tv_y + tv_h + 16),
        (tv_x + tv_w // 2 + 72, tv_y + tv_h + 26),
        (15, 15, 15),
        -1,
    )
    cv2.rectangle(
        scene,
        (tv_x + tv_w // 2 - 15, tv_y + tv_h + 26),
        (tv_x + tv_w // 2 + 15, 535),
        (15, 15, 15),
        -1,
    )
    return scene


def empty_living_room_tv() -> BGRFrame:
    """Return the persistent mock TV scene shown before a stream starts."""
    placeholder = np.full((416, 740, 3), (25, 20, 16), dtype=np.uint8)
    cv2.putText(
        placeholder,
        "Start a camera stream",
        (165, 185),
        cv2.FONT_HERSHEY_SIMPLEX,
        1.0,
        (180, 180, 180),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        placeholder,
        "to project it here",
        (205, 230),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.75,
        (130, 130, 130),
        1,
        cv2.LINE_AA,
    )
    return render_living_room_tv(placeholder, (0, 0, 0))


def brighten_camera_preview(frame: BGRFrame) -> BGRFrame:
    """Lift shadows in setup previews without changing the LED analysis input."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    value = hsv[:, :, 2]
    average_luma = float(value.mean())
    if average_luma >= 55:
        return frame
    # Gamma below one makes a very dark auto-exposure startup frame visible.
    gamma = 0.45 if average_luma < 20 else 0.65
    lookup = np.asarray(
        [min(255, round(((level / 255) ** gamma) * 255)) for level in range(256)], dtype=np.uint8
    )
    hsv[:, :, 2] = cv2.LUT(value, lookup)
    return cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
