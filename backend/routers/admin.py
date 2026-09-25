# -*- coding: utf-8 -*-
"""Настройки кабинета: профиль врача, код клиники и список врачей.

Всё, что раньше делалось руками в файлах и командной строке: код приглашения
лежал в data/clinic_code.txt, а врача можно было завести только через базу.
Теперь этим управляет администратор прямо в кабинете.
"""
from __future__ import annotations

import secrets
import sqlite3

from fastapi import APIRouter, Depends, HTTPException, Request, status

from .. import config, db, deps, security
from ..schemas import (ClinicSettingsOut, DoctorOut, PasswordChangeIn,
                       RoleIn, TempPasswordOut)

router = APIRouter(prefix="/api/admin", tags=["admin"])

ADMIN = "admin"


def require_admin(request: Request) -> sqlite3.Row:
    """Настройки клиники меняет только администратор."""
    clinician = deps.require_clinician(request)
    if clinician["role"] != ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Нужны права администратора")
    return clinician


def _doctor_out(row: sqlite3.Row) -> DoctorOut:
    return DoctorOut(id=row["id"], email=row["email"], name=row["name"],
                     role=row["role"], created_at=row["created_at"])


def _admins() -> int:
    return db.one("SELECT COUNT(*) c FROM clinicians WHERE role = ?", (ADMIN,))["c"]


@router.get("/settings", response_model=ClinicSettingsOut)
def settings(clinician=Depends(deps.require_clinician)) -> ClinicSettingsOut:
    """Что показать в разделе «Настройки»: свой профиль, а админу — и клинику."""
    is_admin = clinician["role"] == ADMIN
    doctors = [_doctor_out(r) for r in db.query(
        "SELECT * FROM clinicians ORDER BY id")] if is_admin else []
    # в сессии лежат только id, почта, имя и роль — за датой идём в базу
    me = db.one("SELECT * FROM clinicians WHERE id = ?", (clinician["id"],))
    return ClinicSettingsOut(
        me=_doctor_out(me),
        is_admin=is_admin,
        clinic_code=config.clinic_code() if is_admin else None,
        code_from_env=config.clinic_code_from_env(),
        doctors=doctors,
    )


@router.post("/code", response_model=ClinicSettingsOut)
def new_code(clinician=Depends(require_admin),
             _: None = Depends(deps.check_origin)) -> ClinicSettingsOut:
    """Новый код клиники: старый перестаёт работать сразу."""
    if config.clinic_code_from_env():
        raise HTTPException(
            status_code=409,
            detail="Код задан через NDST_CLINIC_CODE — меняется только там")
    config.set_clinic_code(config.make_clinic_code())
    return settings(clinician)


@router.patch("/password")
def change_password(data: PasswordChangeIn, clinician=Depends(deps.require_clinician),
                    _: None = Depends(deps.check_origin)) -> dict[str, bool]:
    """Смена своего пароля: старый проверяем, новый сохраняем хешем."""
    row = db.one("SELECT password_hash FROM clinicians WHERE id = ?", (clinician["id"],))
    if not security.verify_password(data.current_password, row["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Текущий пароль не подошёл")
    db.execute("UPDATE clinicians SET password_hash = ? WHERE id = ?",
               (security.hash_password(data.new_password), clinician["id"]))
    return {"ok": True}


@router.patch("/doctors/{doctor_id}", response_model=ClinicSettingsOut)
def set_role(doctor_id: int, data: RoleIn, clinician=Depends(require_admin),
             _: None = Depends(deps.check_origin)) -> ClinicSettingsOut:
    """Выдать или снять права администратора."""
    row = db.one("SELECT * FROM clinicians WHERE id = ?", (doctor_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Врач не найден")
    if row["role"] == ADMIN and data.role != ADMIN and _admins() <= 1:
        raise HTTPException(status_code=409,
                            detail="Это единственный администратор — сначала назначьте другого")
    db.execute("UPDATE clinicians SET role = ? WHERE id = ?", (data.role, doctor_id))
    return settings(clinician)


@router.post("/doctors/{doctor_id}/password", response_model=TempPasswordOut)
def reset_password(doctor_id: int, clinician=Depends(require_admin),
                   _: None = Depends(deps.check_origin)) -> TempPasswordOut:
    """Временный пароль для врача, который забыл свой.

    Почты у проекта нет, поэтому пароль показывается администратору, а тот
    передаёт его врачу. Врач потом меняет его в своих настройках.
    """
    if db.one("SELECT id FROM clinicians WHERE id = ?", (doctor_id,)) is None:
        raise HTTPException(status_code=404, detail="Врач не найден")
    if doctor_id == clinician["id"]:
        raise HTTPException(status_code=409,
                            detail="Свой пароль меняется в профиле")
    temporary = secrets.token_urlsafe(9)
    db.execute("UPDATE clinicians SET password_hash = ? WHERE id = ?",
               (security.hash_password(temporary), doctor_id))
    return TempPasswordOut(password=temporary)


@router.delete("/doctors/{doctor_id}", response_model=ClinicSettingsOut)
def remove_doctor(doctor_id: int, clinician=Depends(require_admin),
                  _: None = Depends(deps.check_origin)) -> ClinicSettingsOut:
    """Убрать доступ врачу. Оценки остаются, теряется только вход."""
    row = db.one("SELECT * FROM clinicians WHERE id = ?", (doctor_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Врач не найден")
    if doctor_id == clinician["id"]:
        raise HTTPException(status_code=409, detail="Нельзя убрать доступ самому себе")
    if row["role"] == ADMIN and _admins() <= 1:
        raise HTTPException(status_code=409,
                            detail="Это единственный администратор — сначала назначьте другого")
    db.execute("DELETE FROM clinicians WHERE id = ?", (doctor_id,))
    return settings(clinician)
