# -*- coding: utf-8 -*-
"""Запуск сервера: python run.py

Автоперезагрузка выключена намеренно. На этой машине uvicorn замечал правку
и печатал «Reloading…», но дочерний процесс не поднимался — сервер молча
продолжал отдавать старый код. Отладка такого дороже, чем перезапуск руками.

Включить обратно: NDST_RELOAD=1 python run.py
"""
import os

import uvicorn

from backend import config

if __name__ == "__main__":
    reload = os.getenv("NDST_RELOAD", "0") == "1"
    if not reload:
        print("NDST: автоперезагрузка выключена — "
              "после правок в backend/ перезапустите сервер")
    uvicorn.run(
        "backend.main:app",
        host=config.HOST,
        port=config.PORT,
        reload=reload,
        reload_dirs=["backend"] if reload else None,
        # За прокси хостинга request.client — адрес прокси, а не посетителя:
        # без X-Forwarded-For счётчик попыток входа был бы общим на всех.
        forwarded_allow_ips=os.getenv("FORWARDED_ALLOW_IPS",
                                      "*" if config.BEHIND_PROXY else "127.0.0.1"),
    )
