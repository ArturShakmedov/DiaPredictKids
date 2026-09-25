# -*- coding: utf-8 -*-
"""Каждая русская строка интерфейса обязана иметь перевод на uz и en.

Движок i18n переводит текстовые узлы, переводимые атрибуты и то, что явно
прогнали через t(). Ключом служит сам русский текст, поэтому забытая строка
не ломается — она просто молча остаётся русской на других языках. Этот тест
и ловит такие случаи.

Что проверяется:
  * текст и атрибуты placeholder/aria-label/title/alt во всех страницах,
    включая <title> и meta description; блоки с data-no-i18n пропускаются;
  * все строковые литералы в скриптах, включая склеенные из нескольких
    кусков: текст нередко кладут в переменную и только потом отдают в t(),
    поэтому проверять одни лишь аргументы t() недостаточно.

Формы числа и месяцы сюда не входят: их переводят plural() и months(),
у которых свои таблицы.

Запуск: python tests/test_pages_translated.py
"""
from __future__ import annotations

import io
import json
import re
import subprocess
import sys
import tempfile
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

ATTRS = ('placeholder', 'aria-label', 'title', 'alt')
SKIP_TAGS = {'script', 'style', 'textarea', 'code'}
VOID_TAGS = {'meta', 'link', 'br', 'img', 'input', 'hr', 'source', 'path'}

CYRILLIC = re.compile('[А-Яа-яЁё]')

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
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                     encoding='utf-8') as f:
        f.write(DICT_HARNESS)
        path = f.name
    try:
        proc = subprocess.run(['node', path], cwd=ROOT, capture_output=True,
                              text=True, encoding='utf-8')
        if proc.returncode:
            raise RuntimeError('node упал:\n' + proc.stderr[:1500])
        return json.loads(proc.stdout)
    finally:
        Path(path).unlink(missing_ok=True)


def norm(text: str) -> str:
    return re.sub(r'\s+', ' ', text).strip()


# --------------------------------------------------------------------------
# Разметка
# --------------------------------------------------------------------------

