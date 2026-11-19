import base64
import hashlib
import os
import sqlite3
import subprocess
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

FLAG = os.environ.get("FLAG", "")
STAND = os.environ.get("STAND", "")
HOLDER = "h" + hashlib.sha256(FLAG.encode()).hexdigest()[:12]
DOCS = "/tmp/stand/docs"
OWN_CARD = "7"


def escape(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def page(title: str, body: str) -> bytes:
    text = f"""<!doctype html>
<meta charset="utf-8">
<title>{title}</title>
<h1>{title}</h1>
{body}
"""
    return text.encode()


def send(handler: BaseHTTPRequestHandler, body: bytes) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", "text/html; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def query(path: str) -> dict[str, str]:
    parsed = parse_qs(urlparse(path).query)
    return {key: values[0] for key, values in parsed.items() if values}


def sqli(path: str, title: str, param: str, table: str, plain: str) -> bytes:
    name = query(path).get(param, "")
    rows: list[tuple[str, str]] = []
    failed = False
    if name:
        statement = f"SELECT name, note FROM {table} WHERE name = '" + name + "'"
        try:
            rows = list(db.execute(statement))
        except sqlite3.Error:
            failed = True
    found = "".join(f"<li>{escape(note)}</li>" for _, note in rows)
    if failed:
        status = "Запрос не выполнен."
    elif name and not rows:
        status = "Ничего не найдено."
    else:
        status = ""
    body = f"""<form method="get">
  <label>{escape(param)} <input name="{escape(param)}" value="{escape(name)}"></label>
  <button>Открыть</button>
</form>
<p>{status}</p>
<ul>{found}</ul>
<p>{escape(plain)}</p>
"""
    return page(title, body)


def greeting(path: str) -> bytes:
    name = query(path).get("name", "")
    note = f"<p>{FLAG}</p>" if ("<" in name or ">" in name) else ""
    body = f"""<form method="get">
  <label>Имя <input name="name" value="{escape(name)}"></label>
  <button>Показать</button>
</form>
<p>Привет, {name}</p>
{note}
"""
    return page("Стенд приветствия", body)


def mailbox(path: str) -> bytes:
    email = query(path).get("email", "")
    if email:
        body = f"<p>Почта изменена: {escape(email)}</p><p>{FLAG}</p>"
    else:
        body = """<form method="get">
  <label>Почта <input name="email" value="student@team"></label>
  <button>Сменить</button>
</form>
<p>Текущая почта: student@team</p>
"""
    return page("Стенд смены почты", body)


def cards(path: str) -> bytes:
    chosen = query(path).get("id", OWN_CARD)
    if chosen == OWN_CARD:
        note = "ваша карточка"
    elif chosen == str(int(OWN_CARD) + 1):
        note = FLAG
    else:
        note = "карточки нет"
    body = f"""<p>Номер вашей карточки: {OWN_CARD}</p>
<form method="get">
  <label>Номер <input name="id" value="{escape(chosen)}"></label>
  <button>Открыть</button>
</form>
<p>{escape(note)}</p>
"""
    return page("Стенд карточек", body)


def documents(path: str) -> bytes:
    name = query(path).get("file", "readme.txt")
    target = os.path.join(DOCS, name)
    try:
        with open(target, encoding="utf-8") as handle:
            text = handle.read()
    except OSError:
        text = "Документ не найден."
    body = f"""<form method="get">
  <label>Файл <input name="file" value="{escape(name)}"></label>
  <button>Открыть</button>
</form>
<pre>{escape(text)}</pre>
"""
    return page("Стенд документов", body)


def preview(path: str, title: str, param: str, internal: str, ordinary: str) -> bytes:
    raw = query(path).get(param, "")
    shown = ordinary
    if raw:
        parsed = urlparse(raw)
        host = parsed.hostname or ""
        if parsed.scheme == "http" and host in {"127.0.0.1", "localhost"} and parsed.port == 8080:
            shown = internal if parsed.path == hidden_path(title) else "Записи нет."
        else:
            shown = "Внешний адрес не содержит служебную запись."
    body = f"""<form method="get">
  <label>{escape(param)} <input name="{escape(param)}" value="{escape(raw)}"></label>
  <button>Открыть</button>
</form>
<p>{escape(shown)}</p>
"""
    return page(title, body)


def hidden_path(title: str) -> str:
    if title == "Стенд аватаров":
        return "/images/private"
    return "/local/note"


def session_page(path: str) -> bytes:
    raw = query(path).get("session", base64.b64encode(b"role=student").decode())
    role = ""
    try:
        decoded = base64.b64decode(raw, validate=True)
        for part in decoded.split(b"&"):
            key, _, value = part.partition(b"=")
            if key == b"role":
                role = value.decode()
    except (ValueError, UnicodeError):
        role = ""
    if role == "student":
        note = "сессия студента"
    elif role == "admin":
        note = FLAG
    else:
        note = "сессия не принята"
    body = f"""<form method="get">
  <label>Сессия <input name="session" value="{escape(raw)}"></label>
  <button>Открыть</button>
</form>
<p>{escape(note)}</p>
"""
    return page("Стенд сессии из байтов", body)


def report(path: str) -> bytes:
    title = query(path).get("title", "")
    text = ""
    if title:
        try:
            completed = subprocess.run(
                "printf %s " + title,
                shell=True,
                capture_output=True,
                text=True,
                timeout=2,
            )
            text = completed.stdout[:500]
        except (subprocess.SubprocessError, OSError):
            text = "Отчёт не собрался."
    body = f"""<form method="get">
  <label>Название <input name="title" value="{escape(title)}"></label>
  <button>Собрать</button>
</form>
<pre>{escape(text)}</pre>
"""
    return page("Стенд отчётов", body)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if STAND == "web-sqli":
            body = sqli(self.path, "Стенд входа", "name", "users", "")
        elif STAND == "web-sqli-oral":
            body = sqli(self.path, "Стенд поиска заказов", "q", "orders", "")
        elif STAND == "web-xss":
            body = greeting(self.path)
        elif STAND == "web-csrf":
            body = mailbox(self.path)
        elif STAND == "web-idor":
            body = cards(self.path)
        elif STAND == "web-traversal":
            body = documents(self.path)
        elif STAND == "web-ssrf":
            body = preview(self.path, "Стенд превью", "url", FLAG, "обычное превью")
        elif STAND == "web-ssrf-oral":
            body = preview(self.path, "Стенд аватаров", "avatar", FLAG, "обычная картинка")
        elif STAND == "web-deser":
            body = session_page(self.path)
        elif STAND == "web-command":
            body = report(self.path)
        else:
            body = page("Стенд", "<p>Стенд не выбран.</p>")
        send(self, body)

    def log_message(self, fmt: str, *args) -> None:
        return


def prepare() -> None:
    os.makedirs(DOCS, exist_ok=True)
    with open(os.path.join(DOCS, "readme.txt"), "w", encoding="utf-8") as handle:
        handle.write("заметка команды")
    with open("/tmp/stand/secret.txt", "w", encoding="utf-8") as handle:
        handle.write(FLAG)
    db.execute("CREATE TABLE users (name TEXT, note TEXT)")
    db.execute("CREATE TABLE orders (name TEXT, note TEXT)")
    db.execute("INSERT INTO users (name, note) VALUES ('student', 'обычная запись')")
    db.execute("INSERT INTO users (name, note) VALUES (?, ?)", (HOLDER, FLAG))
    db.execute("INSERT INTO orders (name, note) VALUES ('own', 'свой заказ')")
    db.execute("INSERT INTO orders (name, note) VALUES (?, ?)", (HOLDER, FLAG))
    db.commit()


db = sqlite3.connect(":memory:", check_same_thread=False)

if __name__ == "__main__":
    prepare()
    HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
