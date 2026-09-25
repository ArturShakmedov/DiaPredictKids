# -*- coding: utf-8 -*-
"""Модель оценки риска — серверная копия той, что считает браузер.

Клиенту нельзя верить: он может прислать любой балл. Поэтому сервер
пересчитывает результат по присланным ответам. Веса и пороги обязаны
совпадать с js/assessment.js — за этим следит tests/test_model_parity.py.
"""
from __future__ import annotations

import math
from typing import Any

# --------------------------------------------------------------------------
# Справочник факторов (зеркало SYMPTOMS / RISKS / DURATION из assessment.js)
# --------------------------------------------------------------------------

SYMPTOMS: dict[str, dict[str, Any]] = {
    "thirst":     {"w": 18, "label": "Сильная жажда", "key": True},
    "urination":  {"w": 16, "label": "Частое мочеиспускание", "key": True},
    "weightLoss": {"w": 16, "label": "Потеря веса", "key": True},
    "enuresis":   {"w": 12, "label": "Ночное недержание", "key": True},
    "fatigue":    {"w": 10, "label": "Утомляемость и вялость"},
    "hunger":     {"w": 8,  "label": "Постоянный голод"},
    "vision":     {"w": 8,  "label": "Нечёткое зрение"},
    "nausea":     {"w": 8,  "label": "Тошнота, боль в животе"},
    "itching":    {"w": 9,  "label": "Упорный зуд кожи или в области промежности"},
    "healing":    {"w": 7,  "label": "Долгое заживление ранок"},
    "skin":       {"w": 6,  "label": "Сухость кожи"},
    "sleepNight": {"w": 5,  "label": "Нарушения ночного сна"},
}

# Семейный анамнез собирается по каждому родителю отдельно: заказчик просил
# различать диабет у отца, матери и сиблингов, а бабушек и дедушек убрать.
# Аутоиммунные болезни родителей перечислены поимённо — все они связаны
# с общей наследственной предрасположенностью к диабету 1 типа.
RISKS: dict[str, dict[str, Any]] = {
    "t1dFather":       {"w": 14, "label": "Сахарный диабет 1 типа у отца"},
    "t1dMother":       {"w": 14, "label": "Сахарный диабет 1 типа у матери"},
    "t1dSibling":      {"w": 14, "label": "Сахарный диабет 1 типа у брата или сестры"},
    "t2dFamily":       {"w": 10, "label": "Диабет 2 типа у родителя, брата или сестры"},
    "acanthosis":      {"w": 10, "label": "Тёмные бархатистые участки кожи"},
    "autoimmuneChild": {"w": 9,  "label": "Аутоиммунное заболевание у ребёнка"},
    "gdm":             {"w": 8,  "label": "Гестационный диабет у матери"},
    "viralInfection":  {"w": 6,  "label": "Перенесённые вирусные инфекции: энтеровирусы, аденовирусы"},
    "hashimoto":       {"w": 5,  "label": "Аутоиммунный тиреоидит (тиреоидит Хашимото) у родителей"},
    "graves":          {"w": 5,  "label": "Болезнь Грейвса у родителей"},
    "vitiligo":        {"w": 5,  "label": "Витилиго у родителей"},
    "celiacParent":    {"w": 5,  "label": "Целиакия у родителей"},
    "rheumatoid":      {"w": 5,  "label": "Ревматоидный артрит у родителей"},
    "addison":         {"w": 5,  "label": "Болезнь Аддисона у родителей"},
    "birthWeight":     {"w": 5,  "label": "Отклонение веса при рождении"},
    "lowActivity":     {"w": 5,  "label": "Низкая физическая активность"},
    "enzymeFamily":    {"w": 5,  "label": "Ферментопатии или нарушения обмена у родителей"},
    "perinatal":       {"w": 4,  "label": "Осложнения беременности или родов"},
    "sugarDrinks":     {"w": 4,  "label": "Сладкие напитки почти каждый день"},
    "familyStress":    {"w": 4,  "label": "Длительная стрессовая обстановка в семье"},
    "infection":       {"w": 3,  "label": "Частые инфекции в последние месяцы"},
    "lowIncome":       {"w": 3,  "label": "Ограниченные материальные возможности семьи"},
}

# Пункты, снятые из анкеты, но встречающиеся в уже сохранённых анкетах.
# Без них старые записи пересчитались бы с потерей части факторов.
RISKS_LEGACY: dict[str, dict[str, Any]] = {
    "t1dFamily":        {"w": 14, "label": "Диабет 1 типа у родителя, брата или сестры"},
    "t1dGrand":         {"w": 7,  "label": "Диабет 1 типа у бабушки или дедушки"},
    "t2dGrand":         {"w": 6,  "label": "Диабет 2 типа у бабушки или дедушки"},
    "autoimmuneFamily": {"w": 5,  "label": "Аутоиммунные заболевания в семье"},
}

ALL_RISKS: dict[str, dict[str, Any]] = {**RISKS, **RISKS_LEGACY}

# Диабет 1 типа у первой линии родства: любой из пунктов закрывает вопрос
T1D_FIRST_LINE = ("t1dFather", "t1dMother", "t1dSibling", "t1dFamily")

