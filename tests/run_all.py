# -*- coding: utf-8 -*-
"""Прогоняет все проверки разом: python tests/run_all.py

Отдельного фреймворка в проекте нет — каждая проверка это обычный скрипт,
возвращающий 0 или 1. Этот файл просто запускает их по очереди и печатает
итог, чтобы не приходилось помнить три команды.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

CHECKS = (
    ('модель: браузер против сервера', 'test_model_parity.py'),
    ('переводы: метки модели',         'test_labels_translated.py'),
    ('переводы: страницы и скрипты',   'test_pages_translated.py'),
    ('API: роли, анкеты, осмотр, выгрузки', 'test_api.py'),
)


def main() -> int:
    failed = []
    for title, script in CHECKS:
        print('\n=== ' + title)
        proc = subprocess.run([sys.executable, str(ROOT / 'tests' / script)],
                              cwd=ROOT)
        if proc.returncode:
            failed.append(title)

    print('\n' + '-' * 60)
    if failed:
        print('НЕ ПРОШЛИ: ' + ', '.join(failed))
        return 1
    print('все проверки пройдены (%d из %d)' % (len(CHECKS), len(CHECKS)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
