# -*- coding: utf-8 -*-
"""Каждая метка фактора, которую может выдать модель, обязана иметь перевод.

Метки попадают в таблицу кабинета и в разбор результата. Перевод их накрывает
обходом текста, а значит текст должен точно совпадать с ключом словаря.
Отдельная ловушка — составные метки вроде «ИМТ: ожирение»: их легко забыть.

Запуск: python tests/test_labels_translated.py
"""
from __future__ import annotations

import io
import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import dst  # noqa: E402
from backend import scoring as model  # noqa: E402

DICT_HARNESS = """
const fs = require('fs');
const noop = () => {};
global.window = {};
global.document = { addEventListener: noop, readyState: 'complete',
  querySelector: () => null, querySelectorAll: () => [], documentElement: {},
  createTreeWalker: () => ({ nextNode: () => null }) };
global.navigator = { language: 'ru' };
global.localStorage = { getItem: () => null, setItem: noop };
global.NodeFilter = { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 };
global.CustomEvent = function () {};
eval(fs.readFileSync('frontend/scripts/i18n.js', 'utf8'));
process.stdout.write(JSON.stringify(global.window.NdstI18n.dict));
"""


def load_dict() -> dict:
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                     encoding="utf-8") as f:
        f.write(DICT_HARNESS)
        path = f.name
    try:
        proc = subprocess.run(["node", path], cwd=ROOT, capture_output=True,
                              text=True, encoding="utf-8")
        if proc.returncode:
            raise RuntimeError("node упал:\n" + proc.stderr[:1500])
        return json.loads(proc.stdout)
    finally:
        Path(path).unlink(missing_ok=True)


def all_labels() -> set[str]:
    """Все метки, которые модель способна положить в found/absent."""
    labels: set[str] = set()

    for s in model.SYMPTOMS.values():
        labels.add(s["label"])
    for r in model.RISKS.values():
        labels.add(r["label"])
    for d in model.DURATION.values():
        if d["w"]:
            labels.add(d["label"])
    for d in model.DYSPLASIA.values():
        labels.add(d["label"])
    for d in model.DIET.values():
        labels.add(d["label"])
    for c in model.CARBS.values():
        labels.add(c["label"])

    # группа крови баллов не даёт, но попадает в справочную строку результата
    labels.update(model.BLOOD.values())

    # Шкала ДСТ: признаки, градации, тесты, аномалии и степени. Справочник
    # лежит в массивах и объектах, которые проверка страниц не разбирает,
    # поэтому все его подписи перечисляются здесь.
    for p in dst.PHENOTYPES.values():
        labels.add(p["label"])
    for c in dst.COMPLEX.values():
        labels.add(c["label"])
        labels.update(o["label"] for o in c["options"])
    for t in dst.TESTS.values():
        labels.update((t["label"], t["hint"]))
    labels.add(dst.ARACH_LABEL)
    labels.update(a["label"] for a in dst.ARACH)
    for a in dst.ANOMALIES.values():
        labels.add(a["label"])
    labels.update(d["label"] for d in dst.DEGREES)

    # составные метки ИМТ — по одной на каждый класс с ненулевым весом
    for bmi in (10, 19, 25, 40):
        c = model.classify_bmi(bmi, 8, "m")
        if c["w"]:
            labels.add("ИМТ: " + c["label"].lower())

    # то, что попадает в «не обнаружено»
    labels.add("Диабет 1 типа у ближайших родственников")
    labels.add("Тёмные участки кожи на шее и в складках")
    labels.add("Отклонение ИМТ от возрастной нормы")

    # латинские названия (Hallux valgus) не переводятся
    return {l for l in labels if any("а" <= ch.lower() <= "я" or ch in "ёЁ" for ch in l)}


def main() -> int:
    d = load_dict()
    labels = all_labels()

    missing = {}
    for lang in ("uz", "en"):
        gaps = sorted(l for l in labels if l not in d[lang])
        if gaps:
            missing[lang] = gaps

    print("проверено меток:", len(labels))
    if missing:
        for lang, gaps in missing.items():
            print("НЕТ ПЕРЕВОДА (%s): %d" % (lang, len(gaps)))
            for g in gaps:
                print("   -", g)
        return 1

    print("все метки переводятся на узбекский и английский")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
