# -*- coding: utf-8 -*-
"""Показ сайта заказчику через ngrok — с присмотром за сервером и туннелем.

    python share.py start    запустить в фоне и отдать ссылку
    python share.py status   что сейчас работает
    python share.py stop     остановить всё
    python share.py          то же присмотр, но в этом терминале (Ctrl+C)

Присмотр раз в несколько секунд проверяет сервер (/healthz) и туннель
(локальный API ngrok и сам публичный адрес). Упавшее или зависшее
перезапускается, повторные сбои — с нарастающей паузой, чтобы при
пропавшем интернете не молотить перезапусками.

`start` отдаёт присмотр Планировщику заданий Windows. Процесс создаёт служба
планировщика, поэтому он не зависит от окна или сессии, из которой его
запустили, и не попадает под квоты хоста WMI. Раз в минуту задание
срабатывает снова: пока присмотр жив, повтор игнорируется, а если он упал —
поднимается заново. По той же причине после перезагрузки и входа в систему
всё поднимется само. `stop` снимает задание целиком — до этого сайт открыт.

Отличия сервера от `python run.py`:
  * NDST_SECRET берётся из файла и переживает перезапуск — иначе после
    каждого перезапуска посетители вылетали бы из кабинетов;
  * NDST_COOKIE_SECURE=1 — наружу сайт отдаётся по https.
"""
from __future__ import annotations

import json
import os
import secrets
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from backend import config

# pythonw запускается без консоли, и sys.stdout у него нет
try:
    sys.stdout.reconfigure(line_buffering=True)
except AttributeError:
    pass

BASE_DIR = Path(__file__).resolve().parent
DATA = config.DATA_DIR
SECRET_FILE = DATA / "share_secret.txt"
PID_FILE = DATA / "share.pid"
STATE_FILE = DATA / "share_state.json"
LOG_FILE = DATA / "share.log"
SERVER_LOG = DATA / "server.log"
NGROK_LOG = DATA / "ngrok.log"

PORT = int(os.getenv("NDST_PORT", 8080))
HEALTH_URL = "http://127.0.0.1:%d/healthz" % PORT
NGROK_API = "http://127.0.0.1:4040/api/tunnels"

CHECK_EVERY = 5          # секунд между проверками
FAILS_TO_RESTART = 3     # столько неудачных проверок подряд — перезапуск
PUBLIC_CHECK_EVERY = 60  # публичный адрес проверяем реже: это запрос наружу
MAX_BACKOFF = 60         # потолок паузы между повторными перезапусками
LOG_LIMIT = 5 * 1024 * 1024

# Флаги Windows: дочерним процессам не нужно своё окно консоли
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


# --------------------------------------------------------------------------
# Журнал и состояние
# --------------------------------------------------------------------------

def log(message: str) -> None:
    line = "%s  %s" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), message)
    DATA.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")
    if sys.stdout is not None:
        try:
            print(line, flush=True)
        except (OSError, UnicodeError):
            pass


def rotate(path: Path) -> None:
    """Журналы пишутся дописыванием; без обрезки они росли бы бесконечно."""
    try:
        if path.exists() and path.stat().st_size > LOG_LIMIT:
            path.replace(path.with_suffix(path.suffix + ".old"))
    except OSError:
        pass


def write_state(**fields) -> None:
    state = read_state()
    state.update(fields)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=1),
                          encoding="utf-8")


def read_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def pid_alive(pid: int) -> bool:
    if not pid:
        return False
    out = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/NH"],
                         capture_output=True, text=True, errors="replace").stdout
    return str(pid) in out


def supervisor_pid() -> int | None:
    try:
        pid = int(PID_FILE.read_text().strip())
    except (OSError, ValueError):
        return None
    return pid if pid_alive(pid) else None


# --------------------------------------------------------------------------
# Проверки
# --------------------------------------------------------------------------

def get(url: str, timeout: float = 4, headers: dict | None = None) -> int | None:
    req = urllib.request.Request(url, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError, ValueError):
        return None


def server_healthy() -> bool:
    return get(HEALTH_URL) == 200


def tunnel_url() -> str | None:
    try:
        with urllib.request.urlopen(NGROK_API, timeout=3) as r:
            tunnels = json.loads(r.read().decode()).get("tunnels", [])
    except (urllib.error.URLError, OSError, ValueError):
        return None
    for t in tunnels:
        if t.get("public_url", "").startswith("https://"):
            return t["public_url"]
    return None


