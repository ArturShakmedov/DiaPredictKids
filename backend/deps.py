# -*- coding: utf-8 -*-
"""Общие зависимости: текущий врач или родитель из сессии."""
from __future__ import annotations

import sqlite3

from fastapi import HTTPException, Request, status

from . import config, db, security


def current_clinician(request: Request) -> sqlite3.Row | None:
    """Врач из подписанной cookie или None."""
    cid = security.read_session(request.cookies.get(config.SESSION_COOKIE))
    if cid is None:
        return None
    return db.one("SELECT id, email, name, role FROM clinicians WHERE id = ?", (cid,))


def require_clinician(request: Request) -> sqlite3.Row:
    """То же, но для защищённых эндпоинтов: без сессии — 401."""
    row = current_clinician(request)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется вход в кабинет врача",
        )
    return row


def current_parent(request: Request) -> sqlite3.Row | None:
    """Родитель из подписанной cookie или None."""
    pid = security.read_parent_session(request.cookies.get(config.PARENT_COOKIE))
    if pid is None:
        return None
    return db.one("SELECT id, email, name, created_at FROM parents WHERE id = ?", (pid,))


def require_parent(request: Request) -> sqlite3.Row:
    row = current_parent(request)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Требуется вход в кабинет пациента",
        )
    return row


def check_origin(request: Request) -> None:
    """Простейшая защита от межсайтовых запросов, меняющих состояние.

    Cookie помечены SameSite=Lax, так что сторонний сайт не сможет отправить
    их fetch-ом; эта проверка — второй рубеж на случай ошибок в браузере.
    """
    origin = request.headers.get("origin")
    if origin is None:                       # обычная навигация или curl
        return
    host = request.headers.get("host", "")
    if origin.split("://")[-1] != host:
        raise HTTPException(status_code=403, detail="Чужой источник запроса")
