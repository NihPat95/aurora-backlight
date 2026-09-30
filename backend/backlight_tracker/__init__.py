"""Dynamic LED backlight color tracking package."""

from .cv_processor import (
    BorderMode,
    PerspectiveROI,
    RectROI,
    analyze_frame,
    average_border_rgb,
)

__all__ = [
    "BorderMode",
    "PerspectiveROI",
    "RectROI",
    "analyze_frame",
    "average_border_rgb",
]
