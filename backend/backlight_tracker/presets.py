"""Persistent named setup configurations."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

DATA_PATH = Path(os.environ.get("BACKLIGHT_DATA_DIR", Path(__file__).resolve().parent.parent))
PRESETS_PATH = DATA_PATH / ".backlight_presets.json"
WLED_LAYOUT_PATH = DATA_PATH / ".backlight_wled_layout.json"


def load_presets() -> dict[str, dict[str, Any]]:
    """Load saved presets, treating a missing or invalid file as empty."""
    try:
        content = json.loads(PRESETS_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return content if isinstance(content, dict) else {}


def save_preset(name: str, config: dict[str, Any]) -> None:
    """Save one named configuration for later reuse."""
    presets = load_presets()
    presets[name] = config
    PRESETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    PRESETS_PATH.write_text(json.dumps(presets, indent=2, sort_keys=True) + "\n")


def delete_preset(name: str) -> bool:
    """Delete one named preset and return whether it existed."""
    presets = load_presets()
    if name not in presets:
        return False
    del presets[name]
    PRESETS_PATH.write_text(json.dumps(presets, indent=2, sort_keys=True) + "\n")
    return True


def load_wled_layout() -> dict[str, Any]:
    """Load the single shared WLED physical-layout configuration."""
    try:
        content = json.loads(WLED_LAYOUT_PATH.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    return content if isinstance(content, dict) else {}


def save_wled_layout(config: dict[str, Any]) -> None:
    """Persist WLED hardware mapping independently from TV presets."""
    WLED_LAYOUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    WLED_LAYOUT_PATH.write_text(json.dumps(config, indent=2, sort_keys=True) + "\n")
