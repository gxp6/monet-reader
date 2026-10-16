#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
莫奈阅读器 · 本地服务
=====================

一个只依赖 Python 标准库的本地小服务，为《莫奈阅读器》提供：

  * 静态页面托管（app/ 目录）
  * 书籍存取（library/ 目录，就是普通的 txt 文件，可随时备份/拷贝）
  * 中文编码自动识别（UTF-8 / GBK / GB18030 / BIG5 / UTF-16）
  * EPUB 自动抽取正文（用标准库 zipfile，无需第三方依赖）

启动方式：双击 start.bat，或者在本目录执行 `python server.py`
服务只监听 127.0.0.1（本机），不对外网开放。
"""

import codecs
import json
import os
import re
import shutil
import socket
import sys
import threading
import time
import urllib.parse
import urllib.request
import uuid
import webbrowser
import zipfile
from html import unescape
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(ROOT, "app")
LIB_DIR = os.path.join(ROOT, "library")
BOOKS_DIR = os.path.join(LIB_DIR, "books")
INDEX_FILE = os.path.join(LIB_DIR, "index.json")
PORT_CANDIDATES = [8788, 8789, 8790, 8791, 8899, 9518]

# EPUB 转文本时插入的章节标记，前端解析器认识这个记号。
# 用可见的 ASCII 记号而不是控制字符——控制字符会被 str.strip() 吃掉，也不好排查。
CH_MARK = "@@CH@@"


# --------------------------------------------------------------------------
# 编码识别：中文小说 txt 常见 UTF-8 / GBK，老书还有 BIG5，个别是 UTF-16
# --------------------------------------------------------------------------
def decode_text(data: bytes) -> str:
    """把字节流尽量正确地解码成字符串。"""
    if not data:
        return ""
    for bom, enc in (
        (codecs.BOM_UTF8, "utf-8-sig"),
        (codecs.BOM_UTF16_LE, "utf-16"),
        (codecs.BOM_UTF16_BE, "utf-16"),
        (codecs.BOM_UTF32_LE, "utf-32"),
        (codecs.BOM_UTF32_BE, "utf-32"),
    ):
        if data.startswith(bom):
            try:
                return data.decode(enc)
            except UnicodeDecodeError:
                break

    # 严格 UTF-8 能过就用它（这是现代小说站的标准编码）
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        pass

    # 其余候选：gb18030 覆盖 GBK/GB2312，是简体老书的主流；big5 管繁体
    candidates = []
    for enc in ("gb18030", "big5", "utf-16", "shift_jis", "euc_kr", "latin-1"):
        try:
            text = data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
        candidates.append((_score(text), text))
    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates[0][1]
    return data.decode("utf-8", errors="replace")


def _score(text: str) -> float:
    """给解码结果打分：常见汉字越多越好，替换符和控制字符越少越好。"""
    sample = text[:200000]
    if not sample:
        return 0.0
    good = 0
    bad = 0
    for ch in sample:
        o = ord(ch)
        if 0x4E00 <= o <= 0x9FFF or ch in "　，。！？：；、“”‘’（）《》…—·":
            good += 1
        elif ch == "\ufffd":
            bad += 3
        elif o < 32 and ch not in "\r\n\t":
            bad += 2
        elif 0xE000 <= o <= 0xF8FF:  # 私用区，通常是解错了
            bad += 2
    return (good - bad) / len(sample)


def normalize_text(text: str) -> str:
    """统一换行、去掉 BOM、清掉零宽字符。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\ufeff", "").replace("\u200b", "").replace("\u3000\n", "\n")
    # 收敛过多的空行
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip("\n")


def looks_like_text(text: str) -> str:
    """
    检查这堆字节到底是不是一篇能读的小说。
    返回空字符串表示没问题，否则返回给用户看的原因。
    主要是拦两类东西：把 PDF/图片改了后缀的，以及网页存档。
    """
    sample = text[:100000]
    if len(sample.strip()) < 10:
        return "文件里没有可读的文字"

    if sample.count("\ufffd") / len(sample) > 0.02:
        return "内容里大量字符无法识别，这个文件可能不是纯文本小说"

    printable = sum(1 for ch in sample if ch.isprintable() or ch in "\r\n\t")
    if printable / len(sample) < 0.9:
        return "内容里有太多控制字符，这个文件可能不是纯文本小说"

    # 二进制文件（PDF 头、zip 头之类）即使按 latin-1 解出来也有明显特征
    head = sample[:1200].lstrip()
    if head.startswith(("%PDF", "PK\x03\x04", "\x7fELF", "GIF8", "\xff\xd8\xff")):
        return "这看起来是个二进制文件（PDF/压缩包/图片），不是小说文本"

    # 纯 HTML 网页存档：标签比正文还多
    if head.lower().lstrip().startswith(("<!doctype html", "<html", "<?xml")) and sample.count("<") > 40:
        return "这看起来是网页文件，不是小说文本"

    return ""


