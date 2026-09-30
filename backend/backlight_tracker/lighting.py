"""Level-dependent spatial sampling, independent of camera and transport."""
from typing import Literal

import cv2
import numpy as np

from .cv_processor import post_process_led_colors, sample_perimeter_rgb

LightingLevel = Literal["low", "medium", "high"]


def lighting_colors(image: np.ndarray, count: int, level: LightingLevel, *, depth: int = 16,
                    highlight: float = .35, blend: float = .35, mode: str = "accurate") -> list[tuple[int, int, int]]:
    if level == "low":
        rgb = image[..., ::-1].astype(np.float32)
        luminance = rgb @ np.array([.2126, .7152, .0722], dtype=np.float32)
        # A small floor avoids amplifying isolated bright pixels on a dark screen.
        average = np.average(rgb.reshape(-1, 3), axis=0, weights=(luminance + 16).ravel())
        colors = [tuple(average.astype(int))]
    else:
        zones = 6 if level == "medium" else 12
        colors = sample_perimeter_rgb(image, zones, band_width=depth)
    colors = post_process_led_colors(colors, highlight_protection=max(.2, highlight),
                                    corner_blend=blend, mode=mode)
    values = np.asarray(colors, dtype=np.float32)
    # Periodic interpolation preserves continuity across LED zero.
    positions = np.arange(count) * len(values) / count
    left = positions.astype(int)
    fraction = (positions - left)[:, None]
    output = values[left] * (1 - fraction) + values[(left + 1) % len(values)] * fraction
    mean_luma = float(cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).mean())
    if mean_luma < 20:
        gray = output @ np.array([.2126, .7152, .0722])
        amount = mean_luma / 20
        output = (gray[:, None] * (1 - amount) + output * amount) * amount
    return [tuple(map(int, row)) for row in np.clip(np.rint(output), 0, 255)]
