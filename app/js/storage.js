/* ==========================================================================
   存储层
   有两种后端，自动选择：
     http —— 由 server.py 提供接口，书存在 library/ 文件夹里（推荐）
     idb  —— 浏览器内置数据库，直接双击 index.html 打开时用这个
   两者对上层暴露完全一样的方法。
   ========================================================================== */

const Store = (() => {
  let mode = 'idb';
  let db = null;

  /* ── IndexedDB 后端 ────────────────────────────────────────────────── */
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('monet-reader', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('texts')) d.createObjectStore('texts');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  function get(store, key) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readonly');
      const req = t.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function getAll(store) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readonly');
      const req = t.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /* ── 初始化：能连上本地服务就用文件存储 ──────────────────────────── */
  async function init() {
    if (location.protocol !== 'file:') {
      try {
        const res = await fetch('/api/ping', { cache: 'no-store' });
        if (res.ok) {
          const info = await res.json();
          if (info && info.app === 'monet-reader') {
            mode = 'http';
            return mode;
          }
        }
      } catch (_) { /* 没有服务，走 idb */ }
    }
    db = await openDB();
    mode = 'idb';
    return mode;
  }

  /* ── 统一接口 ─────────────────────────────────────────────────────── */
  async function list() {
    if (mode === 'http') {
      const res = await fetch('/api/library', { cache: 'no-store' });
      if (!res.ok) throw new Error('读取书架失败');
      const data = await res.json();
      return data.books || [];
    }
    const books = await getAll('books');
    return books.sort((a, b) => (b.lastRead || b.addedAt || 0) - (a.lastRead || a.addedAt || 0));
  }

  async function readText(id) {
    if (mode === 'http') {
      const res = await fetch('/api/book/' + encodeURIComponent(id), { cache: 'no-store' });
      if (!res.ok) throw new Error('读取正文失败');
      return res.text();
    }
    const text = await get('texts', id);
    if (text == null) throw new Error('这本书的正文不见了');
    return text;
  }

  /** 导入一个 File 对象（.txt / .epub），返回书籍元信息 */
  async function importFile(file) {
    if (mode === 'http') {
      const res = await fetch('/api/import?name=' + encodeURIComponent(file.name), {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '导入失败');
      return data;
    }

    // 浏览器模式：自己解码（试试 UTF-8，坏了就换 GBK）
    const buf = await file.arrayBuffer();
    const text = decodeBytesForBrowser(buf);
    if (!text || text.trim().length < 10) throw new Error('这本书里没有可读的文字');
    if ((text.match(/\ufffd/g) || []).length / text.length > 0.02) {
      throw new Error('内容里大量字符无法识别，这个文件可能不是纯文本小说');
    }

    const meta = guessMetaForBrowser(file.name);
    const id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const book = {
      id,
      title: meta.title,
      author: meta.author,
      ext: (file.name.split('.').pop() || 'txt').toLowerCase(),
      size: file.size,
      chars: text.length,
      addedAt: Date.now() / 1000,
      progress: { chapter: 0, ratio: 0, at: 0 },
    };
    await tx('texts', (s) => s.put(text, id));
    await tx('books', (s) => s.put(book));
    book.note = '导入成功';
    return book;
  }

  function decodeBytesForBrowser(buf) {
    const bytes = new Uint8Array(buf);
    const tryDecode = (label) => {
      try { return new TextDecoder(label, { fatal: false }).decode(bytes); }
      catch (_) { return null; }
    };
    // 有 BOM 先按 BOM 来
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return tryDecode('utf-8').slice(1);
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return tryDecode('utf-16le');
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return tryDecode('utf-16be');

    const utf8 = tryDecode('utf-8');
    const bad = utf8 ? (utf8.match(/\ufffd/g) || []).length : Infinity;
    if (utf8 && bad / Math.max(1, utf8.length) < 0.0005) return utf8;

    const gbk = tryDecode('gb18030');
    const badGbk = gbk ? (gbk.match(/\ufffd/g) || []).length : Infinity;
    if (gbk && badGbk < bad) return gbk;
    return utf8 || gbk || '';
  }

  function guessMetaForBrowser(name) {
    const stem = name.replace(/\.(txt|epub|text|md)$/i, '').trim();
    let m = stem.match(/^[《<【](.+?)[》>】]\s*[-—·]*\s*(.{0,20})$/);
    if (m) return { title: m[1].trim(), author: m[2].replace(/^(作者|著)[:：\s]*/, '').trim() };
    m = stem.match(/^(.+?)\s*[-–—]\s*(.+)$/);
    if (m) return { title: m[1].trim(), author: m[2].trim() };
    m = stem.match(/^(.+?)\s*[（(]([^）)]{1,20})[）)]$/);
    if (m) return { title: m[1].trim(), author: m[2].trim() };
    return { title: stem || name, author: '' };
  }

  async function saveProgress(id, chapter, ratio, chapterCount) {
    const patch = { chapter, ratio, at: Date.now() / 1000, lastRead: Date.now() / 1000 };
    if (chapterCount) patch.chapterCount = chapterCount;
    if (mode === 'http') {
      await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      return patch;
    }
    const book = await get('books', id);
    if (book) {
      book.progress = { chapter, ratio, at: patch.at };
      book.lastRead = patch.lastRead;
      if (chapterCount) book.chapterCount = chapterCount;
      await tx('books', (s) => s.put(book));
    }
    return patch;
  }

  async function update(id, fields) {
    if (mode === 'http') {
      const res = await fetch('/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...fields }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '保存失败');
      return data.book;
    }
    const book = await get('books', id);
    if (!book) throw new Error('找不到这本书');
    Object.assign(book, fields);
    await tx('books', (s) => s.put(book));
    return book;
  }

  async function remove(id) {
    if (mode === 'http') {
      await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      return;
    }
    await tx('texts', (s) => s.delete(id));
    await tx('books', (s) => s.delete(id));
  }

  return {
    init,
    list,
    readText,
    importFile,
    saveProgress,
    update,
    remove,
    get mode() { return mode; },
  };
})();