# --------------------------------------------------------------------------
# EPUB -> 纯文本
# --------------------------------------------------------------------------
class _HtmlToText(HTMLParser):
    """把 xhtml 转成纯文本，同时把标题变成章节标记。"""

    SKIP = {"script", "style", "head", "title", "meta", "link", "svg"}
    BLOCK = {"p", "div", "br", "li", "tr", "section", "article", "blockquote", "hr"}
    HEAD = {"h1", "h2", "h3", "h4", "h5", "h6"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self._skip_depth = 0
        self._head_buf = None

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self._skip_depth += 1
            return
        if tag in self.HEAD:
            self._head_buf = []
        elif tag in self.BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag in self.HEAD and self._head_buf is not None:
            title = "".join(self._head_buf).strip()
            self._head_buf = None
            if not title:
                return
            # 短的当章节标题（前端会识别 @@CH@@ 记号），太长的就当普通正文保留
            if len(title) <= 60:
                self.parts.append(f"\n\n{CH_MARK}{title}\n\n")
            else:
                self.parts.append(f"\n\n{title}\n\n")
            return
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        if self._skip_depth:
            return
        if self._head_buf is not None:
            self._head_buf.append(data)   # 标题文字只走标记那条路，不要重复进正文
            return
        self.parts.append(data)

    def text(self) -> str:
        raw = "".join(self.parts)
        lines = [re.sub(r"[ \t\u00a0]+", " ", ln).strip() for ln in raw.split("\n")]
        out = []
        for ln in lines:
            if ln.startswith(CH_MARK):
                out.append(ln)
            elif ln:
                out.append(ln)
            elif out and out[-1] != "":
                out.append("")
        return re.sub(r"\n{4,}", "\n\n\n", "\n".join(out)).strip()


def epub_to_text(path: str) -> str:
    """读取 epub，按 spine 顺序拼出正文，每篇开头保留它自己的标题。"""
    with zipfile.ZipFile(path) as zf:
        names = {n.lower(): n for n in zf.namelist()}

        def read(name: str) -> bytes:
            return zf.read(names[name.lower()])

        # 1. container.xml 指出 opf 的位置
        opf_path = None
        try:
            container = read("META-INF/container.xml").decode("utf-8", "ignore")
            m = re.search(r'full-path\s*=\s*"([^"]+)"', container) or re.search(
                r"full-path\s*=\s*'([^']+)'", container
            )
            if m:
                opf_path = m.group(1)
        except (KeyError, UnicodeDecodeError):
            pass
        if not opf_path:
            opf_path = next((n for n in names if n.lower().endswith(".opf")), None)
        if not opf_path:
            raise ValueError("这个 EPUB 里找不到 .opf 文件，可能文件已损坏")

        opf_dir = os.path.dirname(opf_path)
        opf = read(opf_path).decode("utf-8", "ignore")

        # 2. manifest: id -> href
        manifest = {}
        for tag in re.findall(r"<item\b[^>]*/?>", opf, re.I):
            mid = _attr(tag, "id")
            href = _attr(tag, "href")
            media = (_attr(tag, "media-type") or "").lower()
            if mid and href:
                manifest[mid] = (urllib.parse.unquote(href), media)

        # 3. spine: 阅读顺序
        order = [
            _attr(t, "idref")
            for t in re.findall(r"<itemref\b[^>]*/?>", opf, re.I)
        ]
        docs = [manifest[i] for i in order if i in manifest]
        if not docs:
            docs = [(h, m) for h, m in manifest.values() if "html" in m or h.endswith((".xhtml", ".html", ".htm"))]

        chunks = []
        for href, media in docs:
            if not (href.endswith((".xhtml", ".html", ".htm", ".xml")) or "html" in media):
                continue
            full = os.path.normpath(os.path.join(opf_dir, href)).replace("\\", "/")
            key = full.lower()
            if key not in names:
                key = next((n for n in names if n.lower().endswith("/" + href.lower()) or n.lower() == href.lower()), None)
                if not key:
                    continue
            raw = zf.read(names[key])
            doc = decode_text(raw)
            parser = _HtmlToText()
            try:
                parser.feed(doc)
            except Exception:
                pass
            body = parser.text()
            if body:
                chunks.append(body)

        return normalize_text("\n\n".join(chunks))


def _attr(tag: str, name: str):
    m = re.search(name + r'\s*=\s*"([^"]*)"', tag, re.I) or re.search(
        name + r"\s*=\s*'([^']*)'", tag, re.I
    )
    return m.group(1) if m else None


# --------------------------------------------------------------------------
# 书名 / 作者猜测：常见命名 "《书名》作者.txt"、"书名 - 作者.txt"、"书名(作者).txt"
# --------------------------------------------------------------------------
def guess_meta(filename: str):
    stem = re.sub(r"\.(txt|epub|text|md)$", "", filename, flags=re.I).strip()
    stem = re.sub(r"^\s*[\[【(（]\s*(?:全本|完结|精校|校对|无错版|番外)[^\]】)）]*[\]】)）]\s*", "", stem)
    author = ""

    m = re.match(r"^[《<【](.+?)[》>】]\s*[-—·]*\s*([^《<【]{0,20})$", stem)
    if m:
        tail = m.group(2)
        return m.group(1).strip(), (_clean_author(tail) if _looks_like_author(tail) else "")

    for sep in (" - ", " – ", " — ", " by ", "　-　"):
        if sep in stem:
            head, tail = stem.split(sep, 1)
            if head.strip() and _looks_like_author(tail):
                return head.strip(), _clean_author(tail)

    m = re.match(r"^(.+?)\s*[\(（]([^)）]{1,20})[\)）]\s*$", stem)
    if m and _looks_like_author(m.group(2)):
        return m.group(1).strip(), _clean_author(m.group(2))

    m = re.match(r"^[\[【]([^\]】]{1,20})[\]】]\s*(.+)$", stem)
    if m and _looks_like_author(m.group(1)):
        return m.group(2).strip(), _clean_author(m.group(1))

    m = re.match(r"^(.{2,40}?)\s+(?:作者|著)[:：]?\s*(.{0,20})$", stem)
    if m:
        return m.group(1).strip(), _clean_author(m.group(2))

    return stem or filename, author


# 这些不是作者，是文件名里的状态词（"夜航（短篇）"、"XX 全本"）
NOT_AUTHOR = {
    "短篇", "长篇", "中篇", "微型小说", "全本", "全集", "完结", "完结本", "连载", "连载中",
    "精校", "精校版", "校对", "校对版", "未删减", "删减版", "番外", "番外篇", "正文",
    "上部", "下部", "上篇", "下篇", "上", "下", "全", "本", "全一册", "第一部", "第二部",
    "第三部", "网络版", "实体版", "完整版", "修订版", "无错版", "无错字", "精排", "排版",
    "txt", "TXT", "epub", "EPUB", "未校对", "纯爱", "言情", "玄幻", "都市", "悬疑",
}


def _looks_like_author(s: str) -> bool:
    s = (s or "").strip().strip("-—·:：")
    if not s or len(s) > 24:
        return False
    if s in NOT_AUTHOR:
        return False
    if any(c.isdigit() for c in s):
        return False
    if len(s) <= 4 and re.search(r"[版本篇集部卷册季种]$", s):
        return False
    return True


def _clean_author(s: str) -> str:
    s = (s or "").strip().strip("-—·:：")
    s = re.sub(r"^(?:作者|著|by)[:：\s]*", "", s, flags=re.I)
    if s in ("全本", "完结", "全集", "txt", "TXT", "1", "?"):
        return ""
    return s[:30]


# --------------------------------------------------------------------------
# 书库索引读写
# --------------------------------------------------------------------------
_lock = threading.Lock()


def load_index() -> dict:
    if os.path.exists(INDEX_FILE):
        try:
            with open(INDEX_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and isinstance(data.get("books"), list):
                return data
        except (json.JSONDecodeError, OSError):
            pass
    return {"books": [], "version": 1}


def save_index(data: dict) -> None:
    os.makedirs(LIB_DIR, exist_ok=True)
    tmp = INDEX_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, INDEX_FILE)


def book_path(book_id: str) -> str:
    return os.path.join(BOOKS_DIR, book_id + ".txt")


def find_book(index: dict, book_id: str):
    for b in index["books"]:
        if b["id"] == book_id:
            return b
    return None


# --------------------------------------------------------------------------
# HTTP 处理
# --------------------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    server_version = "MonetReader"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    # ---------- 工具 ----------
    def end_headers(self):
        # 本地应用不需要浏览器缓存：改了 app/ 里的文件，刷新就能看到新的
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> bytes:
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return b""
        if n <= 0:
            return b""
        buf = b""
        remaining = n
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 1 << 20))
            if not chunk:
                break
            buf += chunk
            remaining -= len(chunk)
        return buf

    def read_json(self) -> dict:
        try:
            return json.loads(self.read_body().decode("utf-8") or "{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def log_message(self, fmt, *args):
        if os.environ.get("MONET_VERBOSE"):
            sys.stderr.write("  %s\n" % (fmt % args))

    # ---------- 路由 ----------
    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)

        if path == "/api/ping":
            return self.send_json({"ok": True, "app": "monet-reader", "version": 1})

        if path == "/api/library":
            with _lock:
                index = load_index()
            index["books"].sort(key=lambda b: b.get("lastRead") or b.get("addedAt") or 0, reverse=True)
            return self.send_json(index)

        if path == "/api/book":
            book_id = (qs.get("id") or [""])[0]
            return self.serve_book_text(book_id)

        if path.startswith("/api/book/"):
            return self.serve_book_text(urllib.parse.unquote(path[len("/api/book/") :]))

        return super().do_GET()

    def serve_book_text(self, book_id: str):
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", book_id or ""):
            return self.send_json({"error": "非法的书籍 ID"}, 400)
        fp = book_path(book_id)
        if not os.path.exists(fp):
            return self.send_json({"error": "找不到这本书的正文文件"}, 404)
        with open(fp, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        if path == "/api/import":
            return self.api_import()
        if path == "/api/progress":
            return self.api_progress()
        if path == "/api/update":
            return self.api_update()
        if path == "/api/delete":
            return self.api_delete()
        return self.send_json({"error": "未知接口"}, 404)

    # ---------- 接口实现 ----------
    def api_import(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        filename = urllib.parse.unquote((qs.get("name") or ["未命名.txt"])[0])
        data = self.read_body()
        if not data:
            return self.send_json({"error": "没有收到文件内容"}, 400)
        if len(data) > 200 * 1024 * 1024:
            return self.send_json({"error": "文件太大了（上限 200MB）"}, 413)

        os.makedirs(BOOKS_DIR, exist_ok=True)
        ext = os.path.splitext(filename)[1].lower().lstrip(".")
        note = ""
        try:
            if ext == "epub":
                tmp = os.path.join(BOOKS_DIR, "_tmp.epub")
                with open(tmp, "wb") as f:
                    f.write(data)
                try:
                    text = epub_to_text(tmp)
                finally:
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                note = "已从 EPUB 提取正文"
            else:
                text = normalize_text(decode_text(data))
        except Exception as exc:  # noqa: BLE001
            return self.send_json({"error": "解析失败：%s" % exc}, 400)

        text = normalize_text(text)
        problem = looks_like_text(text)
        if problem:
            return self.send_json({"error": problem}, 400)

        title, author = guess_meta(filename)

        # 同名的书不重复导入，直接把正文更新掉
        with _lock:
            index = load_index()
            dup = next((b for b in index["books"] if b["title"] == title and b.get("author", "") == author), None)

        book_id = dup["id"] if dup else "b" + uuid.uuid4().hex[:12]
        with open(book_path(book_id), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)

        now = time.time()
        meta = dup or {
            "id": book_id,
            "title": title,
            "author": author,
            "ext": ext or "txt",
            "addedAt": now,
            "progress": {"chapter": 0, "ratio": 0.0, "at": 0},
        }
        meta.update({"chars": len(text), "size": os.path.getsize(book_path(book_id))})
        if dup:
            meta["updatedAt"] = now

        with _lock:
            index = load_index()
            books = [b for b in index["books"] if b["id"] != book_id]
            books.append(meta)
            index["books"] = books
            save_index(index)

        meta["note"] = ("这本书之前导入过，正文已更新。" if dup else note) or "导入成功"
        meta["duplicated"] = bool(dup)
        return self.send_json(meta)

    def api_progress(self):
        payload = self.read_json()
        book_id = payload.get("id")
        with _lock:
            index = load_index()
            book = find_book(index, book_id)
            if not book:
                return self.send_json({"error": "找不到这本书"}, 404)
            book["progress"] = {
                "chapter": int(payload.get("chapter") or 0),
                "ratio": float(payload.get("ratio") or 0.0),
                "at": time.time(),
            }
            # 章节数由前端解析后回报，书架上的进度条要用它算百分比
            if payload.get("chapterCount"):
                try:
                    book["chapterCount"] = int(payload["chapterCount"])
                except (TypeError, ValueError):
                    pass
            book["lastRead"] = time.time()
            save_index(index)
        return self.send_json({"ok": True})

    def api_update(self):
        payload = self.read_json()
        with _lock:
            index = load_index()
            book = find_book(index, payload.get("id"))
            if not book:
                return self.send_json({"error": "找不到这本书"}, 404)
            for key in ("title", "author"):
                if payload.get(key) is not None:
                    book[key] = str(payload[key]).strip()[:80]
            save_index(index)
        return self.send_json({"ok": True, "book": book})

    def api_delete(self):
        payload = self.read_json()
        book_id = payload.get("id")
        with _lock:
            index = load_index()
            book = find_book(index, book_id)
            index["books"] = [b for b in index["books"] if b["id"] != book_id]
            save_index(index)
        if book and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", book_id or ""):
            try:
                os.remove(book_path(book_id))
            except OSError:
                pass
        return self.send_json({"ok": True})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # Windows 上 SO_REUSEADDR 会让第二个进程也能绑上同一个端口，
    # 结果两个服务来回抢请求、还会同时写 index.json。宁可让后来的绑定失败。
    allow_reuse_address = False


# --------------------------------------------------------------------------
# 启动
# --------------------------------------------------------------------------
def already_running(port: int) -> bool:
    """这个端口上是不是已经跑着一个本程序？"""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/ping" % port, timeout=0.8) as res:
            info = json.loads(res.read().decode("utf-8"))
        return info.get("app") == "monet-reader"
    except Exception:  # noqa: BLE001
        return False


def pick_port():
    """返回 (端口, 是否已经有实例在跑)。"""
    for port in PORT_CANDIDATES:
        if already_running(port):
            return port, True
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port, False
            except OSError:
                continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1], False


def find_browser():
    """优先拿 Edge/Chrome，用来开一个没有地址栏的独立窗口。"""
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.join(local, r"Google\Chrome\Application\chrome.exe"),
        os.path.join(local, r"Microsoft\Edge\Application\msedge.exe"),
    ]
    for path in candidates:
        if path and os.path.exists(path):
            return path
    return None