def public_reachable(url: str) -> bool:
    # заголовок пропускает страницу-предупреждение бесплатного тарифа ngrok
    code = get(url + "/healthz", timeout=10,
               headers={"ngrok-skip-browser-warning": "1"})
    return code == 200


# --------------------------------------------------------------------------
# Процессы
# --------------------------------------------------------------------------

def find_ngrok() -> str:
    """ngrok из PATH, иначе из каталога, куда его кладёт winget."""
    found = shutil.which("ngrok")
    if found:
        return found
    winget = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages"
    for path in winget.glob("Ngrok.Ngrok*/ngrok.exe"):
        return str(path)
    raise SystemExit("ngrok не найден. Установите: winget install Ngrok.Ngrok")


def session_secret() -> str:
    """Ключ подписи сессий, одинаковый между запусками."""
    if SECRET_FILE.exists():
        value = SECRET_FILE.read_text(encoding="utf-8").strip()
        if value:
            return value
    value = secrets.token_hex(32)
    SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
    SECRET_FILE.write_text(value, encoding="utf-8")
    return value


def kill_tree(pid: int) -> None:
    subprocess.run(["taskkill", "/T", "/F", "/PID", str(pid)],
                   capture_output=True)


def clear_leftovers() -> None:
    """Убирает хвосты прошлых запусков, которые мешают стартовать.

    Бесплатный тариф ngrok разрешает один агент на учётную запись: забытый
    процесс ngrok не даст поднять новый туннель. А процесс, занявший порт
    сервера, отвечал бы на проверки вместо нашего — со старым кодом и без
    нужных настроек.
    """
    out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq ngrok.exe", "/NH"],
                         capture_output=True, text=True, errors="replace").stdout
    if "ngrok.exe" in out:
        subprocess.run(["taskkill", "/F", "/IM", "ngrok.exe"], capture_output=True)
        log("остановлен оставшийся от прошлого запуска ngrok")

    net = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                         errors="replace").stdout
    for line in net.splitlines():
        parts = line.split()
        if len(parts) >= 5 and parts[1].endswith(":%d" % PORT) and parts[3] == "LISTENING":
            pid = int(parts[4])
            if pid and pid != os.getpid():
                kill_tree(pid)
                log("освобождён порт %d (процесс %d)" % (PORT, pid))


class Child:
    """Один присматриваемый процесс: как запустить, сколько раз падал."""

    def __init__(self, name: str, command: list[str], log_path: Path, env: dict):
        self.name = name
        self.command = command
        self.log_path = log_path
        self.env = env
        self.proc: subprocess.Popen | None = None
        self.fails = 0
        self.restarts = 0
        self.backoff = 0
        self.last_start = 0.0

    def start(self) -> None:
        rotate(self.log_path)
        out = open(self.log_path, "a", encoding="utf-8", errors="replace")
        self.proc = subprocess.Popen(self.command, cwd=BASE_DIR, env=self.env,
                                     stdout=out, stderr=subprocess.STDOUT,
                                     stdin=subprocess.DEVNULL,
                                     creationflags=NO_WINDOW)
        out.close()                 # дескриптор уже унаследован процессом
        self.last_start = time.time()
        self.fails = 0

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            kill_tree(self.proc.pid)
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass

    def restart(self, reason: str) -> None:
        # Если процесс падает сразу после старта, растягиваем паузу: иначе
        # без интернета или при занятом порте присмотр крутился бы вхолостую.
        if time.time() - self.last_start < 90:
            self.backoff = min(MAX_BACKOFF, max(5, self.backoff * 2))
        else:
            self.backoff = 0
        log("%s: %s — перезапуск%s" % (
            self.name, reason,
            " через %d с" % self.backoff if self.backoff else ""))
        self.stop()
        if self.backoff:
            time.sleep(self.backoff)
        self.restarts += 1
        self.start()
        write_state(**{self.name + "_pid": self.proc.pid,
                       self.name + "_restarts": self.restarts})


# --------------------------------------------------------------------------
# Присмотр
# --------------------------------------------------------------------------

