"""Check a running container over HTTP using only the Python standard library.

Usage: python3 scripts/smoke-container.py http://localhost:8000
Creates and removes a uniquely named test preset; no real lights are controlled.
"""

import base64
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid


def main() -> None:
    base = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000").rstrip("/")

    def request(path, data=None, method=None):
        body = json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(
            base + path, body, {"Content-Type": "application/json"}, method=method
        )
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.read(), response.headers

    def api(path, data=None, method=None):
        body, headers = request(path, data, method)
        assert "application/json" in headers["Content-Type"], path
        return json.loads(body)

    html, headers = request("/")
    assert "text/html" in headers["Content-Type"]
    assert "Aurora" in html.decode()
    assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', html.decode())
    assert assets, "Built JS/CSS assets missing from index.html"
    for asset in assets:
        content, headers = request(asset)
        assert len(content) > 100 and "text/html" not in headers["Content-Type"]
    print(f"PASS frontend HTML and {len(assets)} compiled assets")
    assert api("/api/health") == {"status": "ok"}
    assert isinstance(api("/api/presets"), dict)
    assert isinstance(api("/api/wled/layout"), dict)
    images = api("/api/test-images")["images"]
    assert images, "Bundled test images missing"
    image, headers = request("/api/test-images/" + urllib.parse.quote(images[0]))
    assert headers["Content-Type"].startswith("image/")
    colors = api("/api/perimeter-colors", {"test_image": images[0], "led_count": 90})
    assert len(colors["colors"]) == 90
    # A small valid PPM fixture exercises native OpenCV decoding/warp/encoding
    # independently of image dimensions in the repository's bundled assets.
    ppm = b"P6\n64 36\n255\n" + bytes([80, 140, 200]) * (64 * 36)
    result = api("/api/analyze", {
        "image": base64.b64encode(ppm).decode(),
        "corners": [[0, 0], [63, 0], [63, 35], [0, 35]],
        "led_count": 90, "lighting_level": "high",
    })
    assert len(result["rgb"]) == 3 and len(result["led_colors"]) == 90
    assert base64.b64decode(result["corrected"]).startswith(b"\xff\xd8")
    assert base64.b64decode(result["diagnostic"]).startswith(b"\xff\xd8")
    print("PASS API health, settings, test-image serving, perimeter sampling and OpenCV analysis")
    name = "container-smoke-" + uuid.uuid4().hex
    try:
        assert api("/api/presets", {"name": name, "config": {"ceiling": 20}}, "PUT") == {"status": "saved"}
        assert api("/api/presets")[name] == {"ceiling": 20}
    finally:
        api("/api/presets/" + name, method="DELETE")
    assert name not in api("/api/presets")
    print("PASS preset create/read/delete on the writable data volume")
    for path in ("/api/not-found", "/assets/not-found.js"):
        try:
            request(path)
        except urllib.error.HTTPError as error:
            assert error.code == 404
        else:
            raise AssertionError(f"{path} should return 404")
    print("PASS missing API routes/assets return 404")


if __name__ == "__main__":
    main()
