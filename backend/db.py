# -*- coding: utf-8 -*-
"""SQLite без ORM: схема, соединение, первичное наполнение."""
from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Iterable

from . import config, security

SCHEMA = """
CREATE TABLE IF NOT EXISTS clinicians (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'pediatrician',
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS assessments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    public_id     TEXT    NOT NULL UNIQUE,
    created_at    TEXT    NOT NULL,

    -- анкета; имя ребёнка не собираем принципиально
    age           INTEGER NOT NULL,
    sex           TEXT    NOT NULL,
    height        REAL    NOT NULL,
    weight        REAL    NOT NULL,
    bmi           REAL    NOT NULL,
    symptoms      TEXT    NOT NULL DEFAULT '[]',
    risks         TEXT    NOT NULL DEFAULT '[]',
    -- колонка осталась от снятого блока неотложных признаков
    urgent        TEXT    NOT NULL DEFAULT '[]',
    duration      TEXT    NOT NULL DEFAULT 'none',

    -- характер питания, доля углеводов и признаки дисплазии
    -- соединительной ткани; группа крови баллов не даёт и хранится
    -- как справочная величина для врача
    diet          TEXT    NOT NULL DEFAULT 'unknown',
    carbs         TEXT    NOT NULL DEFAULT 'unknown',
    blood_group   TEXT    NOT NULL DEFAULT 'unknown',
    dysplasia     TEXT    NOT NULL DEFAULT '[]',

    -- результат, пересчитанный на сервере
    total         INTEGER NOT NULL,
    score         INTEGER NOT NULL,
    level         TEXT    NOT NULL,
    bmi_code      TEXT    NOT NULL,
    factors       TEXT    NOT NULL DEFAULT '[]',

    -- степень дисплазии по шкале ДСТ, отдельно от риска диабета:
    -- осмотр врача или предварительно — из ответов родителя
    dst_exam      TEXT    NOT NULL DEFAULT '{}',
    -- что отметил родитель: осмотр врача переносится на новые анкеты
    -- ребёнка, и к этим ответам можно вернуться
    dst_self_exam TEXT    NOT NULL DEFAULT '{}',
    dst_source    TEXT    NOT NULL DEFAULT 'parent',
    dst_index     INTEGER NOT NULL DEFAULT 0,
    dst_degree    INTEGER NOT NULL DEFAULT 0,

    -- привязка к врачу
    clinician_id  INTEGER REFERENCES clinicians(id) ON DELETE SET NULL,
    patient_label TEXT,
    follow_up     INTEGER NOT NULL DEFAULT 0,
    source        TEXT    NOT NULL DEFAULT 'parent'
);

-- Учётная запись принадлежит родителю: у него одна почта и может быть
-- несколько детей. Кабинет при этом показывает данные ребёнка-пациента,
-- отсюда и разные имена таблиц.
CREATE TABLE IF NOT EXISTS parents (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
);

-- Имя ребёнка живёт только здесь, в личном кабинете его родителя.
-- Анкета по-прежнему имени не спрашивает, и врачу оно не показывается:
-- на стороне клиники оценка так и остаётся кодом плюс метка врача.
CREATE TABLE IF NOT EXISTS children (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id  INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    sex        TEXT,
    birth_year INTEGER,
    created_at TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_children_parent ON children (parent_id);

CREATE INDEX IF NOT EXISTS idx_assessments_created  ON assessments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_clinician ON assessments (clinician_id);
CREATE INDEX IF NOT EXISTS idx_assessments_level     ON assessments (level);
"""

