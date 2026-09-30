"""Production routing and writable-volume persistence, without touching saved data."""

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backlight_tracker import presets
from backlight_tracker.web import mount_frontend


def test_frontend_and_api_share_one_server(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text('<div id="root">Aurora</div>')
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "app.js").write_text('console.log("Aurora")')
    app = FastAPI()

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    mount_frontend(app, tmp_path)
    with TestClient(app) as client:
        assert client.get("/").text == '<div id="root">Aurora</div>'
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/api/health").json() == {"status": "ok"}
        for missing in ("/api/missing", "/assets/missing.js", "/missing"):
            assert client.get(missing).status_code == 404
        assert client.get("/assets/%2e%2e/%2e%2e/pyproject.toml").status_code == 404


def test_frontend_fails_fast_without_build(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="index.html not found"):
        mount_frontend(FastAPI(), tmp_path)


def test_settings_round_trip_in_new_data_directory(tmp_path: Path, monkeypatch) -> None:
    directory = tmp_path / "data"
    monkeypatch.setattr(presets, "PRESETS_PATH", directory / ".backlight_presets.json")
    monkeypatch.setattr(presets, "WLED_LAYOUT_PATH", directory / ".backlight_wled_layout.json")
    assert presets.load_presets() == {}
    assert presets.load_wled_layout() == {}
    presets.save_preset("Cinema", {"ceiling": 20})
    presets.save_wled_layout({"url": "http://192.0.2.1", "led_count": 90})
    assert presets.load_presets() == {"Cinema": {"ceiling": 20}}
    assert presets.load_wled_layout()["led_count"] == 90
    assert presets.delete_preset("Cinema") is True
    assert presets.load_presets() == {}
