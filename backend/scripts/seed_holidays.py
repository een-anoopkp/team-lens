"""Load holidays from infra/holidays/<region>.yaml into the holidays table.

Idempotent — safe to re-run after editing the YAML. Usage:
    cd backend && uv run python -m scripts.seed_holidays [--region IN] [--file path]
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import Any

import yaml
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db import get_session_factory
from app.models import Holiday


def _default_path(region: str) -> Path:
    return (
        Path(__file__).resolve().parent.parent.parent
        / "infra"
        / "holidays"
        / f"{region}.yaml"
    )


def _load_yaml(path: Path) -> tuple[str, list[dict[str, Any]]]:
    if not path.exists():
        raise SystemExit(f"holiday file not found: {path}")
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    region = data.get("region") or "IN"
    holidays = data.get("holidays") or []
    return region, holidays


async def _seed(region: str, rows: list[dict[str, Any]]) -> int:
    factory = get_session_factory()
    payload = [
        {"holiday_date": h["date"], "region": region, "name": h["name"]}
        for h in rows
        if "date" in h and "name" in h
    ]
    if not payload:
        return 0
    async with factory() as session:
        stmt = pg_insert(Holiday).values(payload)
        stmt = stmt.on_conflict_do_update(
            index_elements=[Holiday.holiday_date, Holiday.region],
            set_={"name": stmt.excluded.name},
        )
        await session.execute(stmt)
        await session.commit()
    return len(payload)


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--region", default="IN")
    parser.add_argument("--file", default=None)
    args = parser.parse_args()

    path = Path(args.file) if args.file else _default_path(args.region)
    region, rows = _load_yaml(path)
    if region != args.region and args.file is None:
        sys.stderr.write(f"warning: file region={region!r} differs from --region={args.region!r}\n")
    n = await _seed(region, rows)
    print(f"Seeded {n} holidays for region={region}")


if __name__ == "__main__":
    asyncio.run(main())
