# -*- coding: utf-8 -*-
"""Схемы запросов и ответов."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

import re

from pydantic import BaseModel, Field, field_validator

from . import dst
from .scoring import (ALL_RISKS, BLOOD, CARBS, DIET, DURATION, DYSPLASIA,
                      SYMPTOMS)


class DstExamIn(BaseModel):
    """Осмотр по шкале ДСТ, который заполняет врач. Индекс считает сервер."""

    phenotypes: list[str] = Field(default_factory=list, max_length=len(dst.PHENOTYPES))
    complex: dict[str, int] = Field(default_factory=dict)
    tests: dict[str, bool] = Field(default_factory=dict)
    anomalies: list[str] = Field(default_factory=list, max_length=len(dst.ANOMALIES))

    @field_validator("phenotypes")
    @classmethod
    def _check_phenotypes(cls, v: list[str]) -> list[str]:
        bad = sorted(set(v) - set(dst.PHENOTYPES))
        if bad:
            raise ValueError("неизвестные признаки ДСТ: " + ", ".join(bad))
        return v

    @field_validator("anomalies")
    @classmethod
    def _check_anomalies(cls, v: list[str]) -> list[str]:
        bad = sorted(set(v) - set(dst.ANOMALIES))
        if bad:
            raise ValueError("неизвестные аномалии: " + ", ".join(bad))
        return v

    @field_validator("complex")
    @classmethod
    def _check_complex(cls, v: dict[str, int]) -> dict[str, int]:
        bad = sorted(set(v) - set(dst.COMPLEX))
        if bad:
            raise ValueError("неизвестные признаки с градацией: " + ", ".join(bad))
        wrong = sorted(k for k, w in v.items() if w not in (0, 3, 5))
        if wrong:
            raise ValueError("градация может быть только 0, 3 или 5: " + ", ".join(wrong))
        return v

    @field_validator("tests")
    @classmethod
    def _check_tests(cls, v: dict[str, bool]) -> dict[str, bool]:
        bad = sorted(set(v) - set(dst.TESTS))
        if bad:
            raise ValueError("неизвестные тесты: " + ", ".join(bad))
        return v


class AssessmentIn(BaseModel):
    """Ответы анкеты. Балл не принимаем — сервер считает его сам."""

    age: int = Field(ge=1, le=17)
    sex: Literal["m", "f"]
    height: float = Field(ge=50, le=210)
    weight: float = Field(ge=5, le=150)
    symptoms: list[str] = Field(default_factory=list, max_length=20)
    risks: list[str] = Field(default_factory=list, max_length=20)
    duration: str = "none"

    # Питание, доля углеводов, группа крови и признаки дисплазии
    # соединительной ткани. Значения по умолчанию делают поля
    # необязательными: анкеты, отправленные старым клиентом, не ломаются.
    diet: str = "unknown"
    carbs: str = "unknown"
    blood: str = "unknown"
    dysplasia: list[str] = Field(default_factory=list, max_length=20)
    # Шаг 4 анкеты приходит осмотром по шкале ДСТ. Старый клиент присылал
    # короткий список признаков — он всё ещё принимается полем dysplasia.
    dst: DstExamIn | None = None
    source: Literal["parent", "clinic"] = "parent"
    patient_label: str | None = Field(default=None, max_length=80)
    # Кому из детей засчитать оценку. Учитывается только вместе с сессией
    # родителя и только если ребёнок принадлежит именно ему.
    child_id: int | None = Field(default=None, ge=1)

    @field_validator("symptoms")
    @classmethod
    def _check_symptoms(cls, v: list[str]) -> list[str]:
        bad = sorted(set(v) - set(SYMPTOMS))
        if bad:
            raise ValueError("неизвестные симптомы: " + ", ".join(bad))
        return sorted(set(v))

    @field_validator("risks")
    @classmethod
    def _check_risks(cls, v: list[str]) -> list[str]:
        bad = sorted(set(v) - set(ALL_RISKS))
        if bad:
            raise ValueError("неизвестные факторы риска: " + ", ".join(bad))
        return sorted(set(v))

    @field_validator("duration")
    @classmethod
    def _check_duration(cls, v: str) -> str:
        if v not in DURATION:
            raise ValueError("неизвестная длительность: " + v)
        return v

    @field_validator("dysplasia")
    @classmethod
    def _check_dysplasia(cls, v: list[str]) -> list[str]:
        bad = sorted(set(v) - set(DYSPLASIA))
        if bad:
            raise ValueError("неизвестные признаки дисплазии: " + ", ".join(bad))
        return sorted(set(v))

    @field_validator("diet")
    @classmethod
    def _check_diet(cls, v: str) -> str:
        if v not in DIET:
            raise ValueError("неизвестный характер питания: " + v)
        return v

    @field_validator("carbs")
    @classmethod
    def _check_carbs(cls, v: str) -> str:
        if v not in CARBS:
            raise ValueError("неизвестная доля углеводов: " + v)
        return v

    @field_validator("blood")
    @classmethod
    def _check_blood(cls, v: str) -> str:
        if v not in BLOOD:
            raise ValueError("неизвестная группа крови: " + v)
        return v


class PdfIn(AssessmentIn):
    """Ответы для PDF-сводки: те же поля анкеты плюс язык и код оценки."""

    lang: Literal["ru", "uz", "en"] = "ru"
    # Код печатается в сводке, поэтому принимаем только формат, который
    # выдаёт сервер. Что такая оценка существует, проверяет обработчик.
    code: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{6,32}$")


class AssessmentOut(BaseModel):
    public_id: str
    created_at: str
    score: int
    level: str
    total: int
    bmi: float
    bmi_code: str
    age: int
    sex: str
    height: float
    weight: float
    symptoms: list[str]
    risks: list[str]
    duration: str
    diet: str = "unknown"
    carbs: str = "unknown"
    blood_group: str = "unknown"
    dysplasia: list[str] = Field(default_factory=list)
    factors: list[dict]
    follow_up: bool = False
    patient_label: str | None = None
    source: str = "parent"
    # Попала ли оценка в кабинет родителя — экран результата показывает
    # по этому полю ссылку на кабинет вместо голого кода.
    in_cabinet: bool = False
    child_id: int | None = None
    child_name: str | None = None
    # Шкала ДСТ. dst_source: doctor — осмотр врача, parent — предварительно
    # по ответам родителя. Число признаков и аномалий выводятся из осмотра.
    dst_index: int = 0
    dst_degree: int = 0
    dst_source: str = "parent"
    dst_exam: dict = Field(default_factory=dict)
    dst_chosen: int = 0
    dst_heavy: int = 0
    dst_anomalies: int = 0


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s.]+\.[^@\s]+$")


class LoginIn(BaseModel):
    """Отдельный пакет email-validator ради одного поля не тянем."""

    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _check_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("неверный формат почты")
        return v


class ClinicianRegisterIn(LoginIn):
    """Регистрация врача: та же почта с паролем плюс имя и код клиники."""

    name: str = Field(min_length=2, max_length=80)
    code: str = Field(min_length=4, max_length=64)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("укажите имя")
        return v

    @field_validator("code")
    @classmethod
    def _clean_code(cls, v: str) -> str:
        return v.strip()


class ClinicianOut(BaseModel):
    id: int
    email: str
    name: str
    role: str


class DoctorOut(BaseModel):
    id: int
    email: str
    name: str
    role: str
    created_at: str


class ClinicSettingsOut(BaseModel):
    """Раздел «Настройки»: свой профиль, а администратору — и клиника."""

    me: DoctorOut
    is_admin: bool
    clinic_code: str | None = None
    code_from_env: bool = False
    doctors: list[DoctorOut] = Field(default_factory=list)


class TempPasswordOut(BaseModel):
    """Временный пароль показывается администратору один раз."""

    password: str


class RoleIn(BaseModel):
    role: Literal["admin", "pediatrician"]


class PasswordChangeIn(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class FollowUpIn(BaseModel):
    follow_up: bool


class LabelIn(BaseModel):
    patient_label: str | None = Field(default=None, max_length=80)


# --------------------------------------------------------------------------
# Кабинет пациента
# --------------------------------------------------------------------------

class RegisterIn(LoginIn):
    """Регистрация родителя: та же проверка почты плюс имя."""

    name: str = Field(min_length=2, max_length=80)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("укажите имя")
        return v


class ParentOut(BaseModel):
    id: int
    email: str
    name: str


class ChildIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    sex: Literal["m", "f"] | None = None
    birth_year: int | None = Field(default=None, ge=1990, le=2100)

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str) -> str:
        v = " ".join(v.split())
        if not v:
            raise ValueError("укажите имя ребёнка")
        return v

    @field_validator("birth_year")
    @classmethod
    def _check_year(cls, v: int | None) -> int | None:
        if v is None:
            return None
        year = datetime.now(timezone.utc).year
        if not (year - 18 <= v <= year):
            raise ValueError("год рождения вне допустимого диапазона")
        return v


class ChildOut(BaseModel):
    id: int
    name: str
    sex: str | None = None
    birth_year: int | None = None
    assessments: int = 0
    last_score: int | None = None
    last_level: str | None = None
    last_at: str | None = None


class LinkCodeIn(BaseModel):
    """Привязка уже пройденной анкеты по коду с экрана результата."""

    code: str = Field(min_length=4, max_length=64)
    child_id: int | None = Field(default=None, ge=1)

    @field_validator("code")
    @classmethod
    def _clean_code(cls, v: str) -> str:
        return v.strip()


class AssignChildIn(BaseModel):
    child_id: int | None = Field(default=None, ge=1)
