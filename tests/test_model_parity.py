# -*- coding: utf-8 -*-
"""Модель оценки живёт в двух местах: frontend/scripts/assessment.js считает в браузере,
backend/scoring.py пересчитывает на сервере. Тест ловит расхождение между ними.

Запуск: python tests/test_model_parity.py
"""
from __future__ import annotations

import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import dst  # noqa: E402
from backend import scoring as model  # noqa: E402

# Мини-заглушка DOM: модель экспортируется до обращения к документу
JS_HARNESS = r"""
const fs = require('fs');
const noop = () => {};
const el = { addEventListener: noop, querySelectorAll: () => [], querySelector: () => null,
             classList: { toggle: noop, add: noop, remove: noop }, style: {}, dataset: {},
             setAttribute: noop, textContent: '', innerHTML: '', value: '', hidden: false };
global.window = {};
global.document = {
  addEventListener: noop, readyState: 'complete',
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => el, documentElement: el, body: el,
};
global.navigator = { language: 'ru' };
eval(fs.readFileSync('frontend/scripts/dst.js', 'utf8'));
eval(fs.readFileSync('frontend/scripts/assessment.js', 'utf8'));

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const M = global.window.NdstModel;
const S = global.window.NdstDst;

const scaleOut = (s) => ({ index: s.index, chosen: s.chosen, heavy: s.heavy,
  degree: s.degree, label: s.degreeLabel, anomalies: s.anomalies,
  anomalyPoints: s.anomalyPoints, items: s.items.map((i) => i.key + ':' + i.w),
  exam: s.exam });

const cases = input.cases.map((c) => {
  const bmi = c.weight / Math.pow(c.height / 100, 2);
  const r = M.calculate(Object.assign({}, c, { bmi }));
  return { score: r.score, level: r.level.key, total: r.total,
           found: r.found.length, absent: r.absent.length,
           blood: r.blood, dysCount: r.dysplasiaCount,
           // степень ДСТ по ответам родителя — тем же путём, что и на сервере
           parentScale: scaleOut(S.calculate(S.fromParent(c.dysplasia))) };
});
const exams = input.exams.map((e) => scaleOut(S.calculate(e)));
process.stdout.write(JSON.stringify({ cases: cases, exams: exams }));
"""


