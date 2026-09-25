# -*- coding: utf-8 -*-
"""Наполняет базу правдоподобными оценками, чтобы кабинет было на чём смотреть.

Запуск: python -m backend.seed [сколько]

Записи создаются теми же путями, что и настоящие: ответы прогоняются
через модель, балл считает сервер. Никаких выдуманных чисел в отчётах.
"""
from __future__ import annotations

import json
import random
import sys
from datetime import datetime, timedelta, timezone

from . import config, db, dst, scoring, security

# Наборы ответов, дающие разные уровни риска
PROFILES = [
    # (симптомы, факторы, длительность, вес профиля)
    ([], [], "none", 3),
    ([], ["lowActivity"], "none", 2),
    ([], ["sugarDrinks", "lowActivity"], "none", 2),
    (["fatigue"], [], "lt2w", 2),
    (["fatigue", "hunger"], ["t2dFamily"], "2to8w", 2),
    (["enuresis"], ["gdm"], "2to8w", 2),
    (["thirst", "fatigue"], ["acanthosis"], "2to8w", 2),
    (["thirst", "urination"], ["t2dFamily"], "2to8w", 2),
    (["thirst", "urination", "weightLoss"], ["t1dFamily"], "gt8w", 1),
    (["thirst", "urination", "weightLoss", "fatigue"], ["t1dFamily", "gdm"], "gt8w", 1),
    (["thirst", "urination", "enuresis", "vision"], [], "gt8w", 1),
    (["healing", "skin"], ["infection"], "lt2w", 2),
]

WEIGHTS = [p[3] for p in PROFILES]

# Группы крови и характер питания — справочные и слабые факторы, поэтому
# раздаются случайно. Признаки дисплазии берутся небольшими наборами:
# у большинства детей их нет или один-два, реже набирается значимое число.
BLOOD_POOL = ["unknown", "O", "A", "B", "AB"]
DIET_POOL = ["unknown", "balanced", "balanced", "irregular", "sweets", "fastfood"]
CARBS_POOL = ["unknown", "low", "normal", "normal", "high", "veryHigh"]
DYS_POOL = list(scoring.DYSPLASIA)


def random_extras(rng: random.Random) -> dict:
    """Значения новых групп для одной демонстрационной анкеты."""
    count = rng.choices([0, 1, 2, 3, 4, 6], weights=[5, 4, 3, 2, 1, 1], k=1)[0]
    return {
        "blood": rng.choice(BLOOD_POOL),
        "diet": rng.choice(DIET_POOL),
        "carbs": rng.choice(CARBS_POOL),
        "dysplasia": rng.sample(DYS_POOL, count),
    }


PHENOTYPE_POOL = list(dst.PHENOTYPES)
ANOMALY_POOL = list(dst.ANOMALIES)


def doctor_exam(dysplasia: list[str], rng: random.Random) -> dict:
    """Осмотр врача по полной шкале ДСТ для демонстрационной анкеты.

    Врач видит больше, чем родитель: к пунктам из ответов анкеты добавляются
    признаки, которые находят только на осмотре. Связи с риском диабета здесь
    нет намеренно — демо-данные не должны подсказывать вывод исследования.
    """
    exam = dst.from_parent(dysplasia)
    extra = rng.choices([0, 1, 2, 3, 5, 7], weights=[3, 3, 3, 2, 2, 1], k=1)[0]
    free = [k for k in PHENOTYPE_POOL if k not in exam["phenotypes"]]
    exam["phenotypes"] = exam["phenotypes"] + rng.sample(free, extra)
    for key in exam["complex"]:
        if rng.random() < 0.2:
            exam["complex"][key] = max(exam["complex"][key], rng.choice([3, 5]))
    for key in exam["tests"]:
        if rng.random() < 0.15:
            exam["tests"][key] = True
    anomalies = rng.choices([0, 0, 1, 1, 2], k=1)[0]
    exam["anomalies"] = list(set(exam["anomalies"]) | set(rng.sample(ANOMALY_POOL, anomalies)))
    return dst.normalize(exam)


def anthropometry(age: int, rng: random.Random) -> tuple[float, float]:
    """Примерные рост и вес по возрасту.

    Прежняя формула веса (9 + 4.1 * возраст) давала семилетнему ребёнку 38 кг
    и ИМТ под 27 — модель честно отмечала ожирение почти в каждой анкете.
    Здесь взяты обиходные педиатрические прикидки: до 10 лет 2n+8, дальше 3n.
    """
    height = round(76 + age * 6.2 + rng.uniform(-4, 4), 1)
    base = 2 * age + 8 if age <= 10 else 3 * age + 2
    return height, round(base + rng.uniform(-1, 4), 1)


