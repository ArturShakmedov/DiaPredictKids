# -*- coding: utf-8 -*-
"""PDF-сводка оценки — тот же файл, что даёт печать браузера.

Сервер открывает страницу результата в браузере без окна и сохраняет её
в PDF встроенной печатью. Правила печати берутся из того же assessment.css,
поэтому скачанный файл совпадает с «Распечатать сводку → Сохранить как PDF».

Почему не библиотека, собирающая PDF сама: пришлось бы заново сверстать
сводку вторым способом, и две вёрстки неизбежно разошлись бы. А библиотеки,
рисующие PDF в браузере, превращают страницу в картинку — текст в таком
файле не выделить и не найти.

Нужен установленный Chromium-браузер: Edge, Chrome или Chromium. Путь можно
задать явно переменной NDST_BROWSER.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from . import config

# Каждый запуск — отдельный браузер на 200–400 МБ, а сайт открыт наружу.
# На маленьком тарифе хостинга два браузера сразу уже рискуют упереться в память.
_SLOTS = threading.BoundedSemaphore(max(1, int(os.getenv("NDST_PDF_SLOTS", "1"))))

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

_KNOWN_PATHS = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
)


class PdfUnavailable(RuntimeError):
    """На сервере нет подходящего браузера."""


class PdfBusy(RuntimeError):
    """Все слоты заняты другими запросами."""


class PdfFailed(RuntimeError):
    """Браузер не справился или вернул пустой файл."""


def find_browser() -> str | None:
    explicit = os.getenv("NDST_BROWSER")
    if explicit and Path(explicit).exists():
        return explicit
    for name in ("msedge", "chrome", "chromium", "chromium-browser", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    for path in _KNOWN_PATHS:
        if Path(path).exists():
            return path
    return None


def summary_url(payload: dict) -> str:
    """Адрес страницы в режиме печати: ответы лежат в параметре print."""
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    token = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return "http://127.0.0.1:%d/assessment?print=%s" % (config.PORT, token)


def render_summary(payload: dict, timeout: float = 60) -> bytes:
    browser = find_browser()
    if not browser:
        raise PdfUnavailable("не найден Edge, Chrome или Chromium")

    if not _SLOTS.acquire(timeout=20):
        raise PdfBusy("все слоты заняты")
    # Свой профиль на каждый запуск: у общего профиля браузер держит
    # блокировку, и параллельные запуски молча не создавали бы файл.
    work = Path(tempfile.mkdtemp(prefix="ndst-pdf-"))
    try:
        out = work / "svodka.pdf"
        command = [
            browser, "--headless=new", "--disable-gpu", "--disable-extensions",
            "--no-first-run", "--no-default-browser-check",
            "--user-data-dir=" + str(work / "profile"),
            "--run-all-compositor-stages-before-draw",
            "--no-pdf-header-footer",
            "--virtual-time-budget=10000",
            "--print-to-pdf=" + str(out),
            summary_url(payload),
        ]
        try:
            subprocess.run(command, timeout=timeout, capture_output=True,
                           stdin=subprocess.DEVNULL, creationflags=_NO_WINDOW)
        except subprocess.TimeoutExpired as exc:
            raise PdfFailed("браузер не уложился в %d с" % timeout) from exc

        if not out.exists() or out.stat().st_size < 2000:
            raise PdfFailed("браузер вернул пустой файл")
        return out.read_bytes()
    finally:
        _SLOTS.release()
        # вспомогательные процессы браузера могут ещё держать файлы профиля
        shutil.rmtree(work, ignore_errors=True)
