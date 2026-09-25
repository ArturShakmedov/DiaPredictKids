# -*- coding: utf-8 -*-
"""Пароли и сессии — без внешних зависимостей.

Пароли: scrypt из стандартной библиотеки, у каждого своя соль.
Сессии: cookie с HMAC-подписью, состояние на сервере не хранится.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time

from . import config

# Параметры scrypt: компромисс между стойкостью и временем ответа.
# 128 * N * r = 32 МБ — ровно дефолтный потолок OpenSSL, поэтому maxmem
# приходится задавать явно, иначе EVP_PBE_scrypt падает.
_N, _R, _P, _DKLEN = 2 ** 15, 8, 1, 32
_MAXMEM = 64 * 1024 * 1024

# Каждый расчёт scrypt занимает 32 МБ. Запросы идут в пуле из 40 потоков,
# и волна входов без ограничения подняла бы память за гигабайт.
_SCRYPT_SLOTS = threading.BoundedSemaphore(2)


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int, dklen: int) -> bytes:
    with _SCRYPT_SLOTS:
        return hashlib.scrypt(password.encode("utf-8"), salt=salt,
                              n=n, r=r, p=p, dklen=dklen, maxmem=_MAXMEM)


def hash_password(password: str) -> str:
    """Возвращает строку вида scrypt$N$r$p$соль$хэш (всё в base64)."""
    salt = secrets.token_bytes(16)
    dk = _scrypt(password, salt, _N, _R, _P, _DKLEN)
    return "scrypt${}${}${}${}${}".format(
        _N, _R, _P,
        base64.b64encode(salt).decode(),
        base64.b64encode(dk).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, hash_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        dk = _scrypt(password, base64.b64decode(salt_b64),
                     int(n), int(r), int(p), len(base64.b64decode(hash_b64)))
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except (ValueError, TypeError):
        return False


# Сверка с этим хешем уравнивает время ответа для несуществующей почты.
# Раньше его считали заново на каждый запрос — это два scrypt вместо одного.
DUMMY_HASH = hash_password("-")


# --------------------------------------------------------------------------
# Сессии
# --------------------------------------------------------------------------

def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _b64d(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: bytes) -> str:
    mac = hmac.new(config.SECRET_KEY.encode(), payload, hashlib.sha256).digest()
    return _b64e(mac)


# У врача и у родителя свои cookie и своё поле в полезной нагрузке.
# Разные cookie позволяют быть вошедшим в оба кабинета одновременно, а разные
# поля не дают подставить токен одной роли вместо другой: читатель ищет
# только своё поле и на чужом токене вернёт None.
_CLINICIAN_FIELD = "cid"
_PARENT_FIELD = "pid"


def _create(field: str, uid: int) -> str:
    payload = json.dumps(
        {field: uid, "exp": int(time.time()) + config.SESSION_TTL_SECONDS},
        separators=(",", ":"),
    ).encode()
    return _b64e(payload) + "." + _sign(payload)


def _read(field: str, token: str | None) -> int | None:
    if not token or "." not in token:
        return None
    body, sig = token.rsplit(".", 1)
    try:
        payload = _b64d(body)
    except Exception:
        return None
    if not hmac.compare_digest(_sign(payload), sig):
        return None
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    if int(data.get("exp", 0)) < time.time():
        return None
    if data.get(field) is None:
        return None
    return int(data[field])


def create_session(clinician_id: int) -> str:
    return _create(_CLINICIAN_FIELD, clinician_id)


def read_session(token: str | None) -> int | None:
    """Возвращает id врача или None, если подпись неверна либо срок вышел."""
    return _read(_CLINICIAN_FIELD, token)


def create_parent_session(parent_id: int) -> str:
    return _create(_PARENT_FIELD, parent_id)


def read_parent_session(token: str | None) -> int | None:
    """То же для родителя: cookie другая, поле в нагрузке тоже."""
    return _read(_PARENT_FIELD, token)


def public_id() -> str:
    """Короткий непредсказуемый идентификатор оценки для ссылки."""
    return secrets.token_urlsafe(9)