def wait_until(check, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if check():
            return True
        time.sleep(0.5)
    return False


def supervise() -> int:
    running = supervisor_pid()
    if running and running != os.getpid():
        # Код 0, а не ошибка: иначе планировщик счёл бы запуск неудачным
        # и раз в минуту пытался бы стартовать второй экземпляр.
        log("присмотр уже запущен (процесс %d) — второй не нужен" % running)
        return 0

    DATA.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(str(os.getpid()))
    STATE_FILE.write_text("{}", encoding="utf-8")
    log("присмотр запущен, процесс %d" % os.getpid())

    clear_leftovers()

    env = dict(os.environ)
    env["NDST_SECRET"] = session_secret()
    env["NDST_COOKIE_SECURE"] = "1"
    env["NDST_PORT"] = str(PORT)
    env["PYTHONIOENCODING"] = "utf-8"

    python = sys.executable.replace("pythonw.exe", "python.exe")
    server = Child("server", [python, "run.py"], SERVER_LOG, env)
    tunnel = Child("ngrok", [find_ngrok(), "http", str(PORT), "--log", "stdout"],
                   NGROK_LOG, env)

    server.start()
    if not wait_until(server_healthy, 40):
        log("сервер не ответил за 40 с — см. %s" % SERVER_LOG)
    tunnel.start()
    url = tunnel_url() if wait_until(lambda: tunnel_url() is not None, 40) else None
    log("сервер: http://127.0.0.1:%d | туннель: %s" % (PORT, url or "не поднялся"))
    write_state(url=url, started=datetime.now().isoformat(timespec="seconds"),
                supervisor_pid=os.getpid(), server_pid=server.proc.pid,
                ngrok_pid=tunnel.proc.pid, server_restarts=0, ngrok_restarts=0)

    public_fails = 0
    last_public = 0.0

    try:
        while True:
            time.sleep(CHECK_EVERY)

            # ---- сервер ----------------------------------------------------
            if server.proc.poll() is not None:
                server.restart("процесс завершился (код %s)" % server.proc.returncode)
            elif not server_healthy():
                server.fails += 1
                if server.fails >= FAILS_TO_RESTART:
                    server.restart("не отвечает на /healthz %d раз подряд" % server.fails)
            else:
                server.fails = 0

            # ---- туннель ---------------------------------------------------
            current = tunnel_url()
            if tunnel.proc.poll() is not None:
                tunnel.restart("процесс завершился (код %s)" % tunnel.proc.returncode)
                current = tunnel_url() if wait_until(
                    lambda: tunnel_url() is not None, 40) else None
            elif current is None:
                tunnel.fails += 1
                if tunnel.fails >= FAILS_TO_RESTART:
                    tunnel.restart("туннель пропал из API ngrok")
                    current = tunnel_url() if wait_until(
                        lambda: tunnel_url() is not None, 40) else None
            else:
                tunnel.fails = 0

            # Туннель может числиться живым, а снаружи не открываться —
            # поэтому изредка проверяем сам публичный адрес.
            if current and server.fails == 0 and time.time() - last_public > PUBLIC_CHECK_EVERY:
                last_public = time.time()
                if public_reachable(current):
                    public_fails = 0
                else:
                    public_fails += 1
                    log("публичный адрес не ответил (%d раз подряд)" % public_fails)
                    if public_fails >= FAILS_TO_RESTART:
                        public_fails = 0
                        tunnel.restart("публичный адрес недоступен")
                        current = tunnel_url() if wait_until(
                            lambda: tunnel_url() is not None, 40) else None

            if current and current != read_state().get("url"):
                log("адрес туннеля: %s" % current)
                write_state(url=current)
    except KeyboardInterrupt:
        log("остановка по Ctrl+C")
    finally:
        tunnel.stop()
        server.stop()
        try:
            if PID_FILE.read_text().strip() == str(os.getpid()):
                PID_FILE.unlink()
        except OSError:
            pass
        log("присмотр остановлен")
    return 0


# --------------------------------------------------------------------------
# Команды
# --------------------------------------------------------------------------

def report(url: str) -> None:
    line = "=" * 64
    print("\n" + line)
    print("Ссылка для заказчика:  " + url)
    print(line)
    print("""
Что открыть:
  {u}                    лендинг
  {u}/assessment         анкета (без входа)
  {u}/patient            кабинет пациента
  {u}/doctor             кабинет врача

Доступы (демонстрационные):
  кабинет пациента   {pe} / {pp}
  кабинет врача      {de} / {dp}

Код клиники для регистрации врача: {code}
  {u}/register — врач заводит свою учётную запись сам

На бесплатном тарифе ngrok при первом заходе показывает страницу-
предупреждение — нужно один раз нажать «Visit Site».

Журнал присмотра: {log}
Остановить: python share.py stop
""".format(u=url, log=LOG_FILE, code=config.clinic_code(),
           pe=config.DEMO_PARENT_EMAIL, pp=config.DEMO_PARENT_PASSWORD,
           de=config.DEMO_EMAIL, dp=config.DEMO_PASSWORD))


TASK_NAME = "NDST share"


def powershell(script: str) -> subprocess.CompletedProcess:
    return subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", script],
                          capture_output=True, text=True, errors="replace")