# Характер питания — один преобладающий вариант, а не набор галочек.
DIET: dict[str, dict[str, Any]] = {
    "unknown":   {"w": 0, "label": "Характер питания не указан"},
    "balanced":  {"w": 0, "label": "Питание в целом сбалансированное"},
    "irregular": {"w": 4, "label": "Нерегулярное питание, пропуски приёмов пищи"},
    "sweets":    {"w": 5, "label": "Много сладостей и выпечки каждый день"},
    "fastfood":  {"w": 6, "label": "Преобладают фастфуд и готовые продукты"},
}

# Доля углеводов: спрашиваем долями тарелки, точной цифры родитель не знает.
CARBS: dict[str, dict[str, Any]] = {
    "unknown":  {"w": 0, "label": "Долю углеводов оценить не удалось"},
    "low":      {"w": 0, "label": "Углеводы — меньше трети рациона"},
    "normal":   {"w": 0, "label": "Углеводы — около половины рациона"},
    "high":     {"w": 4, "label": "Углеводы — больше половины рациона"},
    "veryHigh": {"w": 7, "label": "Углеводы — основная часть рациона"},
}

# Группа крови собирается как справочная величина для врача. Веса у неё нет:
# связь системы AB0 с риском диабета в исследованиях противоречива.
BLOOD: dict[str, str] = {
    "unknown": "Группа крови не указана",
    "O":       "Группа крови O (I)",
    "A":       "Группа крови A (II)",
    "B":       "Группа крови B (III)",
    "AB":      "Группа крови AB (IV)",
}

# Короткий список признаков дисплазии соединительной ткани для родителя.
# В риск диабета они больше не входят: степень дисплазии считается отдельно,
# по шкале ДСТ (backend/dst.py), чтобы детей с ДСТ и без неё можно было
# сравнивать. Как признаки переводятся в пункты шкалы — dst.PARENT_MAP.
DYSPLASIA: dict[str, dict[str, Any]] = {
    "hypermobility": {"label": "Повышенная подвижность суставов"},
    "skinElastic":   {"label": "Тонкая растяжимая кожа, стрии, атрофические рубцы"},
    "chest":         {"label": "Деформация грудной клетки"},
    "heartValve":    {"label": "Пролапс митрального клапана или малая аномалия сердца"},
    "spine":         {"label": "Сколиоз или выраженное нарушение осанки"},
    "flatfoot":      {"label": "Плоскостопие"},
    "myopia":        {"label": "Близорукость"},
    "teeth":         {"label": "Аномалии прикуса, скученность зубов, высокое нёбо"},
    "asthenic":      {"label": "Астеническое телосложение, длинные тонкие пальцы"},
    "bruising":      {"label": "Лёгкое образование синяков, кровоточивость дёсен"},
    "hernia":        {"label": "Грыжи, варикоз, опущение органов"},
}

DURATION: dict[str, dict[str, Any]] = {
    "none":  {"w": 0, "label": "Симптомов нет"},
    "lt2w":  {"w": 2, "label": "Симптомы менее 2 недель"},
    "2to8w": {"w": 6, "label": "Симптомы от 2 недель до 2 месяцев"},
    "gt8w":  {"w": 9, "label": "Симптомы более 2 месяцев"},
}

# ИМТ: ориентировочные перцентили [p5, p85, p95] по возрасту и полу
BMI_REF: dict[str, dict[int, tuple[float, float, float]]] = {
    "m": {
        2: (14.7, 18.2, 19.3), 3: (14.3, 17.4, 18.3), 4: (14.0, 16.9, 17.8),
        5: (13.8, 16.8, 17.9), 6: (13.7, 17.0, 18.4), 7: (13.7, 17.4, 19.2),
        8: (13.8, 18.0, 20.0), 9: (14.0, 18.6, 21.1), 10: (14.2, 19.4, 22.1),
        11: (14.5, 20.2, 23.2), 12: (15.0, 21.0, 24.2), 13: (15.4, 21.8, 25.1),
        14: (16.0, 22.6, 26.0), 15: (16.5, 23.4, 26.8), 16: (17.1, 24.2, 27.5),
        17: (17.6, 24.9, 28.2),
    },
    "f": {
        2: (14.4, 18.0, 19.1), 3: (14.0, 17.2, 18.3), 4: (13.7, 16.8, 18.0),
        5: (13.5, 16.8, 18.3), 6: (13.4, 17.1, 19.0), 7: (13.4, 17.6, 19.8),
        8: (13.5, 18.3, 20.8), 9: (13.7, 19.1, 21.8), 10: (14.0, 20.0, 22.9),
        11: (14.4, 20.9, 24.0), 12: (14.8, 21.7, 25.0), 13: (15.3, 22.6, 25.9),
        14: (15.8, 23.3, 26.7), 15: (16.3, 24.0, 27.4), 16: (16.7, 24.6, 28.1),
        17: (17.1, 25.2, 28.7),
    },
}

