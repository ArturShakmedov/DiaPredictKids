# -*- coding: utf-8 -*-
"""Оценки риска: сохранение и чтение."""
from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from .. import db, deps, dst, pdf, ratelimit, scoring, security
from ..schemas import (AssessmentIn, AssessmentOut, DstExamIn, FollowUpIn,
                       LabelIn, PdfIn)

router = APIRouter(prefix="/api/assessments", tags=["assessments"])


def to_out(row: sqlite3.Row) -> AssessmentOut:
    """Строка базы -> ответ API. Используется и кабинетом пациента."""
    d = db.row_to_assessment(row)
    scale = dst.calculate(d.get("dst_exam"))
    d.update(dst_exam=scale["exam"], dst_chosen=scale["chosen"],
             dst_heavy=scale["heavy"], dst_anomalies=scale["anomalies"])
    return AssessmentOut(**{k: d[k] for k in AssessmentOut.model_fields if k in d})


# Имя ребёнка хранится только в кабинете родителя. Врачу оно не отдаётся:
# его выборки идут по SELECT * без этого соединения, поэтому child_name
# в ответах клинической части остаётся пустым.
SELECT_WITH_CHILD = """
    SELECT a.*, c.name AS child_name
      FROM assessments a
      LEFT JOIN children c ON c.id = a.child_id
"""


