"""Serve the built browser application alongside the API in production."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles


def mount_frontend(app: FastAPI, directory: Path) -> None:
    """Fail early on an incomplete build; never mask missing resources with HTML."""
    if not (directory / "index.html").is_file():
        raise RuntimeError(f"Built frontend index.html not found in {directory}")
    app.mount("/", StaticFiles(directory=directory, html=True), name="frontend")
