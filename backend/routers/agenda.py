"""Event agenda API: staff manage the day / finals agendas (`comms:read` / `comms:manage`).

The agenda is shown on the public site and announced to the rooms (see `modules/notifications`).
"""
from __future__ import annotations

import re
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.audit import log_action
from backend.core.dependencies import CurrentPrincipal, get_db, require_permission
from backend.models.agenda import AgendaItem
from backend.schemas.agenda import (
    AgendaBase,
    AgendaImport,
    AgendaImportError,
    AgendaImportResult,
    AgendaRead,
    AgendaReorder,
)

router = APIRouter(tags=["agenda"])


async def _agenda_items(db: AsyncSession, scope: str | None = None) -> list[AgendaItem]:
    stmt = select(AgendaItem).order_by(AgendaItem.scope, AgendaItem.position, AgendaItem.start_time)
    if scope:
        stmt = stmt.where(AgendaItem.scope == scope)
    return list((await db.execute(stmt)).scalars())


@router.get("/api/v1/comms/agenda", response_model=list[AgendaRead], dependencies=[Depends(require_permission("comms:read"))])
async def list_agenda(db: Annotated[AsyncSession, Depends(get_db)]) -> list[AgendaItem]:
    return await _agenda_items(db)


def _place(siblings: list[AgendaItem], item: AgendaItem, position: int | None) -> None:
    """Puts `item` into `siblings` (its scope's other items, in order) at
    `position` — or, when none is given, chronologically by start time — and
    renumbers the scope 0..n."""
    if position is None:
        index = next((i for i, s in enumerate(siblings) if s.start_time > item.start_time), len(siblings))
    else:
        index = min(position, len(siblings))
    for number, member in enumerate([*siblings[:index], item, *siblings[index:]]):
        member.position = number


@router.post("/api/v1/comms/agenda", response_model=AgendaRead, status_code=201)
async def create_agenda_item(
    body: AgendaBase,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[CurrentPrincipal, Depends(require_permission("comms:manage"))],
) -> AgendaItem:
    data = body.model_dump()
    position = data.pop("position")
    item = AgendaItem(**data, position=0)
    siblings = await _agenda_items(db, body.scope)
    db.add(item)
    _place(siblings, item, position)
    await db.commit()
    await db.refresh(item)
    await log_action(db, principal.subject, "create", "agenda_item", str(item.id), changes={"title": body.title})
    return item


@router.put("/api/v1/comms/agenda/order", status_code=204, response_model=None)
async def reorder_agenda(
    body: AgendaReorder,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[CurrentPrincipal, Depends(require_permission("comms:manage"))],
) -> Response:
    """Drag-and-drop ordering: `ids` first (in that order), unlisted items after."""
    items = {i.id: i for i in await _agenda_items(db, body.scope)}
    unknown = [str(i) for i in body.ids if i not in items]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Not in this agenda: {', '.join(unknown)}")
    if len(set(body.ids)) != len(body.ids):
        raise HTTPException(status_code=422, detail="Duplicate ids")
    rest = [i for key, i in items.items() if key not in set(body.ids)]
    for number, item in enumerate([items[i] for i in body.ids] + rest):
        item.position = number
    await db.commit()
    await log_action(db, principal.subject, "reorder", "agenda_item", body.scope)
    return Response(status_code=204)


_IMPORT_LINE = re.compile(
    r"^\s*(\d{1,2}:\d{2})\s*(?:[-–—]\s*(\d{1,2}:\d{2}))?\s+(.+?)\s*(?:\|\s*(.*?))?\s*$"
)


def _norm_time(value: str) -> str | None:
    hours, minutes = value.split(":")
    if not (0 <= int(hours) <= 23 and 0 <= int(minutes) <= 59):
        return None
    return f"{int(hours):02d}:{minutes}"


def parse_agenda_import(scope: str, text: str) -> tuple[list[AgendaBase], list[AgendaImportError]]:
    items: list[AgendaBase] = []
    errors: list[AgendaImportError] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = _IMPORT_LINE.match(line)
        if match is None:
            errors.append(AgendaImportError(line=number, error="Expected 'HH:MM[-HH:MM] Title [| details]'"))
            continue
        start, end, title, details = match.groups()
        start_n, end_n = _norm_time(start), (_norm_time(end) if end else None)
        if start_n is None or (end and end_n is None):
            errors.append(AgendaImportError(line=number, error="Time must be between 00:00 and 23:59"))
        elif len(title) > 200 or (details and len(details) > 2000):
            errors.append(AgendaImportError(line=number, error="Title or details too long"))
        else:
            items.append(AgendaBase(scope=scope, start_time=start_n, end_time=end_n, title=title, details=details or None))
    return items, errors


@router.post("/api/v1/comms/agenda/import", response_model=AgendaImportResult)
async def import_agenda(
    body: AgendaImport,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[CurrentPrincipal, Depends(require_permission("comms:manage"))],
) -> AgendaImportResult:
    """Bulk-adds agenda items from pasted text, all-or-nothing: any bad line
    rejects the whole import (nothing is written) and is reported by line."""
    items, errors = parse_agenda_import(body.scope, body.text)
    if not items and not errors:
        errors.append(AgendaImportError(line=1, error="No agenda lines found"))
    if errors or body.dry_run:
        return AgendaImportResult(created=0, errors=errors, items=items)
    existing = [] if body.replace else await _agenda_items(db, body.scope)
    if body.replace:
        await db.execute(delete(AgendaItem).where(AgendaItem.scope == body.scope))
    start = len(existing)
    for offset, item in enumerate(items):
        data = item.model_dump()
        data.pop("position")
        db.add(AgendaItem(**data, position=start + offset))
    await db.commit()
    await log_action(
        db, principal.subject, "import", "agenda_item", body.scope, changes={"count": len(items), "replace": body.replace}
    )
    return AgendaImportResult(created=len(items), items=items)


@router.put("/api/v1/comms/agenda/{item_id}", response_model=AgendaRead)
async def update_agenda_item(
    item_id: UUID,
    body: AgendaBase,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[CurrentPrincipal, Depends(require_permission("comms:manage"))],
) -> AgendaItem:
    item = await db.get(AgendaItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Agenda item not found")
    moved_scope = item.scope != body.scope
    for key, value in body.model_dump(exclude={"position"}).items():
        setattr(item, key, value)
    if moved_scope or body.position is not None:
        siblings = [i for i in await _agenda_items(db, body.scope) if i.id != item.id]
        _place(siblings, item, body.position)
    await db.commit()
    await log_action(db, principal.subject, "update", "agenda_item", str(item_id))
    return item


@router.delete("/api/v1/comms/agenda/{item_id}", status_code=204, response_model=None)
async def delete_agenda_item(
    item_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    principal: Annotated[CurrentPrincipal, Depends(require_permission("comms:manage"))],
) -> Response:
    item = await db.get(AgendaItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Agenda item not found")
    await db.delete(item)
    await db.commit()
    await log_action(db, principal.subject, "delete", "agenda_item", str(item_id))
    return Response(status_code=204)