def seed(count: int = 60, days: int = 200, rng: random.Random | None = None) -> int:
    rng = rng or random.Random(20260907)
    conn = db.get()
    added = 0

    for _ in range(count):
        symptoms, risks, duration, _w = rng.choices(PROFILES, weights=WEIGHTS, k=1)[0]
        age = rng.randint(2, 17)
        sex = rng.choice(["m", "f"])
        height, weight = anthropometry(age, rng)

        extras = random_extras(rng)
        answers = {
            "age": age, "sex": sex, "height": height, "weight": weight,
            "symptoms": list(symptoms), "risks": list(risks),
            "duration": duration, **extras,
        }
        res = scoring.calculate(answers)

        # примерно треть анкет врач уже посмотрел по полной шкале ДСТ
        if rng.random() < 0.35:
            exam, dst_source = doctor_exam(extras["dysplasia"], rng), "doctor"
        else:
            exam, dst_source = dst.from_parent(extras["dysplasia"]), "parent"
        scale = dst.calculate(exam)

        created = (datetime.now(timezone.utc)
                   - timedelta(days=rng.randint(0, days),
                               hours=rng.randint(0, 23))).replace(microsecond=0).isoformat()

        conn.execute(
            """INSERT INTO assessments
               (public_id, created_at, age, sex, height, weight, bmi,
                symptoms, risks, duration,
                diet, carbs, blood_group, dysplasia,
                total, score, level, bmi_code, factors, source, follow_up,
                dst_exam, dst_self_exam, dst_source, dst_index, dst_degree)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (security.public_id(), created, age, sex, height, weight,
             round(res["bmi"], 2),
             json.dumps(answers["symptoms"], ensure_ascii=False),
             json.dumps(answers["risks"], ensure_ascii=False),
             duration,
             extras["diet"], extras["carbs"], extras["blood"],
             json.dumps(extras["dysplasia"], ensure_ascii=False),
             res["total"], res["score"], res["level"], res["bmi_class"]["code"],
             json.dumps(res["found"], ensure_ascii=False),
             "parent",
             1 if res["level"] in ("high", "mod") and rng.random() < 0.45 else 0,
             json.dumps(scale["exam"], ensure_ascii=False),
             json.dumps(dst.from_parent(extras["dysplasia"]), ensure_ascii=False),
             dst_source, scale["index"], scale["degree"]),
        )
        added += 1

    conn.commit()
    return added


# --------------------------------------------------------------------------
# Демонстрационная семья для кабинета пациента
# --------------------------------------------------------------------------

# Для каждого ребёнка — цепочка анкет во времени. Ответы подобраны так, чтобы
# история читалась как реальная: у Тимура выявленный риск снижается после
# обращения к врачу, у Лолы остаётся низким. Балл всё равно считает модель.
FAMILY: tuple[dict, ...] = (
    {
        "name": "Тимур", "sex": "m", "birth_year": 2016,
        "blood": "A", "diet": "irregular", "carbs": "high",
        # у Тимура набор признаков дисплазии значимый — ради этой темы
        # проект и сделан, и в кабинете это должно быть видно
        "dysplasia": ["hypermobility", "flatfoot", "spine", "myopia",
                      "teeth", "asthenic"],
        # на двух последних приёмах врач осмотрел Тимура по полной шкале ДСТ
        "doctor_exam_last": 2,
        "doctor_exam": {
            "phenotypes": ["myopia", "gothicPalate", "malocclusion", "striae",
                           "scoliosis", "flatfoot", "valgusFeet", "posture"],
            "complex": {"skin": 3, "hypotonia": 0, "beighton": 5},
            "tests": {"steinberg": True, "walker": True},
            "anomalies": ["mitralProlapse", "extraChords"],
        },
        "history": [
            # (дней назад, симптомы, факторы, длительность, контроль врача)
            (410, ["thirst", "urination", "fatigue"], ["t1dFamily"], "gt8w", True),
            (300, ["thirst", "fatigue"], ["t1dFamily"], "2to8w", True),
            (185, ["fatigue"], ["t1dFamily"], "lt2w", False),
            (95, [], ["t1dFamily", "lowActivity"], "none", False),
            (21, [], ["t1dFamily"], "none", False),
        ],
    },
    {
        "name": "Лола", "sex": "f", "birth_year": 2019,
        "blood": "O", "diet": "sweets", "carbs": "normal",
        "dysplasia": ["flatfoot"],
        "history": [
            (250, [], ["sugarDrinks"], "none", False),
            (120, ["healing"], ["sugarDrinks", "lowActivity"], "lt2w", False),
            (14, [], ["lowActivity"], "none", False),
        ],
    },
)


def seed_family(rng: random.Random | None = None) -> int:
    """Заводит детей демо-родителя и их историю оценок.

    Повторный запуск ничего не делает: если дети уже есть, выходим.
    Без этого кабинет пациента открывался бы пустым.
    """
    rng = rng or random.Random(20260908)
    conn = db.get()

    parent = db.one("SELECT id FROM parents WHERE email = ?",
                    (config.DEMO_PARENT_EMAIL,))
    if parent is None:
        print("демо-родителя нет — сначала запустите сервер или db.init()")
        return 0
    if db.one("SELECT id FROM children WHERE parent_id = ?", (parent["id"],)):
        print("у демо-родителя уже есть дети — пропускаем")
        return 0

    now = datetime.now(timezone.utc)
    added = 0

    for kid in FAMILY:
        cur = conn.execute(
            "INSERT INTO children (parent_id, name, sex, birth_year, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (parent["id"], kid["name"], kid["sex"], kid["birth_year"],
             now.replace(microsecond=0).isoformat()),
        )
        child_id = cur.lastrowid

        history = kid["history"]
        examined_from = len(history) - kid.get("doctor_exam_last", 0)
        for number, (days_ago, symptoms, risks, duration, follow) in enumerate(history):
            if number >= examined_from:
                exam, dst_source = dst.normalize(kid["doctor_exam"]), "doctor"
            else:
                exam, dst_source = dst.from_parent(kid["dysplasia"]), "parent"
            scale = dst.calculate(exam)
            when = now - timedelta(days=days_ago, hours=rng.randint(0, 23))
            age = max(1, when.year - kid["birth_year"])
            # рост и вес растут вместе с ребёнком, иначе ИМТ скакал бы
            height, weight = anthropometry(age, rng)

            answers = {
                "age": age, "sex": kid["sex"], "height": height, "weight": weight,
                "symptoms": list(symptoms), "risks": list(risks),
                "duration": duration,
                "blood": kid["blood"], "diet": kid["diet"], "carbs": kid["carbs"],
                "dysplasia": list(kid["dysplasia"]),
            }
            res = scoring.calculate(answers)

            conn.execute(
                """INSERT INTO assessments
                   (public_id, created_at, age, sex, height, weight, bmi,
                    symptoms, risks, duration,
                    diet, carbs, blood_group, dysplasia,
                    total, score, level, bmi_code, factors, source, follow_up,
                    parent_id, child_id, dst_exam, dst_self_exam, dst_source,
                    dst_index, dst_degree)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (security.public_id(), when.replace(microsecond=0).isoformat(),
                 age, kid["sex"], height, weight, round(res["bmi"], 2),
                 json.dumps(answers["symptoms"], ensure_ascii=False),
                 json.dumps(answers["risks"], ensure_ascii=False),
                 duration,
                 kid["diet"], kid["carbs"], kid["blood"],
                 json.dumps(kid["dysplasia"], ensure_ascii=False),
                 res["total"], res["score"], res["level"], res["bmi_class"]["code"],
                 json.dumps(res["found"], ensure_ascii=False),
                 "parent", 1 if follow else 0, parent["id"], child_id,
                 json.dumps(scale["exam"], ensure_ascii=False),
                 json.dumps(dst.from_parent(kid["dysplasia"]), ensure_ascii=False),
                 dst_source, scale["index"], scale["degree"]),
            )
            added += 1

    conn.commit()
    return added


if __name__ == "__main__":
    db.init()
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    added = seed(n)
    total = db.one("SELECT COUNT(*) c FROM assessments")["c"]
    by = {r["level"]: r["c"] for r in db.query(
        "SELECT level, COUNT(*) c FROM assessments GROUP BY level")}
    print("добавлено оценок: %d, всего в базе: %d" % (added, total))
    print("по уровням:", by)

    family = seed_family()
    if family:
        print("кабинет пациента: детей %d, их оценок %d" % (len(FAMILY), family))
