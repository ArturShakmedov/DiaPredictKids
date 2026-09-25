# -*- coding: utf-8 -*-
"""Сквозная проверка API на временной базе.

Приложение поднимается целиком (FastAPI TestClient), но с пустой базой во
временной папке — рабочие данные в data/ не трогаются. Проверяются роли и
права, регистрация по коду клиники, настройки, сохранение анкеты, осмотр ДСТ
и его перенос на следующие анкеты ребёнка, кабинет родителя и выгрузки.
PDF здесь не проверяется: для него нужен настоящий браузер на сервере.

Запуск: python tests/test_api.py
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = tempfile.mkdtemp(prefix="ndst-test-")

# окружение задаётся до импорта: config читает его один раз при загрузке
os.environ.update({
    "NDST_DATA_DIR": TMP,
    "NDST_DB": str(Path(TMP) / "test.db"),
    "NDST_SEED_DEMO": "1",
    "NDST_COOKIE_SECURE": "0",
    "NDST_SECRET": "test-secret",
})
os.environ.pop("NDST_CLINIC_CODE", None)
sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from backend import config  # noqa: E402
from backend.main import app  # noqa: E402

ORIGIN = {"Origin": "http://testserver"}
FAILED: list[str] = []


def check(name: str, cond: bool, extra: object = "") -> None:
    print(("  ok    " if cond else "  СБОЙ  ") + name + (" — %s" % (extra,) if extra != "" else ""))
    if not cond:
        FAILED.append(name)


def client() -> TestClient:
    c = TestClient(app)
    c.headers.update(ORIGIN)
    return c


ANSWERS = {
    "age": 8, "sex": "m", "height": 128, "weight": 26,
    "symptoms": ["thirst", "urination", "weightLoss"],
    "risks": ["t1dFather", "hashimoto", "viralInfection", "perinatal"],
    "duration": "gt8w", "diet": "sweets", "carbs": "high", "blood": "O",
    "dst": {"phenotypes": ["chest", "scoliosis", "flatfoot", "myopia"],
            "complex": {"beighton": 3}, "tests": {}, "anomalies": ["mitralProlapse"]},
}


def main() -> int:
    with client() as admin, client() as doctor, client() as parent, client() as guest:
        print("\n— вход и регистрация врача")
        r = admin.post("/api/auth/login", json={"email": config.DEMO_EMAIL,
                                                "password": config.DEMO_PASSWORD})
        check("первый врач входит и он администратор",
              r.status_code == 200 and r.json()["role"] == "admin", r.status_code)
        r = guest.post("/api/auth/login", json={"email": config.DEMO_EMAIL, "password": "wrongpass1"})
        check("неверный пароль — 401", r.status_code == 401, r.status_code)

        code = config.clinic_code()
        r = guest.post("/api/auth/register", json={"email": "doc@test.local", "password": "docpass123",
                                                   "name": "Врач Тестовый", "code": "WRONG-CODE"})
        check("чужой код клиники — 403", r.status_code == 403, r.status_code)
        r = doctor.post("/api/auth/register", json={"email": "doc@test.local", "password": "docpass123",
                                                    "name": "Врач Тестовый", "code": code})
        check("регистрация по коду клиники", r.status_code == 201 and r.json()["role"] == "pediatrician",
              r.status_code)
        doc_id = r.json()["id"]
        r = guest.post("/api/auth/register", json={"email": "doc@test.local", "password": "docpass123",
                                                   "name": "Дубль", "code": code})
        check("повтор почты — 409", r.status_code == 409, r.status_code)

        print("\n— настройки и права")
        r = admin.get("/api/admin/settings")
        s = r.json()
        check("администратор видит код и врачей",
              r.status_code == 200 and s["is_admin"] and s["clinic_code"] == code and len(s["doctors"]) == 2)
        admin_id = s["me"]["id"]
        r = doctor.get("/api/admin/settings")
        check("обычный врач кода не видит",
              r.status_code == 200 and not r.json()["is_admin"] and r.json()["clinic_code"] is None)
        check("обычный врач не меняет код — 403", doctor.post("/api/admin/code").status_code == 403)
        check("без входа настройки закрыты — 401", guest.get("/api/admin/settings").status_code == 401)

        r = admin.post("/api/admin/code")
        new_code = r.json()["clinic_code"]
        check("новый код клиники", r.status_code == 200 and new_code != code)
        r = guest.post("/api/auth/register", json={"email": "late@test.local", "password": "latepass123",
                                                   "name": "Опоздавший", "code": code})
        check("старый код больше не работает — 403", r.status_code == 403, r.status_code)

        check("себя удалить нельзя — 409", admin.delete("/api/admin/doctors/%d" % admin_id).status_code == 409)
        r = admin.patch("/api/admin/doctors/%d" % admin_id, json={"role": "pediatrician"})
        check("последнего администратора не разжаловать — 409", r.status_code == 409, r.status_code)
        r = admin.patch("/api/admin/doctors/%d" % doc_id, json={"role": "admin"})
        check("выдача прав администратора", r.status_code == 200)
        r = admin.patch("/api/admin/doctors/%d" % doc_id, json={"role": "pediatrician"})
        check("снятие прав администратора", r.status_code == 200)

        r = admin.post("/api/admin/doctors/%d/password" % doc_id)
        temporary = r.json().get("password", "")
        check("сброс пароля врачу", r.status_code == 200 and len(temporary) >= 8)
        # отдельный клиент: вход поставил бы cookie «гостю», и проверки «без входа» ниже
        # проверяли бы уже вошедшего врача
        with client() as once:
            r = once.post("/api/auth/login", json={"email": "doc@test.local", "password": temporary})
        check("вход с временным паролем", r.status_code == 200, r.status_code)
        check("сбросить себе пароль нельзя — 409",
              admin.post("/api/admin/doctors/%d/password" % admin_id).status_code == 409)

        doctor.post("/api/auth/login", json={"email": "doc@test.local", "password": temporary})
        r = doctor.patch("/api/admin/password", json={"current_password": "notthisone",
                                                      "new_password": "newdocpass123"})
        check("неверный текущий пароль — 401", r.status_code == 401, r.status_code)
        r = doctor.patch("/api/admin/password", json={"current_password": temporary,
                                                      "new_password": "newdocpass123"})
        check("смена своего пароля", r.status_code == 200, r.status_code)

        print("\n— анкета, кабинет родителя, осмотр ДСТ")
        r = parent.post("/api/patient/register", json={"email": "mom@test.local", "password": "mompass123",
                                                       "name": "Мама Тестовая"})
        check("регистрация родителя", r.status_code == 201, r.status_code)
        kid = parent.post("/api/patient/children", json={"name": "Сын", "sex": "m",
                                                         "birth_year": 2017}).json()

        r = parent.post("/api/assessments", json=dict(ANSWERS, child_id=kid["id"]))
        first = r.json()
        check("анкета сохраняется: ДСТ 5+4+4+4+3 = 20, I степень",
              r.status_code == 201 and first["dst_index"] == 20 and first["dst_degree"] == 1,
              (first.get("dst_index"), first.get("dst_degree")))
        check("анкета попала в кабинет родителя", first["in_cabinet"] and first["child_name"] == "Сын")

        r = doctor.get("/api/assessments?limit=200")
        check("врач видит анкету родителя",
              r.status_code == 200 and any(a["public_id"] == first["public_id"] for a in r.json()))
        check("имя ребёнка врачу не отдаётся",
              all(a["child_name"] is None for a in r.json()))

        pid = first["public_id"]
        r = doctor.patch("/api/assessments/%s/label" % pid, json={"patient_label": "Иванов"})
        check("метка пациента", r.status_code == 200 and r.json()["patient_label"] == "Иванов")
        r = doctor.patch("/api/assessments/%s/follow-up" % pid, json={"follow_up": True})
        check("повторный контроль", r.status_code == 200 and r.json()["follow_up"] is True)
        check("родитель видит отметку врача",
              any(a["follow_up"] for a in parent.get("/api/patient/assessments").json()))

        exam = {"phenotypes": ["chest", "scoliosis", "flatfoot", "myopia", "striae"],
                "complex": {"beighton": 5, "skin": 3}, "tests": {"steinberg": True, "walker": True},
                "anomalies": ["mitralProlapse", "urogenitalAnomaly"]}
        r = doctor.put("/api/assessments/%s/dst" % pid, json=exam)
        check("осмотр врача: 5+4+4+4+4+5+3+5 = 34, II степень, аномалии отдельно",
              r.status_code == 200 and r.json()["dst_index"] == 34 and r.json()["dst_degree"] == 2
              and r.json()["dst_anomalies"] == 2, r.json().get("dst_index"))
        check("мусор в осмотре — 422",
              doctor.put("/api/assessments/%s/dst" % pid, json={"complex": {"skin": 4}}).status_code == 422)
        check("осмотр без входа врача — 401",
              guest.put("/api/assessments/%s/dst" % pid, json=exam).status_code == 401)

        r = parent.post("/api/assessments", json=dict(ANSWERS, symptoms=["fatigue"], child_id=kid["id"]))
        second = r.json()
        check("осмотр переносится на следующую анкету ребёнка",
              second["dst_source"] == "doctor" and second["dst_index"] == 34,
              (second.get("dst_source"), second.get("dst_index")))
        r = doctor.delete("/api/assessments/%s/dst" % second["public_id"])
        check("возврат к ответам родителя",
              r.json()["dst_source"] == "parent" and r.json()["dst_index"] == 20)

        r = guest.post("/api/assessments", json=dict(ANSWERS, risks=["t1dFamily", "t1dGrand"],
                                                     dst=None, dysplasia=["flatfoot", "myopia"]))
        legacy = r.json()
        check("старый формат анкеты принимается", r.status_code == 201 and not legacy["in_cabinet"],
              r.status_code)
        r = parent.post("/api/patient/assessments/link", json={"code": legacy["public_id"],
                                                               "child_id": kid["id"]})
        check("привязка анкеты по коду", r.status_code in (200, 201), r.status_code)
        check("родитель видит все три анкеты", len(parent.get("/api/patient/assessments").json()) == 3)

        print("\n— статистика и выгрузки")
        r = doctor.get("/api/clinic/stats?days=90")
        stats = r.json()
        per_child = sum(g["n"] for g in stats["dst_groups"])
        check("сравнение групп считает детей, а не анкеты",
              r.status_code == 200 and per_child == 1 and stats["total"] == 3,
              (per_child, stats.get("total")))
        r = doctor.get("/api/clinic/report?days=30")
        check("отчёт за период", r.status_code == 200 and r.json()["total"] == 3 and r.json()["top_factors"])
        r = doctor.get("/api/clinic/export.csv")
        text = r.content.decode("utf-8")
        check("выгрузка CSV с BOM для Excel",
              r.status_code == 200 and text.startswith("﻿") and len(text.strip().splitlines()) == 4)
        r = doctor.get("/api/clinic/export.csv?follow_up=true")
        check("выгрузка учитывает фильтр", len(r.content.decode("utf-8").strip().splitlines()) == 2)
        check("выгрузка без входа — 401", guest.get("/api/clinic/export.csv").status_code == 401)
        check("список оценок без входа — 401", guest.get("/api/assessments").status_code == 401)

        print("\n— защита от межсайтовых запросов")
        r = admin.post("/api/admin/code", headers={"Origin": "http://evil.example"})
        check("чужой Origin — 403", r.status_code == 403, r.status_code)

    print("\nпроверок не прошло: %d" % len(FAILED))
    if FAILED:
        for name in FAILED:
            print("   -", name)
        return 1
    print("API работает как задумано")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
