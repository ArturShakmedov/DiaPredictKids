# -*- coding: utf-8 -*-
"""Вход и выход врача."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from .. import config, db, deps, ratelimit, security
from ..schemas import ClinicianOut, ClinicianRegisterIn, LoginIn

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookie(response: Response, clinician_id: int) -> None:
    response.set_cookie(
        config.SESSION_COOKIE,
        security.create_session(clinician_id),
        max_age=config.SESSION_TTL_SECONDS,
        httponly=True,
        samesite="lax",
        secure=config.COOKIE_SECURE,
        path="/",
    )


@router.post("/login", response_model=ClinicianOut)
def login(data: LoginIn, request: Request, response: Response,
          _: None = Depends(deps.check_origin)) -> ClinicianOut:
    key = ratelimit.key_for(request, data.email)

    if ratelimit.too_many(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток. Повторите через несколько минут.",
        )

    row = db.one("SELECT * FROM clinicians WHERE email = ?", (data.email,))
    # Пароль проверяем всегда, даже если почты нет, — чтобы по времени ответа
    # нельзя было понять, существует ли учётная запись.
    stored = row["password_hash"] if row else security.DUMMY_HASH
    ok = security.verify_password(data.password, stored)

    if not row or not ok:
        ratelimit.remember_failure(key)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Неверная почта или пароль")

    ratelimit.reset(key)
    _set_cookie(response, row["id"])
    return ClinicianOut(id=row["id"], email=row["email"], name=row["name"], role=row["role"])


@router.post("/register", response_model=ClinicianOut, status_code=201)
def register(data: ClinicianRegisterIn, request: Request, response: Response,
             _: None = Depends(deps.check_origin)) -> ClinicianOut:
    """Регистрация врача по коду клиники.

    Код общий для клиники и лежит в data/clinic_code.txt. Попытки подбора
    ограничены тем же счётчиком, что и вход, иначе код можно было бы
    перебрать за ночь.
    """
    key = ratelimit.key_for(request, "clinic-register")
    if ratelimit.too_many(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток. Повторите через несколько минут.",
        )

    if not secrets.compare_digest(data.code, config.clinic_code()):
        ratelimit.remember_failure(key)
        raise HTTPException(status_code=403, detail="Неверный код клиники")

    if db.one("SELECT id FROM clinicians WHERE email = ?", (data.email,)):
        raise HTTPException(status_code=409, detail="Такая почта уже зарегистрирована")

    ratelimit.reset(key)
    # Без демо-учётки первый врач в базе и есть администратор клиники —
    # иначе управлять кодом и доступами было бы некому до перезапуска.
    has_admin = db.one("SELECT 1 FROM clinicians WHERE role = 'admin'") is not None
    role = "pediatrician" if has_admin else "admin"
    cur = db.execute(
        "INSERT INTO clinicians (email, name, role, password_hash, created_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (data.email, data.name, role,
         security.hash_password(data.password), db.now_iso()),
    )
    _set_cookie(response, cur.lastrowid)
    return ClinicianOut(id=cur.lastrowid, email=data.email, name=data.name, role=role)


@router.post("/logout")
def logout(response: Response) -> dict[str, bool]:
    response.delete_cookie(config.SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me", response_model=ClinicianOut)
def me(clinician=Depends(deps.require_clinician)) -> ClinicianOut:
    return ClinicianOut(id=clinician["id"], email=clinician["email"],
                        name=clinician["name"], role=clinician["role"])
