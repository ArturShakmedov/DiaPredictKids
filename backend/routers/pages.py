# -*- coding: utf-8 -*-
"""Страницы и чистые адреса.

Каждой странице и каждому разделу кабинета соответствует один канонический
URL без расширения. Старые адреса с .html отвечают 301, чтобы ссылки
не ломались и поисковик не считал их дублями.
"""
from __future__ import annotations

from typing import Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse

from .. import config, deps

router = APIRouter(include_in_schema=False)

# канонический адрес -> файл в корне проекта
PAGES: dict[str, str] = {
    "/": "index.html",
    "/assessment": "assessment.html",
    "/doctor": "doctor.html",
    "/login": "login.html",
    "/register": "doctor-register.html",
    "/patient": "patient.html",
    "/patient/login": "patient-login.html",
    "/patient/register": "patient-register.html",
}

# старый адрес -> канонический
LEGACY: dict[str, str] = {
    "/index.html": "/",
    "/assessment.html": "/assessment",
    "/doctor.html": "/doctor",
    "/login.html": "/login",
}

# Разделы кабинетов. Сводка живёт на корневом адресе кабинета — отдельный
# /doctor/overview был бы вторым адресом одной страницы, поэтому редиректит.
DOCTOR_SECTIONS: tuple[str, ...] = (
    "assessments", "risk", "stats", "knowledge", "settings",
)
PATIENT_SECTIONS: tuple[str, ...] = (
    "history", "children", "recommendations",
)

# Пациентов как отдельной сущности у врача нет: система хранит оценки без
# имени ребёнка, поэтому прежний раздел ведёт на список оценок.
DOCTOR_MOVED: dict[str, str] = {
    "overview": "/doctor",
    "patients": "/doctor/assessments",
}
PATIENT_MOVED: dict[str, str] = {
    "overview": "/patient",
}


class Cabinet:
    """Правила доступа к одному кабинету: кто вошёл, куда вести гостя."""

    def __init__(self, root: str, page_file: str, sections: tuple[str, ...],
                 moved: dict[str, str], login_url: str,
                 who: Callable[[Request], object | None]):
        self.root = root
        self.page_file = page_file
        self.sections = sections
        self.moved = moved
        self.login_url = login_url
        self.who = who

    def guard(self, request: Request, url: str):
        """None — доступ есть; иначе готовый редирект на вход."""
        if self.who(request) is None:
            return RedirectResponse(self.login_url + "?next=" + url, status_code=302)
        return None


DOCTOR = Cabinet("/doctor", "doctor.html", DOCTOR_SECTIONS, DOCTOR_MOVED,
                 "/login", deps.current_clinician)
PATIENT = Cabinet("/patient", "patient.html", PATIENT_SECTIONS, PATIENT_MOVED,
                  "/patient/login", deps.current_parent)

CABINETS = (DOCTOR, PATIENT)

# Страница входа -> кабинет, в который она ведёт. Вошедшему на ней делать
# нечего, поэтому его сразу отправляем внутрь.
LOGIN_PAGES: dict[str, Cabinet] = {
    "/login": DOCTOR,
    "/register": DOCTOR,
    "/patient/login": PATIENT,
    "/patient/register": PATIENT,
}


def page(name: str) -> FileResponse:
    return FileResponse(
        config.PAGES_DIR / name,
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "no-cache"},   # разметка меняется часто
    )


def register(app) -> None:
    """Регистрирует страницы, разделы кабинетов и редиректы."""

    # ---- отдельные страницы ---------------------------------------------
    # Точные адреса регистрируются раньше шаблонов /кабинет/{section},
    # иначе /patient/login попал бы в разбор разделов.
    for url, filename in PAGES.items():
        def make(url=url, filename=filename):
            def handler(request: Request):
                cabinet = next((c for c in CABINETS if c.root == url), None)
                if cabinet is not None:
                    denied = cabinet.guard(request, url)
                    if denied is not None:
                        return denied

                login_for = LOGIN_PAGES.get(url)
                if login_for is not None and login_for.who(request) is not None:
                    return RedirectResponse(login_for.root, status_code=302)

                return page(filename)
            return handler

        app.get(url, include_in_schema=False)(make())

    # ---- разделы кабинетов ----------------------------------------------
    for cabinet in CABINETS:
        def make_section(cabinet=cabinet):
            def handler(section: str, request: Request):
                if section in cabinet.moved:
                    return RedirectResponse(cabinet.moved[section], status_code=301)
                if section not in cabinet.sections:
                    raise HTTPException(status_code=404)
                url = cabinet.root + "/" + section
                denied = cabinet.guard(request, url)
                if denied is not None:
                    return denied
                return page(cabinet.page_file)
            return handler

        app.get(cabinet.root + "/{section}", include_in_schema=False)(make_section())

    # ---- старые адреса ---------------------------------------------------
    for old, new in LEGACY.items():
        def make_redirect(new=new):
            def handler():
                return RedirectResponse(new, status_code=301)
            return handler

        app.get(old, include_in_schema=False)(make_redirect())
