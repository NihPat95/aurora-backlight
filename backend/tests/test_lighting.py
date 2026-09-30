import numpy as np
import pytest
from pydantic import ValidationError

from backlight_tracker.api import AnalyzeRequest
from backlight_tracker.lighting import lighting_colors


@pytest.mark.parametrize("level", ["low", "medium", "high"])
@pytest.mark.parametrize("count", [1, 7, 100, 1200])
def test_levels_preserve_physical_count_and_rgb_range(level, count):
    image = np.random.default_rng(2).integers(0, 256, (90, 160, 3), dtype=np.uint8)
    colors = lighting_colors(image, count, level)
    assert len(colors) == count
    assert np.asarray(colors).shape == (count, 3)
    assert np.all((np.asarray(colors) >= 0) & (np.asarray(colors) <= 255))


def test_low_uses_picture_interior_not_only_perimeter():
    image = np.zeros((100, 160, 3), dtype=np.uint8)
    image[25:75, 40:120, 2] = 200
    colors = lighting_colors(image, 100, "low")
    assert len(set(colors)) == 1
    assert colors[0][0] > colors[0][2]
    assert colors[0][0] > 0


@pytest.mark.parametrize("level", ["low", "medium", "high"])
def test_black_scene_turns_colors_black(level):
    assert set(lighting_colors(np.zeros((90, 160, 3), np.uint8), 100, level)) == {(0, 0, 0)}


def test_level_is_validated_and_legacy_defaults_are_calm():
    base = dict(image="", corners=[(0, 0), (100, 0), (100, 100), (0, 100)])
    assert AnalyzeRequest(**base).lighting_level == "low"
    with pytest.raises(ValidationError):
        AnalyzeRequest(**base, lighting_level="extreme")