def make_cases(n: int = 400) -> list[dict]:
    rng = random.Random(20260907)
    sym = list(model.SYMPTOMS)
    rsk = list(model.RISKS)
    dur = list(model.DURATION)
    dys = list(model.DYSPLASIA)
    diet = list(model.DIET)
    carbs = list(model.CARBS)
    blood = list(model.BLOOD)
    cases = []
    for _ in range(n):
        cases.append({
            "age": rng.randint(1, 17),
            "sex": rng.choice(["m", "f"]),
            "height": round(rng.uniform(70, 190), 1),
            "weight": round(rng.uniform(8, 110), 1),
            "symptoms": rng.sample(sym, rng.randint(0, len(sym))),
            "risks": rng.sample(rsk, rng.randint(0, len(rsk))),
            "duration": rng.choice(dur),
            # набор признаков дисплазии важен по числу, поэтому берём
            # случайную выборку любой длины — от нуля до полного набора
            "dysplasia": rng.sample(dys, rng.randint(0, len(dys))),
            "diet": rng.choice(diet),
            "carbs": rng.choice(carbs),
            "blood": rng.choice(blood),
        })
    # краевые случаи поверх случайных
    cases += [
        # пусто: ни одного признака
        {"age": 1, "sex": "m", "height": 75, "weight": 9, "symptoms": [],
         "risks": [], "duration": "none", "dysplasia": [],
         "diet": "balanced", "carbs": "normal", "blood": "unknown"},
        # всё сразу: верхняя граница шкалы
        {"age": 17, "sex": "f", "height": 170, "weight": 90,
         "symptoms": list(model.SYMPTOMS), "risks": list(model.RISKS),
         "duration": "gt8w",
         "dysplasia": list(model.DYSPLASIA), "diet": "fastfood",
         "carbs": "veryHigh", "blood": "AB"},
        # классическая триада
        {"age": 8, "sex": "m", "height": 130, "weight": 27,
         "symptoms": ["thirst", "urination", "weightLoss"], "risks": [],
         "duration": "lt2w", "dysplasia": [],
         "diet": "unknown", "carbs": "unknown", "blood": "unknown"},
        # признаки родителя, которые сходятся в один пункт шкалы
        # (гипермобильность -> градация по Бейтону) и дают аномалию органа
        {"age": 12, "sex": "f", "height": 150, "weight": 40, "symptoms": [],
         "risks": [], "duration": "none",
         "dysplasia": ["hypermobility", "heartValve", "asthenic"],
         "diet": "balanced", "carbs": "normal", "blood": "O"},
        # весь короткий список родителя — верхняя граница предварительной степени
        {"age": 12, "sex": "f", "height": 150, "weight": 40, "symptoms": [],
         "risks": [], "duration": "none",
         "dysplasia": list(model.DYSPLASIA),
         "diet": "balanced", "carbs": "normal", "blood": "O"},
        # неизвестный признак дисплазии не должен ничего добавлять
        {"age": 12, "sex": "f", "height": 150, "weight": 40, "symptoms": [],
         "risks": [], "duration": "none",
         "dysplasia": ["flatfoot", "unknownSign"],
         "diet": "balanced", "carbs": "normal", "blood": "O"},
        # поля вообще не переданы — старые записи не должны ломать расчёт
        {"age": 9, "sex": "m", "height": 134, "weight": 30,
         "symptoms": ["fatigue"], "risks": ["t2dFamily"],
         "duration": "lt2w"},
    ]
    return cases


def exam_with_index(target: int) -> dict:
    """Осмотр ровно на заданном индексе — для проверки порогов степеней."""
    exam = dst.empty_exam()
    left = target
    for key, p in sorted(dst.PHENOTYPES.items(), key=lambda kv: -kv[1]["w"]):
        if p["w"] <= left:
            exam["phenotypes"].append(key)
            left -= p["w"]
        if not left:
            break
    assert not left, "индекс %d не набрать" % target
    return exam


def make_exams(n: int = 300) -> list[dict]:
    """Осмотры врача по полной шкале: случайные и точно на порогах."""
    rng = random.Random(20260914)
    phenotypes = list(dst.PHENOTYPES)
    anomalies = list(dst.ANOMALIES)
    exams: list[dict] = []
    for _ in range(n):
        exams.append({
            "phenotypes": rng.sample(phenotypes, rng.randint(0, len(phenotypes))),
            "complex": {k: rng.choice([0, 3, 5]) for k in dst.COMPLEX},
            "tests": {k: rng.random() < 0.4 for k in dst.TESTS},
            "anomalies": rng.sample(anomalies, rng.randint(0, 6)),
        })
    # пороги шкалы: 15/16 — I степень, 25/26 — II, 35/36 — III
    exams += [exam_with_index(i) for i in (0, 15, 16, 25, 26, 35, 36)]
    exams += [
        # один положительный тест — 3 балла, оба — 5
        {"tests": {"steinberg": True}},
        {"tests": {"steinberg": True, "walker": True}},
        # только аномалии: в индекс не входят
        {"anomalies": ["mitralProlapse", "duralEctasia"]},
        # мусор в осмотре отбрасывается одинаково
        {"phenotypes": ["chest", "nope"], "complex": {"skin": 4, "beighton": 5},
         "anomalies": ["nope"]},
        {},
    ]
    return exams