# Колонки, добавленные после первого выпуска. SQLite не умеет
# ADD COLUMN IF NOT EXISTS, поэтому сверяемся с PRAGMA table_info.
MIGRATIONS: tuple[tuple[str, str, str], ...] = (
    ("assessments", "parent_id",
     "ALTER TABLE assessments ADD COLUMN parent_id INTEGER"
     " REFERENCES parents(id) ON DELETE SET NULL"),
    ("assessments", "child_id",
     "ALTER TABLE assessments ADD COLUMN child_id INTEGER"
     " REFERENCES children(id) ON DELETE SET NULL"),
    ("assessments", "diet",
     "ALTER TABLE assessments ADD COLUMN diet TEXT NOT NULL DEFAULT 'unknown'"),
    ("assessments", "carbs",
     "ALTER TABLE assessments ADD COLUMN carbs TEXT NOT NULL DEFAULT 'unknown'"),
    ("assessments", "blood_group",
     "ALTER TABLE assessments ADD COLUMN blood_group TEXT NOT NULL DEFAULT 'unknown'"),
    ("assessments", "dysplasia",
     "ALTER TABLE assessments ADD COLUMN dysplasia TEXT NOT NULL DEFAULT '[]'"),
    ("assessments", "dst_exam",
     "ALTER TABLE assessments ADD COLUMN dst_exam TEXT NOT NULL DEFAULT '{}'"),
    ("assessments", "dst_source",
     "ALTER TABLE assessments ADD COLUMN dst_source TEXT NOT NULL DEFAULT 'parent'"),
    ("assessments", "dst_index",
     "ALTER TABLE assessments ADD COLUMN dst_index INTEGER NOT NULL DEFAULT 0"),
    ("assessments", "dst_degree",
     "ALTER TABLE assessments ADD COLUMN dst_degree INTEGER NOT NULL DEFAULT 0"),
    ("assessments", "dst_self_exam",
     "ALTER TABLE assessments ADD COLUMN dst_self_exam TEXT NOT NULL DEFAULT '{}'"),
)

# Колонки, с появлением которых поменялся сам расчёт: после их добавления
# сохранённые оценки пересчитываются по новой модели.
RECALC_ON = {"assessments.dst_index"}


def migrate(conn: sqlite3.Connection) -> list[str]:
    """Досоздаёт колонки, которых нет в уже существующей базе."""
    applied: list[str] = []
    for table, column, sql in MIGRATIONS:
        have = {r["name"] for r in conn.execute("PRAGMA table_info(%s)" % table)}
        if column not in have:
            conn.execute(sql)
            applied.append(table + "." + column)
    # Индексы по колонкам из миграций: создаются только после самих колонок.
    # По child_id идут вложенные подзапросы статистики и списка детей —
    # без индекса каждый из них перебирал всю таблицу на каждую строку.
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assessments_parent"
                 " ON assessments (parent_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assessments_dst"
                 " ON assessments (dst_degree)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assessments_child"
                 " ON assessments (child_id, created_at DESC, id DESC)")
    conn.commit()
    if RECALC_ON & set(applied):
        recalculate(conn)
    return applied


def recalculate(conn: sqlite3.Connection) -> int:
    """Пересчитывает сохранённые оценки по текущей модели.

    Раньше признаки дисплазии добавляли баллы к риску диабета — теперь
    их оценивает отдельная шкала ДСТ. Без пересчёта старые записи
    показывали бы завышенный риск и пустую степень дисплазии.
    Осмотр врача, если он уже есть, не трогаем.
    """
    from . import dst, scoring   # модели не зависят от базы — цикла нет

    rows = conn.execute("SELECT * FROM assessments").fetchall()
    for row in rows:
        dysplasia = json.loads(row["dysplasia"] or "[]")
        answers = {
            "age": row["age"], "sex": row["sex"],
            "height": row["height"], "weight": row["weight"],
            "symptoms": json.loads(row["symptoms"] or "[]"),
            "risks": json.loads(row["risks"] or "[]"),
            "duration": row["duration"], "diet": row["diet"],
            "carbs": row["carbs"], "blood": row["blood_group"],
            "dysplasia": dysplasia,
        }
        res = scoring.calculate(answers)
        self_exam = json.loads(row["dst_self_exam"] or "{}") or dst.from_parent(dysplasia)
        exam = json.loads(row["dst_exam"] or "{}") if row["dst_source"] == "doctor" else self_exam
        scale = dst.calculate(exam)
        conn.execute(
            """UPDATE assessments SET total = ?, score = ?, level = ?, bmi_code = ?,
                      factors = ?, dst_exam = ?, dst_self_exam = ?,
                      dst_index = ?, dst_degree = ?
               WHERE id = ?""",
            (res["total"], res["score"], res["level"], res["bmi_class"]["code"],
             json.dumps(res["found"], ensure_ascii=False),
             json.dumps(scale["exam"], ensure_ascii=False),
             json.dumps(dst.normalize(self_exam), ensure_ascii=False),
             scale["index"], scale["degree"], row["id"]),
        )
    conn.commit()
    return len(rows)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect() -> sqlite3.Connection:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    # В режиме WAL этого достаточно для сохранности данных, а fsync на
    # каждую запись не нужен — меньше нагрузки на диск хостинга.
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