def open_window(url: str):
    browser = find_browser()
    if browser:
        import subprocess

        profile = os.path.join(ROOT, ".runtime", "profile")
        os.makedirs(profile, exist_ok=True)
        try:
            subprocess.Popen(
                [
                    browser,
                    "--app=" + url,
                    "--user-data-dir=" + profile,
                    "--window-size=1180,820",
                    "--no-first-run",
                    "--no-default-browser-check",
                ],
                close_fds=True,
            )
            return True
        except OSError:
            pass
    try:
        webbrowser.open(url)
        return True
    except Exception:  # noqa: BLE001
        return False


BANNER = r"""
  +----------------------------------------------+
  |   莫奈阅读器  ·  Monet Reader                |
  |   本地小说阅读器，数据全部存在你自己电脑上    |
  +----------------------------------------------+
  服务地址 : http://127.0.0.1:{port}
  书架目录 : {lib}
  关闭本窗口即退出程序（Ctrl+C 也可以）
"""


def say(text: str) -> None:
    """打印中文——控制台能直接显示；输出被重定向到文件时编码不支持也不会崩。"""
    try:
        print(text)
    except UnicodeEncodeError:
        enc = getattr(sys.stdout, "encoding", None) or "ascii"
        sys.stdout.write(text.encode(enc, "replace").decode(enc, "replace") + "\n")


def main():
    os.makedirs(BOOKS_DIR, exist_ok=True)
    port, running = pick_port()
    url = "http://127.0.0.1:%d/" % port

    if running:
        say("\n  程序已经在运行了，直接把窗口打开。")
        if not os.environ.get("MONET_NO_OPEN"):
            open_window(url)
        return 0

    try:
        httpd = Server(("127.0.0.1", port), Handler)
    except OSError as exc:
        say("启动失败：端口被占用（%s）" % exc)
        try:
            input("按回车键退出…")
        except EOFError:
            pass
        return 1

    say(BANNER.format(port=port, lib=LIB_DIR))
    if not os.environ.get("MONET_NO_OPEN"):
        threading.Timer(0.6, open_window, args=(url,)).start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        say("\n已退出，再见。")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
