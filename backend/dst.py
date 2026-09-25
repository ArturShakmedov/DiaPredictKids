# -*- coding: utf-8 -*-
"""Шкала дисплазии соединительной ткани (ДСТ) — как в калькуляторе DST для детей.

Степень дисплазии считается отдельно от риска диабета: заказчик сравнивает
детей с ДСТ и без неё, и если бы признаки дисплазии добавляли баллы к риску,
сравнение групп оказалось бы замкнутым на само себя.

Индекс — сумма баллов фенотипических признаков, признаков с градацией и
признака арахнодактилии. Ассоциированные аномалии органов в индекс не входят:
пороги степеней откалиброваны только под фенотипические признаки. Аномалии
учитываются отдельным числом.

Копия для браузера — frontend/scripts/dst.js, совпадение проверяет
tests/test_model_parity.py.
"""
from __future__ import annotations

from typing import Any

# --------------------------------------------------------------------------
# Справочник (веса — по документу «Новые правила программы» из DST)
# --------------------------------------------------------------------------

PHENOTYPES: dict[str, dict[str, Any]] = {
    "dolichocephaly":    {"w": 3, "label": "Долихоцефалия"},
    "septum":            {"w": 1, "label": "Искривление носовой перегородки"},
    "birdBeak":          {"w": 2, "label": "Птичий клюв"},
    "zygomatic":         {"w": 2, "label": "Скуловая гипоплазия"},
    "blueSclera":        {"w": 4, "label": "Голубые склеры"},
    "telorism":          {"w": 2, "label": "Гипо-/гипертелоризм и/или телекант"},
    "ptosis":            {"w": 2, "label": "Птоз"},
    "myopia":            {"w": 4, "label": "Прогрессирующая миопия (>1 D/год)"},
    "gothicPalate":      {"w": 2, "label": "Высокое / готическое небо"},
    "cleftPalate":       {"w": 4, "label": "Незаращение твёрдого/мягкого неба"},
    "teethEruption":     {"w": 2, "label": "Нарушение сроков и последовательности прорезывания зубов"},
    "bifidUvula":        {"w": 4, "label": "Расщепление язычка"},
    "malocclusion":      {"w": 2, "label": "Неправильный прикус"},
    "softEars":          {"w": 4, "label": "Мягкость хрящевой ткани ушей"},
    "drySkin":           {"w": 3, "label": "Сухая, истончённая или преждевременно морщинистая кожа"},
    "thinSkin":          {"w": 3, "label": "Тонкая ранимая кожа"},
    "scarring":          {"w": 3, "label": "Патологическое рубцевание (атрофические и/или келоидные рубцы)"},
    "vesselFragility":   {"w": 4, "label": "Повышенная ломкость сосудов кожи (лёгкое образование экхимозов/гематом)"},
    "striae":            {"w": 4, "label": "Атрофические стрии, не связанные с ожирением, беременностью или быстрым ростом"},
    "chest":             {"w": 5, "label": "Деформация грудной клетки (воронкообразная или килевидная)"},
    "scoliosis":         {"w": 4, "label": "Сколиоз"},
    "kyphosis":          {"w": 4, "label": "Кифоз / лордоз"},
    "subluxations":      {"w": 5, "label": "Рецидивирующие подвывихи суставов"},
    "brachydactyly":     {"w": 2, "label": "Брахидактилия"},
    "syndactyly":        {"w": 2, "label": "Частичная синдактилия II–III пальцев стопы"},
    "clinodactyly":      {"w": 2, "label": "Клинодактилия"},
    "varicose":          {"w": 4, "label": "Варикозное расширение вен нижних конечностей"},
    "flatfoot":          {"w": 4, "label": "Плоскостопие"},
    "legs":              {"w": 3, "label": "Х-/О-образное искривление ног"},
    "sandalGap":         {"w": 3, "label": "Сандалевидная щель"},
    "halluxValgus":      {"w": 3, "label": "Hallux valgus"},
    "clubfoot":          {"w": 4, "label": "Косолапость"},
    "calluses":          {"w": 1, "label": "Натоптыши"},
    "hair":              {"w": 2, "label": "Структурные аномалии волос (ломкость, истончение)"},
    "nails":             {"w": 2, "label": "Дистрофические изменения ногтей (ломкость, продольная исчерченность, истончение ногтевой пластинки)"},
    "narrowFace":        {"w": 3, "label": "Узкий лицевой скелет"},
    "dolichostenomelia": {"w": 5, "label": "Долихостеномелия"},
    "telangiectasia":    {"w": 4, "label": "Телеангиэктазии"},
    "valgusFeet":        {"w": 3, "label": "Вальгусная установка стоп"},
    "venousNet":         {"w": 3, "label": "Видимая венозная сеть"},
    "chin":              {"w": 2, "label": "Скошенность подбородка"},
    "posture":           {"w": 2, "label": "Асимметрия стояния лопаток, «вялая осанка»"},
    "abdominalHernia":   {"w": 3, "label": "Грыжи передней брюшной стенки и/или диастаз прямых мышц живота"},
    "hypoplasia":        {"w": 4, "label": "Гипоплазия мышечной и/или подкожно-жировой ткани"},
}

