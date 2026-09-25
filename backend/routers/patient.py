# -*- coding: utf-8 -*-
"""Кабинет пациента: учётная запись родителя, дети и их оценки.

Родитель заводит учётную запись, добавляет детей и видит историю оценок.
Анкету по-прежнему можно пройти без регистрации — тогда родитель получает
код и позже привязывает оценку к кабинету сам.
"""
from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from .. import config, db, deps, ratelimit, security
from ..schemas import (AssessmentOut, AssignChildIn, ChildIn, ChildOut,
                       LinkCodeIn, LoginIn, ParentOut, RegisterIn)
from .assessments import to_out

router = APIRouter(prefix="/api/patient", tags=["patient"])


# --------------------------------------------------------------------------
# Помощники
# --------------------------------------------------------------------------

def _parent_out(row: sqlite3.Row) -> ParentOut:
    return ParentOut(id=row["id"], email=row["email"], name=row["name"])


def _set_cookie(response: Response, parent_id: int) -> None:
    response.set_cookie(
        config.PARENT_COOKIE,
        security.create_parent_session(parent_id),
        max_age=config.SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=config.COOKIE_SECURE,
        path="/",
    )


def _own_child(parent_id: int, child_id: int | None) -> int | None:
    """Проверяет, что ребёнок принадлежит именно этому родителю."""
    if child_id is None:
        return None
    row = db.one("SELECT id FROM children WHERE id = ? AND parent_id = ?",
                 (child_id, parent_id))
    if row is None:
        raise HTTPException(status_code=404, detail="Ребёнок не найден")
    return row["id"]


# --------------------------------------------------------------------------
# Вход и регистрация
# --------------------------------------------------------------------------

@router.post("/register", response_model=ParentOut, status_code=201)
def register(data: RegisterIn, request: Request, response: Response,
             _: None = Depends(deps.check_origin)) -> ParentOut:
    # Каждая регистрация — это scrypt на 32 МБ; без лимита ею легко нагрузить сервер
    key = ratelimit.key_for(request, "parent-register")
    if ratelimit.too_many(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток. Повторите через несколько минут.",
        )
    ratelimit.remember_failure(key)

    if db.one("SELECT id FROM parents WHERE email = ?", (data.email,)):
        raise HTTPException(status_code=409,
                            detail="Такая почта уже зарегистрирована")

    cur = db.execute(
        "INSERT INTO parents (email, name, password_hash, created_at)"
        " VALUES (?, ?, ?, ?)",
        (data.email, data.name, security.hash_password(data.password), db.now_iso()),
    )
    _set_cookie(response, cur.lastrowid)
    return ParentOut(id=cur.lastrowid, email=data.email, name=data.name)


