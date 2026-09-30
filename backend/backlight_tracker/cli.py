"""Console entry point for the local FastAPI server."""

from __future__ import annotations

import uvicorn


def main() -> None:
    uvicorn.run("backlight_tracker.api:app", host="127.0.0.1", port=8000, reload=True)


if __name__ == "__main__":
    main()