class PageText(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.found: list[str] = []
        self.stack: list[str] = []
        self.muted = 0                     # глубина внутри data-no-i18n

    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        for key, value in attrs:
            if key in ATTRS and value and norm(value):
                self.found.append(norm(value))
        if tag == 'meta' and d.get('name') == 'description' and d.get('content'):
            self.found.append(norm(d['content']))
        if tag not in VOID_TAGS:
            self.stack.append(tag)
            if 'data-no-i18n' in d or self.muted:
                self.muted += 1

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.stack and self.stack[-1] == tag:
            self.stack.pop()
            if self.muted:
                self.muted -= 1

    def handle_data(self, data):
        if self.muted or (self.stack and self.stack[-1] in SKIP_TAGS):
            return
        if norm(data):
            self.found.append(norm(data))


# --------------------------------------------------------------------------
# Скрипты
# --------------------------------------------------------------------------

def strip_comments(src: str) -> str:
    """Убирает комментарии, не трогая содержимое строк."""
    out: list[str] = []
    i, n = 0, len(src)
    quote = None
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(src[i + 1])
                i += 2
                continue
            if c == quote:
                quote = None
            i += 1
            continue
        if c in '"\'':
            quote = c
            out.append(c)
            i += 1
            continue
        if src.startswith('//', i):
            i = src.find('\n', i)
            if i < 0:
                break
            continue
        if src.startswith('/*', i):
            end = src.find('*/', i + 2)
            i = n if end < 0 else end + 2
            out.append(' ')
            continue
        out.append(c)
        i += 1
    return ''.join(out)


JOIN = re.compile(r"'((?:[^'\\\n]|\\.)*)'\s*\+\s*'((?:[^'\\\n]|\\.)*)'")
LITERAL = re.compile(r"'((?:[^'\\\n]|\\.)*)'")
DYNAMIC_TAIL = re.compile(r"\s*\+\s*(?!')")
# Массивы строк в этом коде — только формы числа для plural() и запасные
# названия месяцев. Их переводят отдельные таблицы движка, а не словарь.
ARRAY = re.compile(r"\[[^\[\]]*\]")
TAG = re.compile(r"<[^<>]*>")


def script_strings(src: str) -> list[str]:
    """Все строковые литералы скрипта, кроме заведомо непереводимых.

    Берём именно все, а не только аргументы t(): текст, положенный в
    переменную (скажем, через тернарный оператор), в t() всё равно попадёт,
    а прежняя проверка его не видела.
    """
    src = strip_comments(src)

    # 'часть один ' + 'часть два' -> один литерал; повторяем, пока склеивается
    while True:
        joined = JOIN.sub(lambda m: "'" + m.group(1) + m.group(2) + "'", src)
        if joined == src:
            break
        src = joined

    # содержимое массивов вырезаем: там формы числа и названия месяцев
    src = ARRAY.sub('[]', src)

    found = []
    for m in LITERAL.finditer(src):
        # Литерал, к которому прибавляют переменную, ключом не бывает:
        # строка складывается во время работы ('ИМТ: ' + класс ИМТ).
        # Такие составные подписи проверяет test_labels_translated.py.
        if DYNAMIC_TAIL.match(src, m.end()):
            continue
        found += text_parts(m.group(1).replace("\\'", "'"))
    return [norm(s) for s in found if norm(s)]


def text_parts(literal: str) -> list[str]:
    """Куски текста литерала, которые движок увидит как текстовые узлы.

    Шаблоны собираются из разметки, и ключом словаря служит текст внутри
    тегов, а не фрагмент целиком. Поэтому теги вырезаем, а текст между
    ними проверяем по отдельности — ровно как это делает apply().
    """
    if '<' not in literal:
        return [literal]
    return TAG.split(literal)


# --------------------------------------------------------------------------

def collect() -> dict[str, str]:
    """Русская строка -> файл, где она впервые встретилась."""
    strings: dict[str, str] = {}

    for page in sorted((ROOT / 'frontend' / 'pages').glob('*.html')):
        parser = PageText()
        parser.feed(io.open(page, encoding='utf-8').read())
        for s in parser.found:
            if CYRILLIC.search(s):
                strings.setdefault(s, page.name)

    for js in sorted((ROOT / 'frontend' / 'scripts').glob('*.js')):
        if js.name == 'i18n.js':          # сам словарь проверять незачем
            continue
        for s in script_strings(io.open(js, encoding='utf-8').read()):
            if CYRILLIC.search(s):
                strings.setdefault(s, js.name)

    return strings


KEY_LINE = re.compile(r"^    ('(?:[^'\\]|\\.)*')\s*:", re.M)
DICT_BLOCK = re.compile(r"Object\.assign\(D\.(uz|en), \{(.*?)\n  \}\);", re.S)


def duplicate_keys() -> dict[str, list[str]]:
    """Ключи, объявленные в словаре дважды.

    Object.assign молча оставляет последнее значение, поэтому повтор ничего
    не ломает — он просто тихо перетирает более ранний перевод, и заметить
    это можно только так.
    """
    src = io.open(ROOT / 'frontend' / 'scripts' / 'i18n.js', encoding='utf-8').read()
    found: dict[str, list[str]] = {}
    for lang, body in DICT_BLOCK.findall(src):
        keys = KEY_LINE.findall(body)
        dupes = sorted({k for k in keys if keys.count(k) > 1})
        if dupes:
            found.setdefault(lang, []).extend(dupes)
    return found


def main() -> int:
    table = load_dict()
    strings = collect()
    dupes = duplicate_keys()

    gaps: dict[str, list[tuple[str, str]]] = {}
    for text, source in strings.items():
        for lang in ('uz', 'en'):
            if text not in table[lang]:
                gaps.setdefault(lang, []).append((source, text))

    print('проверено строк интерфейса:', len(strings))
    if dupes:
        for lang, keys in dupes.items():
            print('ПОВТОРЫ КЛЮЧЕЙ (%s): %d' % (lang, len(keys)))
            for k in keys:
                print('   ', k)
    if gaps or dupes:
        for lang, items in gaps.items():
            print('НЕТ ПЕРЕВОДА (%s): %d' % (lang, len(items)))
            for source, text in sorted(items):
                print('   [%s] %s' % (source, text))
        return 1

    print('все строки страниц и скриптов переводятся на узбекский и английский')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
