# -*- coding: utf-8 -*-
"""Ограничение попыток входа.

Счётчик живёт в памяти процесса: для одного узла этого достаточно.
При нескольких воркерах понадобится общее хранилище — тогда меняется
только реализация, вызовы остаются прежними.
"""
from __future__ import annotations

import time

WINDOW = 300.0        # окно наблюдения, секунды
MAX_ATTEMPTS = 5      # неудач подряд, после которых просим подождать
_SWEEP_EVERY = 1000   # раз во столько записей выбрасываем устаревшие ключи

_ATTEMPTS: dict[str, list[float]] = {}
_writes = 0


def _fresh(key: str, now: float) -> list[float]:
    return [t for t in _ATTEMPTS.get(key, ()) if now - t < WINDOW]


def too_many(key: str) -> bool:
    # Только чтение: раньше каждая проверка заводила ключ навсегда,
    # и перебор почт понемногу съедал память процесса.
    return len(_fresh(key, time.time())) >= MAX_ATTEMPTS


def remember_failure(key: str) -> None:
    global _writes
    now = time.time()
    _ATTEMPTS[key] = _fresh(key, now) + [now]
    _writes += 1
    if _writes % _SWEEP_EVERY == 0:
        for k in [k for k, v in _ATTEMPTS.items() if not v or now - v[-1] >= WINDOW]:
            del _ATTEMPTS[k]


def reset(key: str) -> None:
    _ATTEMPTS.pop(key, None)


def key_for(request, email: str) -> str:
    """Связка IP и почты: один адрес не блокирует чужие учётные записи."""
    ip = request.client.host if request.client else "?"
    return ip + "|" + email
