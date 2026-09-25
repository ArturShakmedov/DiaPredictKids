# -*- coding: utf-8 -*-
"""NDST — приложение FastAPI: чистые адреса, статика и API."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import config, db
from .routers import admin, assessments, auth, clinic, pages, patient


@asynccontextmanager
async def lifespan(app: FastAPI):
    info = db.init()
    print("NDST: база %s, врачей %d, родителей %d"
          % (config.DB_PATH, info["clinicians"], info["parents"]))
    if info["migrated"]:
        print("NDST: добавлены колонки — " + ", ".join(info["migrated"]))
    if info["demo_created"]:
        print("NDST: создана демо-учётка %s / %s — смените пароль перед публикацией"
              % (config.DEMO_EMAIL, config.DEMO_PASSWORD))
    if info["demo_parent_created"]:
        print("NDST: создана демо-учётка родителя %s / %s"
              % (config.DEMO_PARENT_EMAIL, config.DEMO_PARENT_PASSWORD))
    if info["clinicians"] == 0:
        # На хостинге файл с кодом не открыть — первому врачу код нужен из логов
        print("NDST: врачей в базе нет. Код клиники для регистрации первого "
              "врача (он станет администратором): %s" % config.clinic_code())
    if config.SECRET_IS_EPHEMERAL:
        print("NDST: не удалось сохранить ключ подписи сессий в %s — "
              "после перезапуска все войдут заново" % config.DATA_DIR)
    yield


app = FastAPI(
    title="NDST API",
    version="1.0.0",
    summary="Оценка риска сахарного диабета у детей",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)

# Скрипты и словарь переводов сжимаются в несколько раз. Уровень 5 вместо
# стандартного 9: почти тот же размер при заметно меньшей нагрузке на процессор.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(assessments.router)
app.include_router(clinic.router)
app.include_router(patient.router)
pages.register(app)


# --------------------------------------------------------------------------
# Статика: кэш с ревалидацией; разметка — без кэша (см. pages.page)
# --------------------------------------------------------------------------

class CachedStatic(StaticFiles):
    """no-cache — это не «не кэшировать», а «кэшировать, но каждый раз спросить».

    Браузер хранит файл и получает 304, если тот не менялся: трафика почти нет,
    а правки видны сразу. Жёсткий max-age тут вреден — при активной разработке
    он час отдаёт старый js и создаёт впечатление, что изменения не применились.
    """

    def file_response(self, *args, **kwargs):  # type: ignore[override]
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


for url_path, directory in config.STATIC_MOUNTS.items():
    if directory.is_dir():
        app.mount(url_path, CachedStatic(directory=directory),
                  name=url_path.strip("/"))


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return FileResponse(config.FRONTEND_DIR / "assets" / "favicon.svg",
                        media_type="image/svg+xml")


@app.get("/healthz", include_in_schema=False)
def healthz():
    return {"ok": True}


# --------------------------------------------------------------------------
# 404: страница для навигации, JSON — для API
# --------------------------------------------------------------------------

@app.exception_handler(404)
async def not_found(request: Request, exc):
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": "Не найдено"}, status_code=404)

    # адрес с завершающим слэшем ведём на канонический
    path = request.url.path.rstrip("/")
    if path and path != request.url.path and path in pages.PAGES:
        from fastapi.responses import RedirectResponse
        return RedirectResponse(path, status_code=301)

    return FileResponse(config.PAGES_DIR / "404.html", status_code=404,
                        media_type="text/html; charset=utf-8")
