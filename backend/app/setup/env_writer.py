"""Atomic .env rewrite — write to .env.tmp, fsync, rename."""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path


def update_env_file(path: Path, updates: dict[str, str]) -> None:
    """Atomically rewrite `path`, replacing or appending each key in `updates`.

    Reads existing content, replaces matching `KEY=...` lines (preserving
    surrounding lines unchanged), then writes via tempfile + fsync + rename.
    """
    if not path.exists():
        existing_lines: list[str] = []
    else:
        existing_lines = path.read_text(encoding="utf-8").splitlines()

    seen: set[str] = set()
    new_lines: list[str] = []
    for line in existing_lines:
        # Strip optional `export ` and find KEY= prefix
        m = re.match(r"^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=", line)
        if m and m.group(1) in updates:
            key = m.group(1)
            new_lines.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            new_lines.append(line)

    # Append any keys not yet present
    for key, value in updates.items():
        if key not in seen:
            new_lines.append(f"{key}={value}")

    contents = "\n".join(new_lines)
    if not contents.endswith("\n"):
        contents += "\n"

    # Atomic write: tempfile in same directory → rename
    parent = path.parent
    parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".env.", dir=parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(contents)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        # Best-effort cleanup of the tempfile if rename failed
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