def ps_quote(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def start_detached() -> int:
    pid = supervisor_pid()
    if pid:
        print("уже работает (присмотр, процесс %d)" % pid)
        return status()

    # Почему планировщик, а не фоновый процесс или WMI:
    #  * фоновый процесс живёт в дереве терминала и умирает вместе с ним;
    #  * процесс, созданный через WMI, попадает в job хоста провайдера
    #    с квотами (512 МБ и 256 потоков на хост) — при превышении WMI
    #    гасит хост вместе со всеми его детьми.
    # Настройки: без ограничения по времени (по умолчанию планировщик
    # убивает задание через 3 дня) и не останавливаться при работе от
    # батареи (по умолчанию ноутбук гасит задание, как только отключают
    # зарядку).
    #
    # Сторож за самим присмотром — повтор раз в минуту. Настройка «перезапуск
    # при сбое» для этого не годится: она срабатывает, только если задание не
    # смогло стартовать, а убитый присмотр не поднимает — проверено. Повтор с
    # IgnoreNew безопасен: пока присмотр жив, второй экземпляр не запустится.
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    exe = str(pythonw if pythonw.exists() else sys.executable)
    script = """
$action = New-ScheduledTaskAction -Execute {exe} -Argument {args} -WorkingDirectory {cwd}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddSeconds(30) `
    -RepetitionInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName {name} -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName {name}
""".format(exe=ps_quote(exe), args=ps_quote('"%s" run' % (BASE_DIR / "share.py")),
           cwd=ps_quote(BASE_DIR), name=ps_quote(TASK_NAME))
    result = powershell(script)
    if result.returncode:
        print("не удалось создать задание планировщика:\n" + result.stderr.strip())
        return 1
    print("задание «%s» запущено — жду сервер и туннель…" % TASK_NAME)

    if not wait_until(lambda: bool(read_state().get("url")) and server_healthy(), 90):
        print("за 90 с не поднялось. Журнал: %s" % LOG_FILE)
        return 1
    report(read_state()["url"])
    return 0


def status() -> int:
    pid = supervisor_pid()
    state = read_state()
    url = tunnel_url()
    print("код клиники : %s" % config.clinic_code())
    print("присмотр : %s" % ("работает, процесс %d" % pid if pid else "не запущен"))
    task = powershell("(Get-ScheduledTask -TaskName %s -ErrorAction SilentlyContinue).State"
                      % ps_quote(TASK_NAME)).stdout.strip()
    print("задание  : %s" % (task or "не зарегистрировано"))
    print("сервер   : %s (перезапусков: %s)" % (
        "отвечает" if server_healthy() else "НЕ отвечает", state.get("server_restarts", 0)))
    print("туннель  : %s (перезапусков: %s)" % (url or "НЕТ", state.get("ngrok_restarts", 0)))
    if url:
        print("снаружи  : %s" % ("открывается" if public_reachable(url) else "НЕ открывается"))
    if state.get("started"):
        print("запущен  : %s" % state["started"])
    return 0 if pid and url and server_healthy() else 1


def stop() -> int:
    # Сначала снимаем задание: иначе планировщик увидел бы убитый присмотр
    # как упавший и через минуту поднял бы его обратно.
    powershell("Stop-ScheduledTask -TaskName {n} -ErrorAction SilentlyContinue; "
               "Unregister-ScheduledTask -TaskName {n} -Confirm:$false "
               "-ErrorAction SilentlyContinue".format(n=ps_quote(TASK_NAME)))
    pid = supervisor_pid()
    state = read_state()
    if pid:
        kill_tree(pid)
    # дети могли пережить присмотр, если его убили грубо
    for key in ("server_pid", "ngrok_pid"):
        if state.get(key) and pid_alive(state[key]):
            kill_tree(state[key])
    try:
        PID_FILE.unlink()
    except OSError:
        pass
    log("остановлено командой stop")
    print("остановлено")
    return 0


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    actions = {"run": supervise, "start": start_detached,
               "status": status, "stop": stop}
    if command not in actions:
        raise SystemExit("команды: start | status | stop | run")
    raise SystemExit(actions[command]())
