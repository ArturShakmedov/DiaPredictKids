# -*- coding: utf-8 -*-
"""Настройки приложения.

Всё читается из переменных окружения, чтобы секреты не лежали в коде.
Значения по умолчанию рассчитаны на локальную разработку.
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent      # корень проекта
FRONTEND_DIR = BASE_DIR / "frontend"
PAGES_DIR = FRONTEND_DIR / "pages"
DATA_DIR = Path(os.getenv("NDST_DATA_DIR", BASE_DIR / "data"))
DB_PATH = Path(os.getenv("NDST_DB", DATA_DIR / "ndst.db"))

# Railway и похожие хостинги передают порт в PORT и ждут сервер на 0.0.0.0
_PLATFORM_PORT = os.getenv("PORT")
HOST = os.getenv("NDST_HOST", "0.0.0.0" if _PLATFORM_PORT else "127.0.0.1")
PORT = int(os.getenv("NDST_PORT", _PLATFORM_PORT or 8080))
BEHIND_PROXY = bool(_PLATFORM_PORT)


def _session_secret() -> tuple[str, bool]:
    """Ключ подписи cookie: из окружения, иначе из файла рядом с базой.

    Файл создаётся при первом запуске, поэтому сессии переживают перезапуск
    и деплой, если папка данных постоянная. Второе значение — ключ временный.
    """
    env = os.getenv("NDST_SECRET")
    if env:
        return env, False
    path = DATA_DIR / "session_secret.txt"
    try:
        if path.exists():
            saved = path.read_text(encoding="utf-8").strip()
            if saved:
                return saved, False
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        fresh = secrets.token_hex(32)
        path.write_text(fresh, encoding="utf-8")
        return fresh, False
    except OSError:
        return secrets.token_hex(32), True


SECRET_KEY, SECRET_IS_EPHEMERAL = _session_secret()

SESSION_COOKIE = "ndst_session"          # врач
PARENT_COOKIE = "ndst_parent"            # родитель
SESSION_TTL_SECONDS = int(os.getenv("NDST_SESSION_TTL", 60 * 60 * 12))  # 12 часов

# Отдавать cookie только по https. Хостинг с PORT отдаёт сайт по https,
# поэтому там это включено по умолчанию.
COOKIE_SECURE = os.getenv("NDST_COOKIE_SECURE", "1" if BEHIND_PROXY else "0") == "1"

# Код приглашения клиники: без него врач не зарегистрируется. Задаётся
# через NDST_CLINIC_CODE, иначе создаётся при первом запуске и лежит
# в data/clinic_code.txt — его выдают врачу вместе с адресом сайта.
CLINIC_CODE_FILE = DATA_DIR / "clinic_code.txt"


def clinic_code_from_env() -> bool:
    """Код задан переменной окружения — из кабинета его менять нельзя."""
    return bool(os.getenv("NDST_CLINIC_CODE"))


def make_clinic_code() -> str:
    return "NDST-%s-%s" % (secrets.token_hex(2).upper(), secrets.token_hex(2).upper())


def set_clinic_code(code: str) -> str:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CLINIC_CODE_FILE.write_text(code.strip(), encoding="utf-8")
    return code.strip()


def clinic_code() -> str:
    code = os.getenv("NDST_CLINIC_CODE")
    if code:
        return code.strip()
    if CLINIC_CODE_FILE.exists():
        return CLINIC_CODE_FILE.read_text(encoding="utf-8").strip()
    return set_clinic_code(make_clinic_code())


# Демонстрационная учётка врача — создаётся при первом запуске пустой базы
DEMO_EMAIL = os.getenv("NDST_DEMO_EMAIL", "demo@ndst.app")
DEMO_PASSWORD = os.getenv("NDST_DEMO_PASSWORD", "demo12345")
DEMO_NAME = os.getenv("NDST_DEMO_NAME", "Е. Ковалёва")
SEED_DEMO = os.getenv("NDST_SEED_DEMO", "1") == "1"

# Демонстрационная учётка родителя — тоже при первом запуске пустой базы
DEMO_PARENT_EMAIL = os.getenv("NDST_DEMO_PARENT_EMAIL", "parent@ndst.app")
DEMO_PARENT_PASSWORD = os.getenv("NDST_DEMO_PARENT_PASSWORD", "parent12345")
DEMO_PARENT_NAME = os.getenv("NDST_DEMO_PARENT_NAME", "Анна Петрова")

# Статика фронтенда: публичный адрес -> папка с файлами.
# Адреса совпадают с именами папок, чтобы структуру было видно по ссылке.
STATIC_MOUNTS = {
    "/styles": FRONTEND_DIR / "styles",
    "/scripts": FRONTEND_DIR / "scripts",
    "/assets": FRONTEND_DIR / "assets",
}