@router.post("", response_model=AssessmentOut, status_code=201)
def create(data: AssessmentIn, request: Request,
           _: None = Depends(deps.check_origin)) -> AssessmentOut:
    """Сохраняет анкету. Балл пересчитывается на сервере по присланным ответам."""
    res = scoring.calculate(data.model_dump())

    # Анкету проходят и без входа. Если родитель вошёл — оценка сразу
    # попадает в его кабинет, иначе он привяжет её позже по коду.
    parent = deps.current_parent(request)
    parent_id = parent["id"] if parent else None
    child_id = None
    if parent_id is not None and data.child_id is not None:
        child = db.one("SELECT id FROM children WHERE id = ? AND parent_id = ?",
                       (data.child_id, parent_id))
        if child is None:
            raise HTTPException(status_code=404, detail="Ребёнок не найден")
        child_id = child["id"]

    # Степень ДСТ по ответам анкеты — предварительная, до осмотра врача.
    # Новый клиент присылает осмотр, старый — короткий список признаков.
    self_exam = dst.normalize(
        data.dst.model_dump() if data.dst else dst.from_parent(data.dysplasia))

    # Признаки дисплазии со временем не меняются, поэтому осмотр врача
    # переносится на новые анкеты того же ребёнка: иначе каждая анкета
    # снова показывала бы степень со слов родителя.
    exam, dst_source = self_exam, "parent"
    if child_id is not None:
        seen = db.one(
            "SELECT dst_exam FROM assessments"
            " WHERE child_id = ? AND dst_source = 'doctor'"
            " ORDER BY created_at DESC, id DESC LIMIT 1", (child_id,))
        if seen:
            exam, dst_source = json.loads(seen["dst_exam"] or "{}"), "doctor"
    scale = dst.calculate(exam)

    pid = security.public_id()
    db.execute(
        """INSERT INTO assessments
           (public_id, created_at, age, sex, height, weight, bmi,
            symptoms, risks, duration,
            diet, carbs, blood_group, dysplasia,
            total, score, level, bmi_code, factors, source, patient_label,
            parent_id, child_id, dst_exam, dst_self_exam, dst_source,
            dst_index, dst_degree)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (pid, db.now_iso(), data.age, data.sex, data.height, data.weight,
         round(res["bmi"], 2),
         json.dumps(data.symptoms, ensure_ascii=False),
         json.dumps(data.risks, ensure_ascii=False),
         data.duration,
         data.diet, data.carbs, data.blood,
         json.dumps(data.dysplasia, ensure_ascii=False),
         res["total"], res["score"], res["level"], res["bmi_class"]["code"],
         json.dumps(res["found"], ensure_ascii=False),
         data.source, data.patient_label, parent_id, child_id,
         json.dumps(scale["exam"], ensure_ascii=False),
         json.dumps(self_exam, ensure_ascii=False), dst_source,
         scale["index"], scale["degree"]),
    )

    row = db.one(SELECT_WITH_CHILD + " WHERE a.public_id = ?", (pid,))
    return to_out(row)


PDF_FIELDS = {"age", "sex", "height", "weight", "symptoms", "risks",
              "dysplasia", "dst", "duration", "diet", "carbs", "blood",
              "source", "lang", "code"}


@router.post("/pdf")
def summary_pdf(data: PdfIn, request: Request,
                _: None = Depends(deps.check_origin)) -> Response:
    """PDF-сводка по ответам анкеты — тот же файл, что даёт печать браузера.

    Ответы здесь не сохраняются: сервер только открывает страницу результата
    и печатает её. Код оценки попадает в файл, лишь если такая оценка есть,
    иначе в «официальной» сводке можно было бы напечатать любой текст.
    """
    # Ручка открыта всем, а каждый вызов запускает браузер на сотни мегабайт
    key = ratelimit.key_for(request, "pdf")
    if ratelimit.too_many(key):
        raise HTTPException(status_code=429,
                            detail="Слишком много запросов. Повторите через несколько минут.")
    ratelimit.remember_failure(key)

    payload = data.model_dump(include=PDF_FIELDS, exclude_none=True)
    if data.code and db.one("SELECT 1 FROM assessments WHERE public_id = ?",
                            (data.code,)) is None:
        payload.pop("code", None)

    filename = "NDST-svodka-%s.pdf" % datetime.now().strftime("%Y-%m-%d")
    return _pdf_response(payload, filename)


def _pdf_response(payload: dict, filename: str, label: str | None = None) -> Response:
    """Печатает сводку в PDF и отдаёт файлом; ошибки печати — понятными кодами."""
    try:
        content = pdf.render_summary(payload)
    except pdf.PdfUnavailable:
        raise HTTPException(status_code=503,
                            detail="Скачивание PDF на этом сервере недоступно")
    except pdf.PdfBusy:
        raise HTTPException(status_code=503,
                            detail="Сервер занят подготовкой других файлов, попробуйте через минуту")
    except pdf.PdfFailed:
        raise HTTPException(status_code=500, detail="Не удалось подготовить PDF")

    # Метка пациента бывает кириллицей: её отдаём в filename* (RFC 6266),
    # а в filename остаётся латинский вариант для старых клиентов.
    disposition = 'attachment; filename="%s"' % filename
    if label:
        disposition += "; filename*=UTF-8''%s" % quote(label + "-" + filename)
    return Response(content=content, media_type="application/pdf", headers={
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
    })


@router.get("/{public_id}/pdf")
def assessment_pdf(public_id: str,
                   lang: str = Query(default="ru", pattern="^(ru|uz|en)$"),
                   _clinician=Depends(deps.require_clinician)) -> Response:
    """PDF-сводка сохранённой оценки для врача — тот же документ, что у родителя.

    Ответы берутся из базы, а не от клиента. Дата в документе — день
    прохождения анкеты; если врач провёл осмотр по шкале ДСТ, в сводку идёт
    его осмотр вместо степени, посчитанной по ответам родителя.
    """
    row = db.one("SELECT * FROM assessments WHERE public_id = ?", (public_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    a = db.row_to_assessment(row)

    payload = {
        "age": a["age"], "sex": a["sex"], "height": a["height"], "weight": a["weight"],
        "symptoms": a["symptoms"], "risks": a["risks"],
        "dysplasia": a["dysplasia"], "duration": a["duration"],
        "diet": a["diet"], "carbs": a["carbs"], "blood": a["blood_group"],
        "source": a["source"], "lang": lang, "code": public_id,
        "date": a["created_at"][:10],
    }
    if a["dst_source"] == "doctor":
        payload["dst_exam"] = dst.normalize(a["dst_exam"])
        payload["dst_source"] = "doctor"
    label = " ".join((a.get("patient_label") or "").split())
    if label:
        payload["label"] = label

    filename = "NDST-%s-%s.pdf" % (public_id, a["created_at"][:10])
    safe_label = re.sub(r"[^\w\- ]+", "", label).strip().replace(" ", "-")[:40]
    return _pdf_response(payload, filename, safe_label or None)


@router.get("/{public_id}", response_model=AssessmentOut)
def read_one(public_id: str) -> AssessmentOut:
    """Открыта по ссылке: идентификатор случайный и неперебираемый."""
    row = db.one("SELECT * FROM assessments WHERE public_id = ?", (public_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    return to_out(row)


@router.get("", response_model=list[AssessmentOut])
def read_many(
    level: str | None = Query(default=None, pattern="^(low|mod|high)$"),
    follow_up: bool | None = None,
    q: str | None = Query(default=None, max_length=80),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _clinician=Depends(deps.require_clinician),
) -> list[AssessmentOut]:
    """Список оценок для кабинета. Доступен только вошедшему врачу."""
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
    sql += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
    params += [limit, offset]

    return [to_out(r) for r in db.query(sql, params)]


@router.patch("/{public_id}/follow-up", response_model=AssessmentOut)
def set_follow_up(public_id: str, data: FollowUpIn,
                  clinician=Depends(deps.require_clinician),
                  _: None = Depends(deps.check_origin)) -> AssessmentOut:
    row = db.one("SELECT id FROM assessments WHERE public_id = ?", (public_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    db.execute(
        "UPDATE assessments SET follow_up = ?, clinician_id = ? WHERE public_id = ?",
        (1 if data.follow_up else 0, clinician["id"], public_id),
    )
    return to_out(db.one("SELECT * FROM assessments WHERE public_id = ?", (public_id,)))


def _store_dst(public_id: str, exam: dict, source: str,
               clinician_id: int) -> AssessmentOut:
    scale = dst.calculate(exam)
    db.execute(
        """UPDATE assessments SET dst_exam = ?, dst_source = ?, dst_index = ?,
                  dst_degree = ?, clinician_id = ?
           WHERE public_id = ?""",
        (json.dumps(scale["exam"], ensure_ascii=False), source,
         scale["index"], scale["degree"], clinician_id, public_id),
    )
    return to_out(db.one("SELECT * FROM assessments WHERE public_id = ?", (public_id,)))


@router.put("/{public_id}/dst", response_model=AssessmentOut)
def set_dst_exam(public_id: str, data: DstExamIn,
                 clinician=Depends(deps.require_clinician),
                 _: None = Depends(deps.check_origin)) -> AssessmentOut:
    """Осмотр врача по полной шкале ДСТ заменяет предварительную степень."""
    if db.one("SELECT id FROM assessments WHERE public_id = ?", (public_id,)) is None:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    return _store_dst(public_id, data.model_dump(), "doctor", clinician["id"])


@router.delete("/{public_id}/dst", response_model=AssessmentOut)
def reset_dst_exam(public_id: str,
                   clinician=Depends(deps.require_clinician),
                   _: None = Depends(deps.check_origin)) -> AssessmentOut:
    """Возвращает степень, посчитанную по ответам родителя."""
    row = db.one("SELECT dysplasia, dst_self_exam FROM assessments WHERE public_id = ?",
                 (public_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    exam = json.loads(row["dst_self_exam"] or "{}") or dst.from_parent(
        json.loads(row["dysplasia"] or "[]"))
    return _store_dst(public_id, exam, "parent", clinician["id"])


@router.patch("/{public_id}/label", response_model=AssessmentOut)
def set_label(public_id: str, data: LabelIn,
              clinician=Depends(deps.require_clinician),
              _: None = Depends(deps.check_origin)) -> AssessmentOut:
    """Метка пациента, которую ставит врач. Имя ребёнка анкета не собирает."""
    row = db.one("SELECT id FROM assessments WHERE public_id = ?", (public_id,))
    if row is None:
        raise HTTPException(status_code=404, detail="Оценка не найдена")
    db.execute(
        "UPDATE assessments SET patient_label = ?, clinician_id = ? WHERE public_id = ?",
        (data.patient_label, clinician["id"], public_id),
    )
    return to_out(db.one("SELECT * FROM assessments WHERE public_id = ?", (public_id,)))