# Своё соединение у каждого потока: запросы FastAPI идут в пуле потоков,
# а одно общее соединение при параллельной работе путало транзакции.
# WAL позволяет читать параллельно, записи SQLite выстраивает в очередь сам.
_local = threading.local()


def get() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = _local.conn = connect()
    return conn


def init() -> dict[str, Any]:
    """Создаёт схему и, если база пуста, демонстрационную учётку врача."""
    conn = get()
    conn.executescript(SCHEMA)
    conn.commit()
    applied = migrate(conn)

    info: dict[str, Any] = {"demo_created": False, "demo_parent_created": False,
                            "clinicians": 0, "migrated": applied}
    info["clinicians"] = conn.execute("SELECT COUNT(*) c FROM clinicians").fetchone()["c"]
    info["parents"] = conn.execute("SELECT COUNT(*) c FROM parents").fetchone()["c"]

    if config.SEED_DEMO and info["clinicians"] == 0:
        conn.execute(
            "INSERT INTO clinicians (email, name, role, password_hash, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (config.DEMO_EMAIL, config.DEMO_NAME, "admin",
             security.hash_password(config.DEMO_PASSWORD), now_iso()),
        )
        conn.commit()
        info["demo_created"] = True
        info["clinicians"] = 1

    if config.SEED_DEMO and info["parents"] == 0:
        conn.execute(
            "INSERT INTO parents (email, name, password_hash, created_at)"
            " VALUES (?, ?, ?, ?)",
            (config.DEMO_PARENT_EMAIL, config.DEMO_PARENT_NAME,
             security.hash_password(config.DEMO_PARENT_PASSWORD), now_iso()),
        )
        conn.commit()
        info["demo_parent_created"] = True
        info["parents"] = 1

    # Кто-то должен управлять клиникой: если администратора нет,
    # им становится первый заведённый врач.
    if info["clinicians"] and not conn.execute(
            "SELECT 1 FROM clinicians WHERE role = 'admin'").fetchone():
        conn.execute("UPDATE clinicians SET role = 'admin'"
                     " WHERE id = (SELECT MIN(id) FROM clinicians)")
        conn.commit()
        info["admin_assigned"] = True

    return info


# --------------------------------------------------------------------------
# Помощники
# --------------------------------------------------------------------------

def row_to_assessment(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for field in ("symptoms", "risks", "factors", "dysplasia"):
        d[field] = json.loads(d.get(field) or "[]")
    d["dst_exam"] = json.loads(d.get("dst_exam") or "{}")
    d["follow_up"] = bool(d.get("follow_up"))
    # оценка попала в кабинет родителя, если у неё есть владелец
    d["in_cabinet"] = d.get("parent_id") is not None
    return d


def query(sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
    return get().execute(sql, tuple(params)).fetchall()


def one(sql: str, params: Iterable[Any] = ()) -> sqlite3.Row | None:
    return get().execute(sql, tuple(params)).fetchone()


def execute(sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
    cur = get().execute(sql, tuple(params))
    get().commit()
    return cur