@router.post("/login", response_model=ParentOut)
def login(data: LoginIn, request: Request, response: Response,
          _: None = Depends(deps.check_origin)) -> ParentOut:
    key = ratelimit.key_for(request, data.email)
    if ratelimit.too_many(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток. Повторите через несколько минут.",
        )

    row = db.one("SELECT * FROM parents WHERE email = ?", (data.email,))
    # Пароль сверяем и при отсутствии учётной записи, чтобы по времени
    # ответа нельзя было понять, зарегистрирована ли почта.
    stored = row["password_hash"] if row else security.DUMMY_HASH
    ok = security.verify_password(data.password, stored)

    if not row or not ok:
        ratelimit.remember_failure(key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Неверная почта или пароль")

    ratelimit.reset(key)
    _set_cookie(response, row["id"])
    return _parent_out(row)


@router.post("/logout")
def logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(config.PARENT_COOKIE, path="/")
    return {"ok": True}


@router.get("/me", response_model=ParentOut)
def me(parent=Depends(deps.require_parent)) -> ParentOut:
    return _parent_out(parent)


# --------------------------------------------------------------------------
# Дети
# --------------------------------------------------------------------------

# Показатели ребёнка считаются подзапросами, чтобы список профилей приходил
# одним запросом и уже с последней оценкой.
_CHILD_SELECT = """
    SELECT c.id, c.name, c.sex, c.birth_year,
           (SELECT COUNT(*) FROM assessments a WHERE a.child_id = c.id) AS assessments,
           (SELECT a.score FROM assessments a WHERE a.child_id = c.id
             ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_score,
           (SELECT a.level FROM assessments a WHERE a.child_id = c.id
             ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_level,
           (SELECT a.created_at FROM assessments a WHERE a.child_id = c.id
             ORDER BY a.created_at DESC, a.id DESC LIMIT 1) AS last_at
    FROM children c
"""


def _children_of(parent_id: int) -> list[ChildOut]:
    rows = db.query(_CHILD_SELECT + " WHERE c.parent_id = ? ORDER BY c.created_at, c.id",
                    (parent_id,))
    return [ChildOut(**dict(r)) for r in rows]


def _child_out(child_id: int) -> ChildOut:
    return ChildOut(**dict(db.one(_CHILD_SELECT + " WHERE c.id = ?", (child_id,))))


@router.get("/children", response_model=list[ChildOut])
def list_children(parent=Depends(deps.require_parent)) -> list[ChildOut]:
    return _children_of(parent["id"])


@router.post("/children", response_model=ChildOut, status_code=201)
def add_child(data: ChildIn, parent=Depends(deps.require_parent),
              _: None = Depends(deps.check_origin)) -> ChildOut:
    cur = db.execute(
        "INSERT INTO children (parent_id, name, sex, birth_year, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (parent["id"], data.name, data.sex, data.birth_year, db.now_iso()),
    )
    return _child_out(cur.lastrowid)


@router.patch("/children/{child_id}", response_model=ChildOut)
def edit_child(child_id: int, data: ChildIn, parent=Depends(deps.require_parent),
               _: None = Depends(deps.check_origin)) -> ChildOut:
    _own_child(parent["id"], child_id)
    db.execute("UPDATE children SET name = ?, sex = ?, birth_year = ? WHERE id = ?",
               (data.name, data.sex, data.birth_year, child_id))
    return _child_out(child_id)


@router.delete("/children/{child_id}", status_code=204)
def remove_child(child_id: int, parent=Depends(deps.require_parent),
                 _: None = Depends(deps.check_origin)) -> Response:
    """Оценки ребёнка остаются в кабинете, но теряют привязку к профилю."""
    _own_child(parent["id"], child_id)
    db.execute("DELETE FROM children WHERE id = ?", (child_id,))
    return Response(status_code=204)


# --------------------------------------------------------------------------
# Оценки родителя
# --------------------------------------------------------------------------

_OWN_SELECT = """
    SELECT a.*, c.name AS child_name
    FROM assessments a
    LEFT JOIN children c ON c.id = a.child_id
"""


def _own_one(assessment_id: int) -> AssessmentOut:
    return to_out(db.one(_OWN_SELECT + " WHERE a.id = ?", (assessment_id,)))


@router.get("/assessments", response_model=list[AssessmentOut])
def list_own(parent=Depends(deps.require_parent)) -> list[AssessmentOut]:
    rows = db.query(
        _OWN_SELECT + " WHERE a.parent_id = ? ORDER BY a.created_at DESC, a.id DESC",
        (parent["id"],))
    return [to_out(r) for r in rows]


@router.post("/assessments/link", response_model=AssessmentOut, status_code=201)
def link_by_code(data: LinkCodeIn, parent=Depends(deps.require_parent),
                 _: None = Depends(deps.check_origin)) -> AssessmentOut:
    """Привязывает к кабинету анкету, пройденную до входа, по её коду."""
    row = db.one("SELECT id, parent_id FROM assessments WHERE public_id = ?",
                 (data.code,))
    if row is None:
        raise HTTPException(status_code=404, detail="Оценка с таким кодом не найдена")
    if row["parent_id"] is not None and row["parent_id"] != parent["id"]:
        raise HTTPException(status_code=409,
                            detail="Эта оценка уже привязана к другому кабинету")

    child_id = _own_child(parent["id"], data.child_id)
    db.execute("UPDATE assessments SET parent_id = ?, child_id = ? WHERE id = ?",
               (parent["id"], child_id, row["id"]))
    return _own_one(row["id"])


@router.patch("/assessments/{public_id}/child", response_model=AssessmentOut)
def assign_child(public_id: str, data: AssignChildIn,
                 parent=Depends(deps.require_parent),
                 _: None = Depends(deps.check_origin)) -> AssessmentOut:
    """Переносит оценку в профиль другого ребёнка или снимает привязку."""
    row = db.one("SELECT id FROM assessments WHERE public_id = ? AND parent_id = ?",
                 (public_id, parent["id"]))
    if row is None:
        raise HTTPException(status_code=404, detail="Оценка не найдена")

    child_id = _own_child(parent["id"], data.child_id)
    db.execute("UPDATE assessments SET child_id = ? WHERE id = ?", (child_id, row["id"]))
    return _own_one(row["id"])