# Признаки с градацией: нет — 0, умеренно — 3, выраженно — 5
COMPLEX: dict[str, dict[str, Any]] = {
    "skin": {
        "label": "Повышенная растяжимость кожи (на тыльной поверхности кисти)",
        "options": ({"w": 0, "label": "Нет"},
                    {"w": 3, "label": "Умеренная (<3 см)"},
                    {"w": 5, "label": "Выраженная (≥3 см)"}),
    },
    "hypotonia": {
        "label": "Мышечная гипотония",
        "options": ({"w": 0, "label": "Нет"},
                    {"w": 3, "label": "Умеренная"},
                    {"w": 5, "label": "Выраженная"}),
    },
    "beighton": {
        "label": "Гипермобильность суставов (по Бейтону)",
        "options": ({"w": 0, "label": "Нет (0–3)"},
                    {"w": 3, "label": "Умеренная (4–5)"},
                    {"w": 5, "label": "Выраженная (6–9)"}),
    },
}

# Два теста сами по себе баллов не дают: вместе они — один признак
# арахнодактилии. Оба отрицательны — 0, положителен один — 3, оба — 5.
TESTS: dict[str, dict[str, str]] = {
    "steinberg": {"label": "Симптом Штейнберга (большой палец)",
                  "hint": "Большой палец, зажатый в кулак, выступает за ульнарный край ладони"},
    "walker":    {"label": "Симптом Уокера—Мёрдока (запястье)",
                  "hint": "I и V пальцы перекрываются при охвате запястья противоположной руки"},
}
ARACH_LABEL = "Признаки арахнодактилии"
ARACH = (
    {"w": 0, "label": "оба отрицательны"},
    {"w": 3, "label": "положителен один из двух"},
    {"w": 5, "label": "положительны оба"},
)

# Ассоциированные аномалии: учитываются отдельным числом, в индекс не входят
ANOMALIES: dict[str, dict[str, Any]] = {
    "mitralProlapse":          {"w": 5, "label": "Пролапс митрального клапана"},
    "extraChords":             {"w": 3, "label": "Дополнительные хорды"},
    "arrhythmia":              {"w": 3, "label": "Аритмии"},
    "cardiomyopathy":          {"w": 4, "label": "Кардиомиопатии"},
    "aorticAneurysm":          {"w": 5, "label": "Аневризма аорты"},
    "angiodysplasia":          {"w": 4, "label": "Ангиодисплазии"},
    "asthma":                  {"w": 4, "label": "Бронхиальная астма"},
    "gallbladder":             {"w": 3, "label": "Аномалия желчного пузыря"},
    "biliaryDyskinesia":       {"w": 3, "label": "Дискинезия ЖВП"},
    "gallstones":              {"w": 2, "label": "Желчекаменная болезнь"},
    "gastroduodenitis":        {"w": 2, "label": "Гастродуодениты"},
    "gerd":                    {"w": 4, "label": "Гастроэзофагальный рефлюкс"},
    "diverticula":             {"w": 4, "label": "Дивертикулы"},
    "megacolon":               {"w": 4, "label": "Мегаколон"},
    "dolichosigma":            {"w": 3, "label": "Долихосигма"},
    "gastroAnomaly":           {"w": 3, "label": "Аномалии развития органов пищеварения"},
    "incontinence":            {"w": 3, "label": "Недержание мочи"},
    "ibs":                     {"w": 3, "label": "Синдром раздраженного кишечника"},
    "duplexKidney":            {"w": 3, "label": "Удвоение ЧЛС"},
    "nephroptosis":            {"w": 3, "label": "Нефроптоз"},
    "vesicoureteral":          {"w": 3, "label": "Пузырно-мочеточниковый рефлюкс"},
    "dysmetabolicNephropathy": {"w": 3, "label": "Дисметаболическая нефропатия"},
    "urogenitalAnomaly":       {"w": 3, "label": "Аномалии развития мочеполовой системы"},
    "delayedPuberty":          {"w": 3, "label": "Задержка полового развития"},
    "juvenileBleeding":        {"w": 3, "label": "Ювенильные кровотечения / вялая мошонка"},
    "dysmenorrhea":            {"w": 4, "label": "Дисменорея / грыжи"},
    "uterineHypoplasia":       {"w": 4, "label": "Гипоплазия матки / варикоцеле"},
    "hipDysplasia":            {"w": 4, "label": "Дисплазия тазобедренных суставов"},
    "visceroptosis":           {"w": 4, "label": "Висцероптоз"},
    "hiatalHernia":            {"w": 5, "label": "Грыжа пищеводного отверстия"},
    "duralEctasia":            {"w": 5, "label": "Дуральная эктазия"},
}

# Шкала: 0–15 — недостаточно признаков · 16–25 — I · 26–35 — II · ≥36 — III
DEGREES: tuple[dict[str, Any], ...] = (
    {"max": 15,   "label": "Недостаточно фенотипических признаков"},
    {"max": 25,   "label": "I степень"},
    {"max": 35,   "label": "II степень"},
    {"max": None, "label": "III степень"},
)

