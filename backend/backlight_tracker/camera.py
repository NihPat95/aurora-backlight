"""Camera capture with explicit lifecycle management."""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Final

import cv2
import numpy as np
from numpy.typing import NDArray

BGRFrame = NDArray[np.uint8]
MAX_CAMERA_INDEX: Final = 10


def discover_cameras(max_index: int = MAX_CAMERA_INDEX) -> list[int]:
    """Return OpenCV camera indices that can be opened right now.

    Handles are released immediately, so discovery never reserves a camera that
    the user later selects. Browser cameras are intentionally not included:
    those are exposed by Streamlit's ``st.camera_input`` widget instead.
    """
    backend = cv2.CAP_AVFOUNDATION if sys.platform == "darwin" else cv2.CAP_ANY
    available: list[int] = []
    for index in range(max(0, int(max_index)) + 1):
        capture = cv2.VideoCapture(index, backend)
        if not capture.isOpened() and backend != cv2.CAP_ANY:
            capture.release()
            capture = cv2.VideoCapture(index, cv2.CAP_ANY)
        if capture.isOpened():
            available.append(index)
        capture.release()
    return available


@dataclass
class CameraCapture:
    """Own one OpenCV camera and expose safe read/release operations."""

    index: int
    width: int
    height: int
    fps: int
    _capture: cv2.VideoCapture = field(init=False, repr=False)

    def __post_init__(self) -> None:
        backend = cv2.CAP_AVFOUNDATION if sys.platform == "darwin" else cv2.CAP_ANY
        self._capture = cv2.VideoCapture(self.index, backend)

        # Some external USB cameras work with CAP_ANY even when AVFoundation fails.
        if not self._capture.isOpened() and backend != cv2.CAP_ANY:
            self._capture.release()
            self._capture = cv2.VideoCapture(self.index, cv2.CAP_ANY)

        if not self._capture.isOpened():
            raise RuntimeError(
                f"Unable to open camera index {self.index}. "
                "Check macOS camera permission and try another camera index."
            )

        self._capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        self._capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        self._capture.set(cv2.CAP_PROP_FPS, self.fps)
        # This property is ignored by backends that do not support it.
        self._capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)

    def read(self) -> BGRFrame:
        """Read one frame or raise a user-facing error."""
        if not self._capture.isOpened():
            raise RuntimeError("Camera is not open.")

        ok, frame = self._capture.read()
        if not ok or frame is None or frame.size == 0:
            raise RuntimeError(
                "Camera opened but returned no frame. "
                "Close other camera apps, verify permission, or try another index."
            )
        return frame

    def read_warmed(self, frames: int = 12) -> BGRFrame:
        """Discard startup frames so auto-exposure has time to settle."""
        frame: BGRFrame | None = None
        for _ in range(max(1, int(frames))):
            frame = self.read()
        return frame

    def release(self) -> None:
        """Release the camera handle. Safe to call more than once."""
        if hasattr(self, "_capture") and self._capture.isOpened():
            self._capture.release()
