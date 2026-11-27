"""py2app build of the TMTools Capture menu-bar app (see build.sh)."""
from pathlib import Path

from setuptools import setup

here = Path(__file__).resolve().parent
OPTIONS = {
    "argv_emulation": False,
    "iconfile": str(here / "icons" / "app.icns"),
    "resources": [str(here / "icons" / "menubar.png"), str(here / "icons" / "menubar@2x.png")],
    "includes": ["agent", "core", "certifi", "websockets", "httpx", "h11", "httpcore", "anyio", "idna", "sniffio"],
    "packages": ["rumps", "anyio"],
    "plist": {
        "CFBundleName": "TMTools Capture",
        "CFBundleDisplayName": "TMTools Capture",
        "CFBundleIdentifier": "dev.tmtools.capture",
        "CFBundleShortVersionString": "1.0.0",
        "LSUIElement": True,  # menu-bar only, no Dock icon
        "LSMinimumSystemVersion": "12.0",
        "NSCameraUsageDescription": "TMTools Capture records the video feed from your capture card or camera.",
        "NSMicrophoneUsageDescription": "TMTools Capture records the audio that comes with the video feed.",
    },
}

setup(app=["tray.py"], name="TMTools Capture", options={"py2app": OPTIONS}, setup_requires=["py2app"])