SATURATION = 62.0     # знаменатель насыщающей кривой
THRESHOLD_MOD = 25    # нижняя граница умеренного риска
THRESHOLD_HIGH = 60   # нижняя граница высокого риска
TRIAD_FLOOR = 70      # классическая триада поднимает оценку минимум до
SCORE_CAP = 97


def _js_round(x: float) -> int:
    """JS Math.round округляет .5 вверх, а Python round() — к чётному."""
    return int(math.floor(x + 0.5))


def classify_bmi(bmi: float, age: float, sex: str) -> dict[str, Any]:
    table = BMI_REF.get(sex) or BMI_REF["m"]
    a = min(17, max(2, _js_round(age)))
    ref = table.get(a)

    if not ref:
        return {"code": "unknown", "label": "Нет возрастной нормы", "w": 0,
                "note": "Для этого возраста ориентир не рассчитывается"}
    if bmi < ref[0]:
        return {"code": "under", "label": "Дефицит массы тела", "w": 6,
                "note": "ИМТ ниже возрастного ориентира"}
    if bmi >= ref[2]:
        return {"code": "obese", "label": "Ожирение", "w": 12,
                "note": "ИМТ выше 95-го перцентиля для возраста"}
    if bmi >= ref[1]:
        return {"code": "over", "label": "Избыточная масса тела", "w": 8,
                "note": "ИМТ между 85-м и 95-м перцентилем"}
    return {"code": "normal", "label": "Норма", "w": 0,
            "note": "ИМТ в пределах возрастного ориентира"}


def calculate(data: dict[str, Any]) -> dict[str, Any]:
    """Повторяет calculate() из assessment.js, включая порядок слагаемых."""
    symptoms = list(data.get("symptoms") or [])
    risks = list(data.get("risks") or [])

    found: list[dict[str, Any]] = []
    absent: list[dict[str, str]] = []
    total = 0

    for key, s in SYMPTOMS.items():
        if key in symptoms:
            total += s["w"]
            found.append({"key": key, "label": s["label"], "w": s["w"], "group": "Симптом"})
        elif s.get("key"):
            absent.append({"key": key, "label": s["label"]})

    dur = DURATION.get(data.get("duration"), DURATION["none"])
    if dur["w"] and symptoms:
        total += dur["w"]
        found.append({"key": "duration:" + str(data.get("duration")),
                      "label": dur["label"], "w": dur["w"], "group": "Длительность"})

    for key, r in ALL_RISKS.items():
        if key in risks:
            total += r["w"]
            found.append({"key": key, "label": r["label"], "w": r["w"], "group": "Фактор риска"})

    if not any(k in risks for k in T1D_FIRST_LINE):
        absent.append({"key": "t1dFirstLine",
                       "label": "Диабет 1 типа у ближайших родственников"})
    if "acanthosis" not in risks:
        absent.append({"key": "acanthosis", "label": "Тёмные участки кожи на шее и в складках"})

    # --- характер питания ---
    diet = DIET.get(data.get("diet"), DIET["unknown"])
    if diet["w"]:
        total += diet["w"]
        found.append({"key": "diet:" + str(data.get("diet")),
                      "label": diet["label"], "w": diet["w"], "group": "Питание"})

    # --- доля углеводов ---
    carbs = CARBS.get(data.get("carbs"), CARBS["unknown"])
    if carbs["w"]:
        total += carbs["w"]
        found.append({"key": "carbs:" + str(data.get("carbs")),
                      "label": carbs["label"], "w": carbs["w"], "group": "Питание"})

    # Признаки дисплазии в сумму не входят — их оценивает шкала ДСТ отдельно
    dys = [k for k in DYSPLASIA if k in (data.get("dysplasia") or [])]

    bmi = float(data["weight"]) / (float(data["height"]) / 100.0) ** 2
    bmi_class = classify_bmi(bmi, float(data["age"]), data.get("sex", "m"))
    if bmi_class["w"]:
        total += bmi_class["w"]
        found.append({"key": "bmi:" + bmi_class["code"],
                      "label": "ИМТ: " + bmi_class["label"].lower(),
                      "w": bmi_class["w"], "group": "Антропометрия"})
    elif bmi_class["code"] == "normal":
        absent.append({"key": "bmi", "label": "Отклонение ИМТ от возрастной нормы"})

    score = _js_round(100 * (1 - math.exp(-total / SATURATION)))

    has = lambda k: k in symptoms                                    # noqa: E731
    triad = has("thirst") and has("urination") and (has("weightLoss") or has("enuresis"))
    if triad:
        score = max(score, TRIAD_FLOOR)
    score = min(SCORE_CAP, score)

    level = "low"
    if score >= THRESHOLD_HIGH:
        level = "high"
    elif score >= THRESHOLD_MOD:
        level = "mod"

    found.sort(key=lambda f: f["w"], reverse=True)

    return {
        "bmi": bmi,
        "total": total,
        "score": score,
        "level": level,
        "triad": triad,
        "bmi_class": bmi_class,
        # группа крови баллов не даёт, но врачу её показываем
        "blood": data.get("blood") if data.get("blood") in BLOOD else "unknown",
        "dysplasia_count": len(dys),
        "found": found,
        "absent": absent,
    }
