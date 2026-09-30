"""Small WLED JSON API client for local test and LED-output commands."""

from __future__ import annotations

import json
from urllib.parse import urlparse
from urllib.request import Request, urlopen


def _state_url(base_url: str) -> str:
    parsed = urlparse(base_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("WLED URL must be a valid http(s) address.")
    return f"{base_url.rstrip('/')}/json/state"


def get_led_count(base_url: str) -> int:
    """Return the physical LED count reported by a WLED controller."""
    state_url = _state_url(base_url)
    info_url = f"{state_url.rsplit('/', 1)[0]}/info"
    with urlopen(info_url, timeout=3) as response:
        payload = json.loads(response.read())
    count = payload.get("leds", {}).get("count")
    if not isinstance(count, int) or count < 1:
        raise ValueError("WLED did not report a valid LED count.")
    return count


def set_color(base_url: str, rgb: tuple[int, int, int] | None, *, on: bool = True) -> None:
    """Set a solid first-segment color, or turn the WLED device off."""
    # Test actions should be immediate. ``tt`` is WLED's per-request
    # transition time in 100 ms units; zero overrides any slow default fade.
    state: dict[str, object] = {"on": on, "tt": 0, "transition": 0}
    if rgb is not None:
        state.update({"bri": 180, "seg": [{"fx": 0, "col": [list(rgb)]}]})
    request = Request(
        _state_url(base_url),
        data=json.dumps(state).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=3):
        pass
