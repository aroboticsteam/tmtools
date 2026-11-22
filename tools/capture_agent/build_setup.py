"""Re-embed agent.py into capture-setup.sh (the self-contained installer): python3 build_setup.py"""
from pathlib import Path

MARK = "__AGENT_PY_BELOW__\n"
here = Path(__file__).parent
script = (here / "capture-setup.sh").read_text()
head = script.split(MARK, 1)[0] + MARK
(here / "capture-setup.sh").write_text(head + (here / "agent.py").read_text())
