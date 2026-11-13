#!/usr/bin/env python3
"""Apply a local NGA session to the existing RSSHub service without logging secrets."""
import argparse
import os
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--session-file", type=Path, default=root / ".run/nga-session.env")
parser.add_argument("--compose-file", type=Path, default=root.parent / "RSSHub/docker-compose.yml")
args = parser.parse_args()
values = {}
for line in args.session_file.read_text().splitlines():
    key, sep, value = line.strip().partition("=")
    if sep and key in {"NGA_PASSPORT_UID", "NGA_PASSPORT_CID"}:
        values[key] = value.strip().strip("\"'")
if not all(values.get(key) for key in ("NGA_PASSPORT_UID", "NGA_PASSPORT_CID")):
    raise SystemExit("Fill both NGA session fields in the private session file first.")
args.session_file.chmod(0o600)
override = root / ".run/rsshub-nga-session.yml"
override.parent.mkdir(exist_ok=True)
override.write_text("services:\n  rsshub:\n    environment:\n      NGA_PASSPORT_UID: ${NGA_PASSPORT_UID:?required}\n      NGA_PASSPORT_CID: ${NGA_PASSPORT_CID:?required}\n")
override.chmod(0o600)
subprocess.run(["docker", "compose", "-f", str(args.compose_file.resolve()), "-f", str(override), "up", "-d", "--no-deps", "rsshub"], env={**os.environ, **values}, check=True)
print("NGA session configured for RSSHub. No session values were logged.")
