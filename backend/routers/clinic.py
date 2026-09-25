# -*- coding: utf-8 -*-
"""Сводка кабинета: показатели и распределение риска."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query, Response

from .. import db, deps, dst, scoring

router = APIRouter(prefix="/api/clinic", tags=["clinic"])


# Единица сравнения — ребёнок, а не анкета: у ребёнка с пятью анкетами
# иначе был бы пятикратный вес. Берём последнюю анкету каждого ребёнка,
# анкеты без профиля считаются сами по себе.
PER_CHILD = """
    SELECT * FROM assessments a
     WHERE a.child_id IS NULL
        OR a.id = (SELECT b.id FROM assessments b
                    WHERE b.child_id = a.child_id
                    ORDER BY b.created_at DESC, b.id DESC LIMIT 1)
"""


@router.get("/stats")
def stats(days: int = Query(default=30, ge=1, le=3650),
          _clinician=Depends(deps.require_clinician)) -> dict:
    """Всё считается запросами к базе — выдуманных чисел здесь нет."""
    total = db.one("SELECT COUNT(*) c FROM assessments")["c"]

    by_level = {r["level"]: r["c"] for r in db.query(
        "SELECT level, COUNT(*) c FROM assessments GROUP BY level")}

    since = (datetime.now(timezone.utc) - timedelta(days=days)).replace(microsecond=0).isoformat()
    last_month = db.one(
        "SELECT COUNT(*) c FROM assessments WHERE created_at >= ?", (since,))["c"]

    follow_up = db.one(
        "SELECT COUNT(*) c FROM assessments WHERE follow_up = 1")["c"]

    high = by_level.get("high", 0)

    # помесячная динамика за последние 7 месяцев
    months = db.query(
        """SELECT substr(created_at, 1, 7) AS ym,
                  COUNT(*) AS total,
                  SUM(CASE WHEN level = 'high' THEN 1 ELSE 0 END) AS high
           FROM assessments
           GROUP BY ym ORDER BY ym DESC LIMIT 7"""
    )

    # Риск диабета в группах по степени ДСТ — ради этого сравнения шкала
    # и считается отдельно. Степень 0 — «недостаточно признаков», то есть
    # группа без ДСТ; 1–3 — степени дисплазии.
    by_degree = {r["degree"]: r for r in db.query(
        """SELECT dst_degree AS degree, COUNT(*) AS n, SUM(score) AS score_sum,
                  SUM(CASE WHEN level = 'low'  THEN 1 ELSE 0 END) AS low,
                  SUM(CASE WHEN level = 'mod'  THEN 1 ELSE 0 END) AS mod,
                  SUM(CASE WHEN level = 'high' THEN 1 ELSE 0 END) AS high,
                  SUM(CASE WHEN dst_source = 'doctor' THEN 1 ELSE 0 END) AS doctor
           FROM (""" + PER_CHILD + """) GROUP BY dst_degree""")}

    def group(degrees: tuple[int, ...]) -> dict:
        rows = [by_degree[d] for d in degrees if d in by_degree]
        n = sum(r["n"] for r in rows)
        score_sum = sum(r["score_sum"] or 0 for r in rows)
        return {
            "n": n,
            "avg_score": round(score_sum / n, 1) if n else None,
            "low": sum(r["low"] for r in rows),
            "mod": sum(r["mod"] for r in rows),
            "high": sum(r["high"] for r in rows),
            "doctor": sum(r["doctor"] for r in rows),
        }

    dst_groups = [dict(group((d,)), degree=d) for d in range(4)]

    return {
        "total": total,
        "days": days,
        "dst_groups": dst_groups,
        "dst_with": group((1, 2, 3)),
        "last_month": last_month,
        "follow_up": follow_up,
        "by_level": {
            "low": by_level.get("low", 0),
            "mod": by_level.get("mod", 0),
            "high": high,
        },
        "high_share": round(high / total * 100, 1) if total else 0.0,
        "months": [
            {"ym": r["ym"], "total": r["total"], "high": r["high"]}
            for r in reversed(months)
        ],
    }


@router.get("/report")
def report(days: int = Query(default=90, ge=1, le=3650),
           _clinician=Depends(deps.require_clinician)) -> dict:
    """Отчёт за период для раздела «Статистика»."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).replace(microsecond=0).isoformat()
    rows = db.query("SELECT * FROM assessments WHERE created_at >= ?", (since,))

    levels = {"low": 0, "mod": 0, "high": 0}
    degrees = [0, 0, 0, 0]
    scores: list[int] = []
    sources = {"parent": 0, "clinic": 0}
    doctor_exams = follow = 0
    factors: dict[str, int] = {}

    for row in rows:
        levels[row["level"]] = levels.get(row["level"], 0) + 1
        degrees[row["dst_degree"]] += 1
        scores.append(row["score"])
        sources[row["source"]] = sources.get(row["source"], 0) + 1
        doctor_exams += 1 if row["dst_source"] == "doctor" else 0
        follow += 1 if row["follow_up"] else 0
        for factor in json.loads(row["factors"] or "[]"):
            factors[factor["label"]] = factors.get(factor["label"], 0) + 1

    top = sorted(factors.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    return {
        "days": days,
        "total": len(rows),
        "levels": levels,
        "degrees": degrees,
        "avg_score": round(sum(scores) / len(scores), 1) if scores else None,
        "sources": sources,
        "doctor_exams": doctor_exams,
        "follow_up": follow,
        "top_factors": [{"label": label, "n": n} for label, n in top],
    }


CSV_HEADER = (
    "Код оценки", "Дата", "Кто заполнял", "Метка пациента", "Возраст", "Пол",
    "Рост, см", "Вес, кг", "ИМТ", "Риск диабета, %", "Уровень риска",
    "Индекс ДСТ", "Степень ДСТ", "Источник степени", "Признаков ДСТ",
    "Аномалий органов", "Группа крови", "Питание", "Доля углеводов",
    "Длительность симптомов", "Симптомы", "Факторы риска", "Повторный контроль",
)

LEVEL_NAME = {"low": "низкий", "mod": "умеренный", "high": "высокий"}
SEX_NAME = {"m": "мальчик", "f": "девочка"}
SOURCE_NAME = {"parent": "родитель", "clinic": "медработник"}


@router.get("/export.csv")
def export_csv(level: str | None = Query(default=None, pattern="^(low|mod|high)$"),
               follow_up: bool | None = None,
               q: str | None = Query(default=None, max_length=80),
               days: int | None = Query(default=None, ge=1, le=3650),
               _clinician=Depends(deps.require_clinician)) -> Response:
    """Выгрузка оценок в CSV с учётом фильтров таблицы.

    Разделитель — точка с запятой, в начале файла BOM: так Excel открывает
    файл с кириллицей и не склеивает всё в один столбец.
    """
    sql = "SELECT * FROM assessments WHERE 1=1"
    params: list = []
    if level:
        sql += " AND level = ?"
        params.append(level)
    if follow_up is not None:
        sql += " AND follow_up = ?"
        params.append(1 if follow_up else 0)
    if q:
        sql += " AND (public_id LIKE ? OR IFNULL(patient_label,'') LIKE ?)"
        params += ["%" + q + "%", "%" + q + "%"]
    if days:
        sql += " AND created_at >= ?"
        params.append((datetime.now(timezone.utc) - timedelta(days=days)).replace(microsecond=0).isoformat())
    sql += " ORDER BY created_at DESC, id DESC"

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerow(CSV_HEADER)

    for row in db.query(sql, params):
        scale = dst.calculate(json.loads(row["dst_exam"] or "{}"))
        symptoms = [scoring.SYMPTOMS[k]["label"] for k in json.loads(row["symptoms"] or "[]")
                    if k in scoring.SYMPTOMS]
        risks = [scoring.ALL_RISKS[k]["label"] for k in json.loads(row["risks"] or "[]")
                 if k in scoring.ALL_RISKS]
        writer.writerow((
            row["public_id"], row["created_at"][:19].replace("T", " "),
            SOURCE_NAME.get(row["source"], row["source"]), row["patient_label"] or "",
            row["age"], SEX_NAME.get(row["sex"], row["sex"]),
            row["height"], row["weight"], row["bmi"],
            row["score"], LEVEL_NAME.get(row["level"], row["level"]),
            row["dst_index"], dst.DEGREES[row["dst_degree"]]["label"],
            "осмотр врача" if row["dst_source"] == "doctor" else "со слов родителя",
            scale["chosen"], scale["anomalies"],
            scoring.BLOOD.get(row["blood_group"], ""),
            scoring.DIET[row["diet"]]["label"] if row["diet"] in scoring.DIET else "",
            scoring.CARBS[row["carbs"]]["label"] if row["carbs"] in scoring.CARBS else "",
            scoring.DURATION[row["duration"]]["label"] if row["duration"] in scoring.DURATION else "",
            ", ".join(symptoms), ", ".join(risks),
            "да" if row["follow_up"] else "нет",
        ))

    content = "\ufeff" + buffer.getvalue()
    filename = "NDST-ocenki-%s.csv" % datetime.now().strftime("%Y-%m-%d")
    return Response(content=content, media_type="text/csv; charset=utf-8", headers={
        "Content-Disposition": 'attachment; filename="%s"' % filename,
        "Cache-Control": "no-store",
    })
