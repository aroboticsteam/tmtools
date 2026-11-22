"""The self-contained capture installer must embed the current agent.py."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "tools" / "capture_agent"
MARK = "__AGENT_PY_BELOW__\n"


def test_embedded_agent_matches_agent_py() -> None:
    script = (ROOT / "capture-setup.sh").read_text()
    assert script.count("\n" + MARK) == 1
    assert script.split("\n" + MARK, 1)[1] == (ROOT / "agent.py").read_text(), (
        "capture-setup.sh is stale: run python3 tools/capture_agent/build_setup.py"
    )