HEAVY = 4   # «значимые» признаки — с весом 4–5

# --------------------------------------------------------------------------
# Короткий список родителя -> пункты шкалы ДСТ
# --------------------------------------------------------------------------

# Родитель отмечает 11 понятных признаков, врач — полный осмотр. Чтобы оба
# пути давали степень по одной шкале, каждый признак родителя переведён
# в ближайший пункт осмотра. Это предварительная оценка: гипермобильность
# родитель отмечает, но степень по Бейтону не знает — берём умеренную.
PARENT_MAP: dict[str, dict[str, Any]] = {
    "hypermobility": {"complex": ("beighton", 3)},
    "skinElastic":   {"complex": ("skin", 3)},
    "chest":         {"phenotype": "chest"},
    "heartValve":    {"anomaly": "mitralProlapse"},
    "spine":         {"phenotype": "scoliosis"},
    "flatfoot":      {"phenotype": "flatfoot"},
    "myopia":        {"phenotype": "myopia"},
    "teeth":         {"phenotype": "malocclusion"},
    "asthenic":      {"test": "steinberg"},
    "bruising":      {"phenotype": "vesselFragility"},
    "hernia":        {"phenotype": "abdominalHernia"},
}


def empty_exam() -> dict[str, Any]:
    return {"phenotypes": [], "complex": {k: 0 for k in COMPLEX},
            "tests": {k: False for k in TESTS}, "anomalies": []}


def normalize(exam: dict[str, Any] | None) -> dict[str, Any]:
    """Приводит осмотр к полной форме, отбрасывая неизвестные ключи."""
    exam = exam or {}
    out = empty_exam()
    out["phenotypes"] = [k for k in PHENOTYPES if k in (exam.get("phenotypes") or [])]
    out["anomalies"] = [k for k in ANOMALIES if k in (exam.get("anomalies") or [])]
    allowed = {0, 3, 5}
    for key in COMPLEX:
        value = (exam.get("complex") or {}).get(key, 0)
        out["complex"][key] = value if value in allowed else 0
    for key in TESTS:
        out["tests"][key] = bool((exam.get("tests") or {}).get(key, False))
    return out


def from_parent(dysplasia: list[str] | None) -> dict[str, Any]:
    """Осмотр, собранный из ответов родителя."""
    exam = empty_exam()
    marked = set(dysplasia or [])
    phenotypes: set[str] = set()
    anomalies: set[str] = set()
    for key, target in PARENT_MAP.items():
        if key not in marked:
            continue
        if "phenotype" in target:
            phenotypes.add(target["phenotype"])
        if "anomaly" in target:
            anomalies.add(target["anomaly"])
        if "complex" in target:
            name, weight = target["complex"]
            exam["complex"][name] = max(exam["complex"][name], weight)
        if "test" in target:
            exam["tests"][target["test"]] = True
    exam["phenotypes"] = [k for k in PHENOTYPES if k in phenotypes]
    exam["anomalies"] = [k for k in ANOMALIES if k in anomalies]
    return exam


def arach_score(tests: dict[str, bool]) -> int:
    return ARACH[sum(1 for k in TESTS if tests.get(k))]["w"]


def degree_of(index: int) -> int:
    for i, band in enumerate(DEGREES):
        if band["max"] is None or index <= band["max"]:
            return i
    return len(DEGREES) - 1


def calculate(exam: dict[str, Any] | None) -> dict[str, Any]:
    """Повторяет calculate() из dst.js, включая порядок пунктов."""
    exam = normalize(exam)
    items: list[dict[str, Any]] = []
    index = chosen = heavy = 0

    for key in exam["phenotypes"]:
        w = PHENOTYPES[key]["w"]
        index += w
        chosen += 1
        heavy += 1 if w >= HEAVY else 0
        items.append({"key": key, "label": PHENOTYPES[key]["label"], "w": w})

    for key, c in COMPLEX.items():
        w = exam["complex"][key]
        if w:
            index += w
            chosen += 1
            heavy += 1 if w >= HEAVY else 0
            option = next(o for o in c["options"] if o["w"] == w)
            items.append({"key": key, "label": c["label"], "w": w, "grade": option["label"]})

    aw = arach_score(exam["tests"])
    if aw:
        index += aw
        chosen += 1
        heavy += 1 if aw >= HEAVY else 0
        grade = next(a for a in ARACH if a["w"] == aw)
        items.append({"key": "arachnodactyly", "label": ARACH_LABEL, "w": aw,
                      "grade": grade["label"]})

    anomalies = [{"key": k, "label": ANOMALIES[k]["label"], "w": ANOMALIES[k]["w"]}
                 for k in exam["anomalies"]]
    degree = degree_of(index)
    items.sort(key=lambda i: i["w"], reverse=True)

    return {
        "index": index,
        "chosen": chosen,
        "heavy": heavy,
        "degree": degree,
        "degree_label": DEGREES[degree]["label"],
        "anomalies": len(anomalies),
        "anomaly_points": sum(a["w"] for a in anomalies),
        "items": items,
        "anomaly_items": anomalies,
        "exam": exam,
    }