def run_js(cases: list[dict], exams: list[dict]) -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False,
                                     encoding="utf-8") as f:
        json.dump({"cases": cases, "exams": exams}, f, ensure_ascii=False)
        cases_path = f.name
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                     encoding="utf-8") as f:
        f.write(JS_HARNESS)
        harness = f.name
    try:
        proc = subprocess.run(["node", harness, cases_path], cwd=ROOT,
                              capture_output=True, text=True, encoding="utf-8")
        if proc.returncode:
            raise RuntimeError("node упал:\n" + proc.stderr[:2000])
        return json.loads(proc.stdout)
    finally:
        Path(cases_path).unlink(missing_ok=True)
        Path(harness).unlink(missing_ok=True)


def scale_out(s: dict) -> dict:
    return {"index": s["index"], "chosen": s["chosen"], "heavy": s["heavy"],
            "degree": s["degree"], "label": s["degree_label"],
            "anomalies": s["anomalies"], "anomalyPoints": s["anomaly_points"],
            "items": ["%s:%d" % (i["key"], i["w"]) for i in s["items"]],
            "exam": s["exam"]}


def check_thresholds() -> list[str]:
    """Пороги шкалы ДСТ сверяются с документом DST, а не только между копиями."""
    expected = {0: 0, 15: 0, 16: 1, 25: 1, 26: 2, 35: 2, 36: 3, 80: 3}
    errors = ["индекс %d -> степень %d, а должна быть %d" % (i, dst.degree_of(i), d)
              for i, d in expected.items() if dst.degree_of(i) != d]
    arach = {(False, False): 0, (True, False): 3, (False, True): 3, (True, True): 5}
    errors += ["арахнодактилия %s -> %d, а должно быть %d" % (t, dst.arach_score(
               {"steinberg": t[0], "walker": t[1]}), w)
               for t, w in arach.items()
               if dst.arach_score({"steinberg": t[0], "walker": t[1]}) != w]
    only_anomalies = dst.calculate({"anomalies": list(dst.ANOMALIES)})
    if only_anomalies["index"] != 0:
        errors.append("аномалии органов попали в индекс ДСТ")
    return errors


def main() -> int:
    cases = make_cases()
    exams = make_exams()
    js = run_js(cases, exams)

    mismatches = []
    for i, (c, j) in enumerate(zip(cases, js["cases"])):
        p = model.calculate(c)
        got = {"score": p["score"], "level": p["level"], "total": p["total"],
               "found": len(p["found"]), "absent": len(p["absent"]),
               "blood": p["blood"], "dysCount": p["dysplasia_count"],
               "parentScale": scale_out(dst.calculate(dst.from_parent(c.get("dysplasia"))))}
        if got != j:
            mismatches.append(("анкета %d" % i, c, j, got))

    for i, (e, j) in enumerate(zip(exams, js["exams"])):
        got = scale_out(dst.calculate(e))
        if got != j:
            mismatches.append(("осмотр ДСТ %d" % i, e, j, got))

    # Признаки дисплазии больше не двигают риск диабета: одна и та же анкета
    # с полным набором признаков и без них даёт одинаковый балл.
    base = dict(cases[0], dysplasia=[])
    loaded = dict(cases[0], dysplasia=list(model.DYSPLASIA))
    independence = model.calculate(base)["score"] == model.calculate(loaded)["score"]

    threshold_errors = check_thresholds()

    print("сверено анкет:", len(cases), "· осмотров по шкале ДСТ:", len(exams))
    failed = False
    if mismatches:
        failed = True
        print("РАСХОЖДЕНИЙ:", len(mismatches))
        for name, c, j, got in mismatches[:5]:
            print("  ", name)
            print("    вход :", json.dumps(c, ensure_ascii=False))
            print("    js   :", j)
            print("    py   :", got)
    if not independence:
        failed = True
        print("ОШИБКА: признаки дисплазии меняют риск диабета")
    for err in threshold_errors:
        failed = True
        print("ОШИБКА ШКАЛЫ ДСТ:", err)
    if failed:
        return 1

    print("расхождений нет: браузер и сервер считают одинаково,"
          " пороги ДСТ совпадают с документом")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
