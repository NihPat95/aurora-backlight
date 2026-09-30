"""Fast OpenCV/NumPy routines for ROI extraction and border color analysis."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from enum import Enum

import cv2
import numpy as np
from numpy.typing import NDArray

from .config import MIN_ROI_SIZE

BGRFrame = NDArray[np.uint8]
RGBTuple = tuple[int, int, int]
Point = tuple[int, int]


class BorderMode(str, Enum):
    """Where pixels are sampled relative to an axis-aligned ROI."""

    INSIDE = "inside"
    OUTSIDE = "outside"


@dataclass(frozen=True, slots=True)
class RectROI:
    """Axis-aligned rectangle using exclusive max coordinates."""

    x_min: int
    y_min: int
    x_max: int
    y_max: int

    def normalized(self, frame_shape: tuple[int, ...]) -> RectROI:
        """Order and clamp coordinates to the frame bounds."""
        height, width = frame_shape[:2]
        x1, x2 = sorted((int(self.x_min), int(self.x_max)))
        y1, y2 = sorted((int(self.y_min), int(self.y_max)))
        x1 = int(np.clip(x1, 0, max(width - 1, 0)))
        y1 = int(np.clip(y1, 0, max(height - 1, 0)))
        x2 = int(np.clip(x2, 1, width))
        y2 = int(np.clip(y2, 1, height))
        return RectROI(x1, y1, x2, y2)

    @property
    def width(self) -> int:
        return self.x_max - self.x_min

    @property
    def height(self) -> int:
        return self.y_max - self.y_min

    def validate(self) -> None:
        if self.width < MIN_ROI_SIZE or self.height < MIN_ROI_SIZE:
            raise ValueError(
                f"ROI must be at least {MIN_ROI_SIZE}×{MIN_ROI_SIZE} pixels; "
                f"received {self.width}×{self.height}."
            )


@dataclass(frozen=True, slots=True)
class PerspectiveROI:
    """Four TV corners ordered top-left, top-right, bottom-right, bottom-left."""

    top_left: Point
    top_right: Point
    bottom_right: Point
    bottom_left: Point

    @property
    def points(self) -> NDArray[np.float32]:
        return np.asarray(
            [self.top_left, self.top_right, self.bottom_right, self.bottom_left],
            dtype=np.float32,
        )

    def clamped(self, frame_shape: tuple[int, ...]) -> PerspectiveROI:
        height, width = frame_shape[:2]

        def clamp(point: Point) -> Point:
            x, y = point
            return (
                int(np.clip(x, 0, max(width - 1, 0))),
                int(np.clip(y, 0, max(height - 1, 0))),
            )

        return PerspectiveROI(*(clamp(point) for point in self.as_tuple()))

    def as_tuple(self) -> tuple[Point, Point, Point, Point]:
        return self.top_left, self.top_right, self.bottom_right, self.bottom_left


def _validate_frame(frame: BGRFrame) -> None:
    if not isinstance(frame, np.ndarray):
        raise TypeError("frame must be a NumPy array")
    if frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError("frame must have shape (height, width, 3)")
    if frame.size == 0:
        raise ValueError("frame cannot be empty")


def crop_rect(frame: BGRFrame, roi: RectROI) -> BGRFrame:
    """Return the normalized rectangular ROI as a view where possible."""
    _validate_frame(frame)
    normalized = roi.normalized(frame.shape)
    normalized.validate()
    return frame[
        normalized.y_min : normalized.y_max,
        normalized.x_min : normalized.x_max,
    ]


def warp_perspective(
    frame: BGRFrame,
    roi: PerspectiveROI,
    *,
    target_aspect_ratio: float | None = None,
) -> BGRFrame:
    """Rectify a four-corner TV region into a front-facing image."""
    _validate_frame(frame)
    roi = roi.clamped(frame.shape)
    points = roi.points

    width_top = np.linalg.norm(points[1] - points[0])
    width_bottom = np.linalg.norm(points[2] - points[3])
    height_left = np.linalg.norm(points[3] - points[0])
    height_right = np.linalg.norm(points[2] - points[1])
    output_width = int(round(max(width_top, width_bottom)))
    output_height = int(round(max(height_left, height_right)))

    if target_aspect_ratio is not None:
        if target_aspect_ratio <= 0:
            raise ValueError("target_aspect_ratio must be positive.")
        # The observed quadrilateral is foreshortened. Preserve its measured
        # horizontal detail while restoring the known physical screen ratio.
        output_height = int(round(output_width / target_aspect_ratio))

    if output_width < MIN_ROI_SIZE or output_height < MIN_ROI_SIZE:
        raise ValueError("Perspective ROI is too small or has invalid corner coordinates.")

    destination = np.asarray(
        [
            [0, 0],
            [output_width - 1, 0],
            [output_width - 1, output_height - 1],
            [0, output_height - 1],
        ],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(points, destination)
    return cv2.warpPerspective(
        frame,
        matrix,
        (output_width, output_height),
        flags=cv2.INTER_LINEAR,
    )


def _inside_border_regions(image: BGRFrame, border_width: int) -> tuple[BGRFrame, ...]:
    height, width = image.shape[:2]
    band = max(1, min(int(border_width), height // 2, width // 2))
    # Left/right exclude top and bottom so corner pixels are counted once.
    return (
        image[:band, :],
        image[height - band :, :],
        image[band : height - band, :band],
        image[band : height - band, width - band :],
    )


def _outside_border_regions(
    frame: BGRFrame,
    roi: RectROI,
    border_width: int,
) -> tuple[BGRFrame, ...]:
    roi = roi.normalized(frame.shape)
    roi.validate()
    height, width = frame.shape[:2]
    band = max(1, int(border_width))

    outer_x1 = max(0, roi.x_min - band)
    outer_y1 = max(0, roi.y_min - band)
    outer_x2 = min(width, roi.x_max + band)
    outer_y2 = min(height, roi.y_max + band)

    regions = (
        frame[outer_y1 : roi.y_min, outer_x1:outer_x2],
        frame[roi.y_max : outer_y2, outer_x1:outer_x2],
        frame[roi.y_min : roi.y_max, outer_x1 : roi.x_min],
        frame[roi.y_min : roi.y_max, roi.x_max : outer_x2],
    )
    if not any(region.size for region in regions):
        raise ValueError(
            "No outside-border pixels are available; move the ROI away from frame edges."
        )
    return regions


def _mean_bgr(regions: Iterable[BGRFrame], sample_step: int = 1) -> NDArray[np.float64]:
    """Compute one weighted mean without allocating a concatenated pixel array."""
    step = max(1, int(sample_step))
    channel_sum = np.zeros(3, dtype=np.float64)
    pixel_count = 0

    for region in regions:
        if region.size == 0:
            continue
        sampled = region[::step, ::step]
        channel_sum += sampled.sum(axis=(0, 1), dtype=np.float64)
        pixel_count += sampled.shape[0] * sampled.shape[1]

    if pixel_count == 0:
        raise ValueError("The selected border contains no pixels.")
    return channel_sum / pixel_count


def average_border_rgb(
    frame: BGRFrame,
    *,
    rect_roi: RectROI | None = None,
    perspective_roi: PerspectiveROI | None = None,
    border_width: int = 24,
    border_mode: BorderMode = BorderMode.INSIDE,
    sample_step: int = 1,
) -> RGBTuple:
    """Return the representative border color as ``(R, G, B)``.

    Exactly one ROI type must be provided. Perspective ROIs are rectified first
    and therefore support inside-edge sampling only.
    """
    _validate_frame(frame)
    if (rect_roi is None) == (perspective_roi is None):
        raise ValueError("Provide exactly one of rect_roi or perspective_roi.")

    if perspective_roi is not None:
        if border_mode is BorderMode.OUTSIDE:
            raise ValueError("Outside sampling is only supported for rectangular ROIs.")
        roi_image = warp_perspective(frame, perspective_roi)
        regions = _inside_border_regions(roi_image, border_width)
    elif border_mode is BorderMode.INSIDE:
        roi_image = crop_rect(frame, rect_roi)  # type: ignore[arg-type]
        regions = _inside_border_regions(roi_image, border_width)
    else:
        regions = _outside_border_regions(frame, rect_roi, border_width)  # type: ignore[arg-type]

    mean_bgr = _mean_bgr(regions, sample_step=sample_step)
    mean_rgb = np.rint(mean_bgr[::-1]).clip(0, 255).astype(np.uint8)
    return int(mean_rgb[0]), int(mean_rgb[1]), int(mean_rgb[2])


def sample_perimeter_rgb(
    image: BGRFrame,
    led_count: int,
    *,
    band_width: int = 12,
) -> list[RGBTuple]:
    """Return one inside-edge color per LED, from bottom-centre clockwise.

    The sampler works on a rectified TV image or a test image. Each LED gets
    the average of a small, inward-facing patch rather than a single pixel,
    which makes it stable enough to reuse for low-rate video processing.
    """
    _validate_frame(image)
    if not 1 <= led_count <= 1200:
        raise ValueError("led_count must be between 1 and 1200.")

    height, width = image.shape[:2]
    if width < 2 or height < 2:
        raise ValueError("image must be at least 2×2 pixels.")
    depth = max(1, min(int(band_width), width // 4, height // 4))
    # Keep the along-edge average deliberately narrower than the inward depth.
    # This reduces pixel noise without bleeding a bright object on one side
    # into its neighboring LEDs.
    tangent_width = max(3, min(depth // 2, width // 8, height // 8))

    # Start at bottom-centre and travel left, up the left edge, right across
    # the top, down the right edge, then back along the bottom: clockwise when
    # viewed from in front of the TV.
    segment_lengths = np.asarray([width / 2, height, width, height, width / 2], dtype=np.float32)
    perimeter = float(segment_lengths.sum())
    distances = (np.arange(led_count, dtype=np.float32) + 0.5) * (perimeter / led_count)
    cumulative = np.cumsum(segment_lengths)
    segment = np.searchsorted(cumulative, distances, side="right")
    previous = np.concatenate((np.asarray([0], dtype=np.float32), cumulative[:-1]))
    local = distances - previous[segment]

    x = np.empty(led_count, dtype=np.float32)
    y = np.empty(led_count, dtype=np.float32)
    tangent_x = np.empty(led_count, dtype=np.float32)
    tangent_y = np.empty(led_count, dtype=np.float32)
    normal_x = np.empty(led_count, dtype=np.float32)
    normal_y = np.empty(led_count, dtype=np.float32)
    for index, (start_x, start_y, tx, ty, nx, ny) in enumerate(
        (
            (width / 2, height - 1, -1, 0, 0, -1),
            (0, height - 1, 0, -1, 1, 0),
            (0, 0, 1, 0, 0, 1),
            (width - 1, 0, 0, 1, -1, 0),
            (width - 1, height - 1, -1, 0, 0, -1),
        )
    ):
        mask = segment == index
        x[mask] = start_x + local[mask] * tx
        y[mask] = start_y + local[mask] * ty
        tangent_x[mask], tangent_y[mask] = tx, ty
        normal_x[mask], normal_y[mask] = nx, ny

    # Sample an inward strip, with a small tangential span that avoids abrupt
    # per-LED changes while retaining distinct local colors.
    tangent = np.linspace(-tangent_width / 2, tangent_width / 2, tangent_width, dtype=np.float32)
    inward = np.arange(depth, dtype=np.float32)
    map_x = x[:, None, None] + tangent_x[:, None, None] * tangent[None, :, None] + normal_x[:, None, None] * inward[None, None, :]
    map_y = y[:, None, None] + tangent_y[:, None, None] * tangent[None, :, None] + normal_y[:, None, None] * inward[None, None, :]
    patches = cv2.remap(
        image,
        map_x.reshape(led_count * tangent_width, depth),
        map_y.reshape(led_count * tangent_width, depth),
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    ).reshape(led_count, tangent_width, depth, 3)
    mean_rgb = np.rint(patches.mean(axis=(1, 2))[:, ::-1]).clip(0, 255).astype(np.uint8)
    return [tuple(int(channel) for channel in rgb) for rgb in mean_rgb]


def detect_letterbox_content(image: BGRFrame, *, enabled: bool = True) -> tuple[BGRFrame, tuple[int, int]]:
    """Crop stable top/bottom black bars, returning image and original y bounds.

    A conservative threshold prevents naturally dark scenes from being mistaken
    for letterboxing. Only bars occupying up to a quarter of the frame are used.
    """
    _validate_frame(image)
    if not enabled:
        return image, (0, image.shape[0])
    height, width = image.shape[:2]
    max_bar = height // 4
    luma = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).mean(axis=1)
    threshold = 14.0
    top = next((index for index in range(max_bar) if luma[index] > threshold), 0)
    bottom_offset = next((index for index in range(max_bar) if luma[height - 1 - index] > threshold), 0)
    bottom = height - bottom_offset
    if top + bottom_offset < max(4, height // 30) or bottom - top < height // 2:
        return image, (0, height)
    return image[top:bottom, :width], (top, bottom)


def post_process_led_colors(
    colors: list[RGBTuple],
    *,
    highlight_protection: float = 0.0,
    corner_blend: float = 0.0,
    mode: str = "accurate",
) -> list[RGBTuple]:
    """Apply presentation-oriented LED processing to sampled RGB colors."""
    if not colors:
        return []
    protection = float(np.clip(highlight_protection, 0, 1))
    blend = float(np.clip(corner_blend, 0, 1))
    pixels = np.asarray(colors, dtype=np.float32) / 255.0

    if mode in {"cinema", "vivid"}:
        hsv = cv2.cvtColor(pixels[None, :, ::-1], cv2.COLOR_BGR2HSV)
        hsv[:, :, 1] *= 0.82 if mode == "cinema" else 1.22
        hsv[:, :, 2] *= 0.78 if mode == "cinema" else 1.0
        pixels = cv2.cvtColor(np.clip(hsv, 0, 1), cv2.COLOR_HSV2BGR)[0, :, ::-1]
    elif mode == "night":
        pixels *= 0.42

    if protection:
        shoulder = 1.0 - 0.55 * protection
        above = pixels > shoulder
        pixels = np.where(
            above,
            shoulder + (pixels - shoulder) / (1.0 + 1.2 * protection * (pixels - shoulder) / (1.0 - shoulder)),
            pixels,
        )

    if blend and len(pixels) > 2:
        neighbor_mean = (np.roll(pixels, 1, axis=0) + np.roll(pixels, -1, axis=0)) * 0.5
        pixels = pixels * (1.0 - blend * 0.42) + neighbor_mean * (blend * 0.42)

    processed = np.rint(np.clip(pixels, 0, 1) * 255).astype(np.uint8)
    return [tuple(int(channel) for channel in rgb) for rgb in processed]


def draw_roi_overlay(
    frame: BGRFrame,
    *,
    rect_roi: RectROI | None = None,
    perspective_roi: PerspectiveROI | None = None,
    border_width: int = 24,
    border_mode: BorderMode = BorderMode.INSIDE,
) -> BGRFrame:
    """Draw ROI and approximate sampled band for UI diagnostics."""
    output = frame.copy()
    if rect_roi is not None:
        roi = rect_roi.normalized(frame.shape)
        cv2.rectangle(output, (roi.x_min, roi.y_min), (roi.x_max, roi.y_max), (255, 255, 255), 2)
        band = max(1, int(border_width))
        if border_mode is BorderMode.INSIDE:
            inner = RectROI(
                min(roi.x_min + band, roi.x_max),
                min(roi.y_min + band, roi.y_max),
                max(roi.x_max - band, roi.x_min),
                max(roi.y_max - band, roi.y_min),
            )
            if inner.width > 0 and inner.height > 0:
                cv2.rectangle(
                    output,
                    (inner.x_min, inner.y_min),
                    (inner.x_max, inner.y_max),
                    (160, 160, 160),
                    1,
                )
        else:
            h, w = frame.shape[:2]
            cv2.rectangle(
                output,
                (max(0, roi.x_min - band), max(0, roi.y_min - band)),
                (min(w - 1, roi.x_max + band), min(h - 1, roi.y_max + band)),
                (160, 160, 160),
                1,
            )
    elif perspective_roi is not None:
        points = perspective_roi.clamped(frame.shape).points.astype(np.int32).reshape((-1, 1, 2))
        cv2.polylines(output, [points], isClosed=True, color=(255, 255, 255), thickness=2)
    return output


def analyze_frame(
    frame: BGRFrame,
    *,
    rect_roi: RectROI | None = None,
    perspective_roi: PerspectiveROI | None = None,
    border_width: int = 24,
    border_mode: BorderMode = BorderMode.INSIDE,
    sample_step: int = 1,
) -> tuple[RGBTuple, BGRFrame, BGRFrame]:
    """Analyze one frame and return RGB, display overlay, and cropped/warped TV image."""
    rgb = average_border_rgb(
        frame,
        rect_roi=rect_roi,
        perspective_roi=perspective_roi,
        border_width=border_width,
        border_mode=border_mode,
        sample_step=sample_step,
    )
    overlay = draw_roi_overlay(
        frame,
        rect_roi=rect_roi,
        perspective_roi=perspective_roi,
        border_width=border_width,
        border_mode=border_mode,
    )
    roi_image = (
        crop_rect(frame, rect_roi)
        if rect_roi is not None
        else warp_perspective(frame, perspective_roi)  # type: ignore[arg-type]
    )
    return rgb, overlay, roi_image
