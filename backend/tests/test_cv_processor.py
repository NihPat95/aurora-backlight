from __future__ import annotations

import cv2
import numpy as np
import pytest

from backlight_tracker.cv_processor import (
    BorderMode,
    PerspectiveROI,
    RectROI,
    average_border_rgb,
    crop_rect,
    detect_letterbox_content,
    post_process_led_colors,
    sample_perimeter_rgb,
    warp_perspective,
)


def test_inside_border_returns_expected_rgb() -> None:
    frame = np.zeros((100, 120, 3), dtype=np.uint8)
    roi = RectROI(10, 10, 110, 90)
    # OpenCV frame order is BGR; set the entire ROI to RGB (30, 20, 10).
    frame[10:90, 10:110] = (10, 20, 30)

    result = average_border_rgb(
        frame,
        rect_roi=roi,
        border_width=8,
        border_mode=BorderMode.INSIDE,
    )

    assert result == (30, 20, 10)


def test_inside_border_ignores_center_pixels() -> None:
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    roi = RectROI(10, 10, 90, 90)
    frame[10:90, 10:90] = (0, 0, 255)  # red border/base
    frame[20:80, 20:80] = (255, 0, 0)  # blue center

    result = average_border_rgb(
        frame,
        rect_roi=roi,
        border_width=10,
        border_mode=BorderMode.INSIDE,
    )

    assert result == (255, 0, 0)


def test_outside_border_uses_surrounding_band() -> None:
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    frame[:] = (0, 255, 0)
    roi = RectROI(20, 20, 80, 80)
    frame[20:80, 20:80] = (255, 0, 0)

    result = average_border_rgb(
        frame,
        rect_roi=roi,
        border_width=5,
        border_mode=BorderMode.OUTSIDE,
    )

    assert result == (0, 255, 0)


def test_sample_step_preserves_uniform_color() -> None:
    frame = np.full((80, 80, 3), (4, 8, 12), dtype=np.uint8)

    result = average_border_rgb(
        frame,
        rect_roi=RectROI(5, 5, 75, 75),
        border_width=7,
        sample_step=6,
    )

    assert result == (12, 8, 4)


def test_crop_rect_normalizes_reversed_coordinates() -> None:
    frame = np.zeros((40, 60, 3), dtype=np.uint8)
    cropped = crop_rect(frame, RectROI(50, 30, 10, 5))
    assert cropped.shape == (25, 40, 3)


def test_perspective_warp_and_color_analysis() -> None:
    frame = np.zeros((120, 160, 3), dtype=np.uint8)
    polygon = np.asarray([[20, 20], [140, 25], [130, 100], [25, 95]], dtype=np.int32)
    cv2.fillConvexPoly(frame, polygon, (25, 50, 100))
    roi = PerspectiveROI((20, 20), (140, 25), (130, 100), (25, 95))

    warped = warp_perspective(frame, roi)
    result = average_border_rgb(frame, perspective_roi=roi, border_width=4)

    assert warped.shape[0] > 60
    assert warped.shape[1] > 100
    assert result[0] >= 90
    assert 40 <= result[1] <= 55
    assert 20 <= result[2] <= 30


def test_requires_exactly_one_roi() -> None:
    frame = np.zeros((20, 20, 3), dtype=np.uint8)
    with pytest.raises(ValueError, match="exactly one"):
        average_border_rgb(frame)


def test_perimeter_sampler_returns_one_rgb_value_per_led() -> None:
    frame = np.full((80, 120, 3), (12, 34, 56), dtype=np.uint8)

    colors = sample_perimeter_rgb(frame, 100, band_width=8)

    assert len(colors) == 100
    assert set(colors) == {(56, 34, 12)}


def test_letterbox_detection_crops_only_dark_top_and_bottom_bars() -> None:
    frame = np.full((100, 120, 3), 90, dtype=np.uint8)
    frame[:12] = 0
    frame[-12:] = 0

    content, bounds = detect_letterbox_content(frame)

    assert bounds == (12, 88)
    assert content.shape[:2] == (76, 120)


def test_post_processing_preserves_count_and_compresses_highlights() -> None:
    colors = [(255, 250, 245), (20, 40, 60), (255, 250, 245)]

    processed = post_process_led_colors(colors, highlight_protection=1, corner_blend=0.5)

    assert len(processed) == len(colors)
    assert processed[0][0] < colors[0][0]
