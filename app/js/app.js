/* ==========================================================================
   莫奈阅读器 · 主程序
   ========================================================================== */

const App = (() => {
  'use strict';

  /* ── 阅读设置 ──────────────────────────────────────────────────────── */
  const FONTS = {
    serif:    '"Songti SC", SimSun, "Source Han Serif SC", "Noto Serif SC", Georgia, serif',
    kai:      'KaiTi, "Kaiti SC", STKaiti, "楷体", serif',
    hei:      '"Microsoft YaHei", "PingFang SC", "HarmonyOS Sans SC", sans-serif',
    deng:     'DengXian, "等线", "Microsoft YaHei", sans-serif',
    fangsong: 'FangSong, STFangsong, "仿宋", serif',
  };

  const DEFAULTS = {
    theme: 'lilies',
    font: 'serif',
    size: 19,
    lh: 1.9,
    width: 760,
    ls: 0.02,
    indent: true,
    flip: true,
    immersive: true,
  };

  const THEMES = ['lilies', 'mist', 'hay', 'night'];

  let settings = { ...DEFAULTS };

  function loadSettings() {
    try {
      const raw = localStorage.getItem('monet.settings');
      if (raw) settings = { ...DEFAULTS, ...JSON.parse(raw) };
    } catch (_) { /* 首次运行 */ }
  }

  function saveSettings() {
    try { localStorage.setItem('monet.settings', JSON.stringify(settings)); } catch (_) {}
  }

  function applySettings() {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.style.setProperty('--font-serif', FONTS[settings.font] || FONTS.serif);
    root.style.setProperty('--font-size', settings.size + 'px');
    root.style.setProperty('--line-height', settings.lh);
    root.style.setProperty('--page-width', settings.width + 'px');
    root.style.setProperty('--letter-spacing', settings.ls + 'em');

    const content = $('#readerContent');
    content.classList.toggle('no-indent', !settings.indent);

    // 设置面板里的控件同步
    setVal('#set-font', settings.font);
    setVal('#set-size', settings.size);
    setVal('#set-lh', settings.lh);
    setVal('#set-width', settings.width);
    setVal('#set-ls', settings.ls);
    $('#val-size').textContent = settings.size;
    $('#val-lh').textContent = Number(settings.lh).toFixed(2).replace(/0$/, '');
    $('#val-width').textContent = settings.width;
    $('#val-ls').textContent = Number(settings.ls).toFixed(2);
    $('#set-indent').checked = settings.indent;
    $('#set-flip').checked = settings.flip;
    $('#set-immersive').checked = settings.immersive;
    $$('#set-theme .swatch').forEach((b) => b.classList.toggle('on', b.dataset.theme === settings.theme));
  }

  function setVal(sel, v) {
    const el = $(sel);
    if (el) el.value = v;
  }

  /* ── 小工具 ────────────────────────────────────────────────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function toast(msg, bad = false) {
    const t = el('div', 'toast' + (bad ? ' bad' : ''), Parser.esc(String(msg)));
    $('#toasts').appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s, transform .3s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      setTimeout(() => t.remove(), 320);
    }, bad ? 4200 : 2400);
  }

  function fmtNum(n) {
    if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1) + ' 万字';
    return n + ' 字';
  }

  function fmtWhen(ts) {
    if (!ts) return '';
    const d = new Date(ts * 1000);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 3600) return '刚才';
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  }

  /* ── 状态 ──────────────────────────────────────────────────────────── */
  let books = [];
  let shelfFilter = '';
  let editing = null;

  const reader = {
    meta: null,
    text: '',
    chapters: [],
    index: 0,
    saveTimer: 0,
    hideTimer: 0,
  };

  /* ══════════════════════════ 书  架 ══════════════════════════ */
  async function refreshShelf() {
    try {
      books = await Store.list();
    } catch (e) {
      toast(e.message || '读取书架失败', true);
      books = [];
    }
    renderShelf();
  }

  function progressOf(book) {
    const p = book.progress || {};
    const ch = Number(p.chapter) || 0;
    const ratio = Number(p.ratio) || 0;
    const total = Number(book.chapterCount) || 0;
    const started = ch > 0 || ratio > 0.001;
    if (!total) {
      return { percent: 0, chapter: ch, ratio, started, unknownTotal: true };
    }
    return { percent: Math.min(1, (ch + ratio) / total), chapter: ch, ratio, started, unknownTotal: false };
  }

  function renderShelf() {
    const grid = $('#bookGrid');
    const empty = $('#shelfEmpty');
    grid.innerHTML = '';

    const q = shelfFilter.trim().toLowerCase();
    const shown = q
      ? books.filter((b) => (b.title || '').toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q))
      : books;

    empty.hidden = books.length > 0;

    // 「继续阅读」大卡片：最近读的那本
    const last = books.find((b) => b.lastRead) || books[0];
    if (last && !q) grid.appendChild(heroCard(last));

    for (const b of shown) grid.appendChild(bookCard(b));

    if (books.length && q && !shown.length) {
      grid.appendChild(el('p', 'muted', `没有找到和「${Parser.esc(shelfFilter)}」有关的书`));
    }
  }

  function heroCard(book) {
    const wrap = el('div', 'hero');
    wrap.style.gridColumn = '1 / -1';

    const cover = el('div', 'hero-cover');
    cover.appendChild(coverEl(book, '100%'));

    const prog = progressOf(book);
    const body = el('div', 'hero-body');
    body.appendChild(el('div', 'hero-eyebrow', prog.started ? '继续阅读' : '开始阅读'));
    body.appendChild(el('div', 'hero-title', Parser.esc(book.title)));
    const bits = [book.author, fmtNum(book.chars || 0)];
    if (prog.started) {
      bits.push(`读到第 ${prog.chapter + 1} 章`);
      if (!prog.unknownTotal) bits.push(`已读 ${Math.round(prog.percent * 100)}%`);
    }
    body.appendChild(el('div', 'hero-meta', Parser.esc(bits.filter(Boolean).join(' · '))));

    const actions = el('div', 'hero-actions');
    const btn = el('button', 'btn btn-primary', prog.started ? '继续阅读' : '开始阅读');
    btn.onclick = () => openBook(book.id);
    const btn2 = el('button', 'btn btn-ghost', '目录');
    btn2.onclick = () => openBook(book.id, { showToc: true });
    actions.append(btn, btn2);

    wrap.append(cover, body, actions);
    wrap.onclick = (e) => { if (e.target === wrap) openBook(book.id); };
    return wrap;
  }

  function coverEl(book, noAspect) {
    const art = Covers.svg(book.title, book.author);
    const box = el('div', 'card-cover');
    if (noAspect) box.style.cssText = 'aspect-ratio:3/4;width:100%';

    const bg = el('div', 'cover-art');
    bg.innerHTML = art.markup;

    const spine = el('div', 'cover-spine');
    const title = el('div', 'cover-title');
    title.appendChild(el('b', null, Parser.esc(book.title)));
    if (book.author) title.appendChild(el('i', null, Parser.esc(book.author)));
    title.style.setProperty('--cover-ink', art.ink);

    const prog = progressOf(book);
    box.append(bg, spine, title);

    if (!prog.unknownTotal && prog.percent > 0.001 && prog.percent < 0.999) {
      const bar = el('div', 'cover-progress');
      bar.appendChild(el('span')).style.width = (prog.percent * 100).toFixed(1) + '%';
      box.appendChild(bar);
    }
    return box;
  }

  function bookCard(book) {
    const card = el('div', 'card');
    card.tabIndex = 0;

    const cover = coverEl(book);
    card.appendChild(cover);

    const info = el('div', 'card-info');
    info.appendChild(el('b', null, Parser.esc(book.title)));
    info.appendChild(el('i', null, Parser.esc([book.author, fmtWhen(book.lastRead)].filter(Boolean).join(' · ') || '未读')));
    card.appendChild(info);

    const tools = el('div', 'card-tools');
    const edit = el('button', null, '✎');
    edit.title = '书籍信息';
    edit.onclick = (e) => { e.stopPropagation(); openModal(book); };
    tools.appendChild(edit);
    cover.appendChild(tools);

    const open = () => openBook(book.id);
    card.onclick = open;
    card.onkeydown = (e) => { if (e.key === 'Enter') open(); };
    return card;
  }

  /* ══════════════════════════ 导  入 ══════════════════════════ */
  async function importFiles(files) {
    const list = Array.from(files || []).filter((f) => /\.(txt|text|epub|md)$/i.test(f.name));
    if (!list.length) {
      toast('只认识 .txt 和 .epub 文件', true);
      return;
    }
    let ok = 0;
    for (const f of list) {
      toast(`正在导入《${f.name.replace(/\.[^.]+$/, '')}》…`);
      try {
        const meta = await Store.importFile(f);
        ok += 1;
        toast(`《${meta.title}》${meta.duplicated ? '正文已更新' : '已放进书架'}${meta.note && !meta.duplicated ? '' : ''}`);
      } catch (e) {
        toast(`《${f.name}》导入失败：${e.message}`, true);
      }
    }
    if (ok) await refreshShelf();
  }

  /* ══════════════════════════ 阅读器 ══════════════════════════ */
  async function openBook(id, opts = {}) {
    const meta = books.find((b) => b.id === id);
    if (!meta) return;

    let text;
    try {
      toast('正在打开…');
      text = await Store.readText(id);
    } catch (e) {
      toast(e.message || '打不开这本书', true);
      return;
    }

    reader.meta = meta;
    reader.text = text;
    reader.chapters = Parser.parseChapters(text);
    meta.chapterCount = reader.chapters.length;

    const saved = meta.progress || {};
    reader.index = Math.min(Math.max(0, Number(saved.chapter) || 0), reader.chapters.length - 1);

    $('#rdBook').textContent = meta.title;
    $('#viewShelf').hidden = true;
    $('#viewReader').hidden = false;
    closeAll();

    buildToc();
    renderChapter(reader.index, { ratio: Number(saved.ratio) || 0, quiet: true });

    // 记下章节数和"最近在读"，书架的进度条靠它算百分比
    Store.saveProgress(meta.id, reader.index, Number(saved.ratio) || 0, reader.chapters.length).catch(() => {});
    meta.lastRead = Date.now() / 1000;

    if (opts.showToc) openDrawer('#drawerToc');
    if (opts.find) openFind();
  }

  function closeReader() {
    flushProgress();
    $('#viewReader').hidden = true;
    $('#viewShelf').hidden = false;
    reader.meta = null;
    reader.text = '';
    reader.chapters = [];
    closeAll();
    refreshShelf();
  }

  function renderChapter(index, opts = {}) {
    const ch = reader.chapters[index];
    if (!ch) return;
    reader.index = index;

    const body = Parser.chapterText(reader.text, ch);
    const content = $('#readerContent');
    const heading = ch.title && !ch.sub ? `<h2 class="rd-chapter">${Parser.esc(ch.title)}</h2>` : (ch.sub ? `<h2 class="rd-chapter">${Parser.esc(ch.title)}</h2>` : '');
    content.innerHTML = heading + Parser.renderBody(body);
    $('#chapterEnd').hidden = index >= reader.chapters.length - 1;

    $('#rdChapter').textContent = ch.title;
    document.title = `${ch.title} · ${reader.meta.title}`;

    const area = $('#readingArea');
    area.classList.remove('hide-bar');

    requestAnimationFrame(() => {
      const max = Math.max(0, area.scrollHeight - area.clientHeight);
      area.scrollTop = opts.offset != null ? Math.max(0, opts.offset) : max > 0 ? max * (opts.ratio || 0) : 0;
      updateProgress();
      if (opts.highlight) highlight(content, opts.highlight, opts.offset != null);
    });

    markToc();
    if (!opts.quiet) scheduleSave();
  }

  function goChapter(delta, opts = {}) {
    const next = reader.index + delta;
    if (next < 0) { toast('已经是第一章了'); return; }
    if (next >= reader.chapters.length) { toast('已经是最后一章了'); return; }
    renderChapter(next, { ratio: 0, highlight: opts.highlight });
  }

  function updateProgress() {
    const area = $('#readingArea');
    const max = Math.max(1, area.scrollHeight - area.clientHeight);
    const ratio = Math.min(1, Math.max(0, area.scrollTop / max));
    const total = reader.chapters.length;
    const pct = Math.min(100, ((reader.index + ratio) / Math.max(1, total)) * 100);

    $('#rdProgress').style.width = pct.toFixed(2) + '%';
    $('#rdStatus').textContent = `第 ${reader.index + 1} / ${total} 章 · 全书 ${pct.toFixed(1)}%`;
    $('#rdChapter').textContent = reader.chapters[reader.index]
      ? reader.chapters[reader.index].title
      : '';
    return { ratio, pct };
  }

  function scheduleSave() {
    clearTimeout(reader.saveTimer);
    reader.saveTimer = setTimeout(flushProgress, 650);
  }

  function flushProgress() {
    clearTimeout(reader.saveTimer);
    if (!reader.meta || !reader.meta.id || !reader.chapters.length) return;
    const area = $('#readingArea');
    const max = Math.max(1, area.scrollHeight - area.clientHeight);
    const ratio = Math.min(1, Math.max(0, area.scrollTop / max));
    const index = reader.index;
    reader.meta.progress = { chapter: index, ratio, at: Date.now() / 1000 };
    reader.meta.lastRead = Date.now() / 1000;
    reader.meta.chapterCount = reader.chapters.length;
    Store.saveProgress(reader.meta.id, index, ratio, reader.chapters.length).catch(() => {});
  }

  /* ── 目录 ──────────────────────────────────────────────────────────── */
  function buildToc() {
    const list = $('#tocList');
    list.innerHTML = '';
    reader.chapters.forEach((ch, i) => {
      const btn = el('button', 'toc-item', `<span>${i + 1}</span>${Parser.esc(ch.title)}`);
      btn.onclick = () => {
        closeDrawer('#drawerToc');
        renderChapter(i, { ratio: 0 });
      };
      list.appendChild(btn);
    });
    $('#tocCount').textContent = `共 ${reader.chapters.length} 章`;
  }

  function markToc() {
    const list = $('#tocList');
    const items = $$('.toc-item', list);
    items.forEach((n, i) => n.classList.toggle('on', i === reader.index));
    const on = items[reader.index];
    if (on) {
      const top = on.offsetTop;
      const lt = list.scrollTop;
      const lb = lt + list.clientHeight;
      if (top < lt + 40 || top + on.offsetHeight > lb - 40) {
        list.scrollTop = top - list.clientHeight / 2 + on.offsetHeight / 2;
      }
    }
  }

  /* ── 全书搜索 ──────────────────────────────────────────────────────── */
  let findTimer = 0;

  function openFind() {
    closeDrawers();
    $('#findPanel').hidden = false;
    showScrim(false);
    setTimeout(() => $('#findInput').focus(), 40);
  }

  function closeFind() {
    $('#findPanel').hidden = true;
    $('#findResults').innerHTML = '';
    $('#findInput').value = '';
  }

  function runFind() {
    const q = $('#findInput').value.trim();
    const box = $('#findResults');
    box.innerHTML = '';
    if (!q) return;

    const hits = Parser.search(reader.text, reader.chapters, q, 200);
    if (!hits.length) {
      box.appendChild(el('div', 'none', `全书没有出现「${Parser.esc(q)}」`));
      return;
    }
    for (const h of hits) {
      const item = el('button', 'find-hit');
      item.appendChild(el('div', 'ch', `第 ${h.chapter + 1} 章 · ${Parser.esc(h.chapterTitle)}`));
      const snip = el('div', 'sn', '…' + Parser.esc(h.before) + `<mark>${Parser.esc(h.match)}</mark>` + Parser.esc(h.after) + '…');
      item.appendChild(snip);
      item.onclick = () => {
        const ch = reader.chapters[h.chapter];
        closeFind();
        renderChapter(h.chapter, {
          offset: 0,
          highlight: q,
          focusOffset: h.offset - ch.bodyStart,
        });
        // 精确定位到命中的那一段
        requestAnimationFrame(() => {
          const content = $('#readerContent');
          const off = h.offset - ch.bodyStart;
          let best = null;
          $$('p[data-o]', content).forEach((p) => {
            const o = Number(p.dataset.o);
            if (o <= off && (!best || o > Number(best.dataset.o))) best = p;
          });
          if (best) best.scrollIntoView({ block: 'center' });
          updateProgress();
        });
      };
      box.appendChild(item);
    }
  }

  /** 在当前渲染出的章节里给关键词加底色 */
  function highlight(root, query, _) {
    if (!query) return;
    const needle = query.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const targets = [];
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (n.nodeValue && n.nodeValue.toLowerCase().includes(needle) && n.parentElement.tagName !== 'MARK') {
        targets.push(n);
      }
    }
    const hits = [];
    for (const node of targets) {
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      let from = 0;
      for (;;) {
        const at = text.toLowerCase().indexOf(needle, from);
        if (at < 0) break;
        frag.appendChild(document.createTextNode(text.slice(from, at)));
        const m = el('mark', 'hit', Parser.esc(text.slice(at, at + query.length)));
        frag.appendChild(m);
        hits.push(m);
        from = at + query.length;
      }
      frag.appendChild(document.createTextNode(text.slice(from)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  /* ══════════════════════════ 抽屉 / 弹层 ══════════════════════════ */
  function showScrim(on) {
    $('#scrim').hidden = !on;
  }

  function openDrawer(sel, scrim = true) {
    closeDrawers();
    const d = $(sel);
    d.hidden = false;
    if (sel === '#drawerToc') markToc();
    showScrim(scrim);
  }

  function closeDrawer(sel) {
    const d = $(sel);
    if (d) d.hidden = true;
    if ($('#drawerToc').hidden && $('#drawerSettings').hidden) showScrim(false);
  }

  function closeDrawers() {
    $$('.drawer').forEach((d) => (d.hidden = true));
  }

  function closeAll() {
    closeDrawers();
    closeFind();
    $('#modal').hidden = true;
    showScrim(false);
    syncScrim();
  }

  function syncScrim() {
    const any = $$('.drawer').some((d) => !d.hidden) || !$('#modal').hidden;
    showScrim(any);
  }

  /* ── 书籍信息弹窗 ──────────────────────────────────────────────────── */
  function openModal(book) {
    editing = book;
    $('#mdTitle').value = book.title || '';
    $('#mdAuthor').value = book.author || '';
    $('#modal').hidden = false;
    syncScrim();
    setTimeout(() => $('#mdTitle').focus(), 40);
  }

  async function saveModal() {
    if (!editing) return;
    const title = $('#mdTitle').value.trim() || '未命名';
    const author = $('#mdAuthor').value.trim();
    try {
      await Store.update(editing.id, { title, author });
      toast('已保存');
    } catch (e) {
      toast(e.message || '保存失败', true);
    }
    $('#modal').hidden = true;
    editing = null;
    syncScrim();
    await refreshShelf();
  }

  async function deleteEditing() {
    if (!editing) return;
    const book = editing;
    $('#modal').hidden = true;
    editing = null;
    syncScrim();
    try {
      await Store.remove(book.id);
      toast(`已把《${book.title}》移出书架`);
    } catch (e) {
      toast(e.message || '删除失败', true);
    }
    await refreshShelf();
  }

  /* ══════════════════════════ 键盘 ══════════════════════════ */
  function onKey(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

    if (e.key === 'Escape') {
      if (!$('#findPanel').hidden) return closeFind();
      if (!$('#modal').hidden) { $('#modal').hidden = true; editing = null; syncScrim(); return; }
      if ($$('.drawer').some((d) => !d.hidden)) return closeAll();
      if (!$('#viewReader').hidden) return closeReader();
      return;
    }

    if (typing) return;
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'c') { cycleTheme(); return; }
      if (!$('#viewReader').hidden) {
        if (k === 't') { e.preventDefault(); return toggleDrawer('#drawerToc'); }
        if (k === 's') { e.preventDefault(); return toggleDrawer('#drawerSettings'); }
        if (k === 'f') { e.preventDefault(); return openFind(); }
      }
    }
    if (!$('#viewReader').hidden && $('#modal').hidden && $('#findPanel').hidden && !$$('.drawer').some((d) => !d.hidden)) {
      const area = $('#readingArea');
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        if (settings.flip) pageTurn(1); else goChapter(1);
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        if (settings.flip) pageTurn(-1); else goChapter(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault(); area.scrollTop += 88;
      } else if (e.key === 'ArrowUp') {
        e.preventDefault(); area.scrollTop -= 88;
      } else if (e.key === 'Home') {
        e.preventDefault(); area.scrollTop = 0;
      } else if (e.key === 'End') {
        e.preventDefault(); area.scrollTop = area.scrollHeight;
      } else if (e.key === '[' || e.key === ',') {
        e.preventDefault(); goChapter(-1);
      } else if (e.key === ']' || e.key === '.') {
        e.preventDefault(); goChapter(1);
      }
    }
  }

  /** 翻一屏；到边界就顺势翻章 */
  function pageTurn(dir) {
    const area = $('#readingArea');
    const step = Math.max(120, area.clientHeight - 96);
    const max = area.scrollHeight - area.clientHeight;
    if (dir > 0 && area.scrollTop >= max - 24) { goChapter(1); return; }
    if (dir < 0 && area.scrollTop <= 24) { goChapter(-1); return; }
    area.scrollTo({ top: area.scrollTop + step * dir, behavior: 'smooth' });
  }

  function cycleTheme() {
    const i = THEMES.indexOf(settings.theme);
    settings.theme = THEMES[(i + 1) % THEMES.length];
    saveSettings();
    applySettings();
    const names = { lilies: '睡莲', mist: '晨雾', hay: '干草堆', night: '夜桥' };
    toast('配色：' + names[settings.theme]);
  }

  function toggleDrawer(sel) {
    const d = $(sel);
    if (d.hidden) openDrawer(sel); else closeDrawer(sel);
  }

  /* ══════════════════════════ 事件绑定 ══════════════════════════ */
  function bind() {
    $('#btnImport').onclick = () => $('#filePicker').click();
    $('#btnImport2').onclick = () => $('#filePicker').click();
    $('#filePicker').onchange = (e) => {
      importFiles(e.target.files);
      e.target.value = '';
    };

    $('#shelfSearch').oninput = (e) => {
      shelfFilter = e.target.value;
      renderShelf();
    };

    $('#btnPalette').onclick = cycleTheme;
    $('#btnPalette2').onclick = cycleTheme;

    $('#btnBack').onclick = closeReader;
    $('#btnToc').onclick = () => toggleDrawer('#drawerToc');
    $('#btnAa').onclick = () => toggleDrawer('#drawerSettings');
    $('#btnFind').onclick = openFind;

    $('#btnPrev').onclick = () => goChapter(-1);
    $('#btnNext').onclick = () => goChapter(1);
    $('#btnNextAtEnd').onclick = () => goChapter(1);

    $$('[data-close]').forEach((b) => {
      b.onclick = () => {
        const sel = '#' + b.dataset.close;
        if (sel === '#modal') { $('#modal').hidden = true; editing = null; syncScrim(); }
        else if (sel === '#findPanel') closeFind();
        else closeDrawer(sel);
      };
    });

    $('#scrim').onclick = closeAll;
    $('#mdSave').onclick = saveModal;
    $('#mdDelete').onclick = deleteEditing;

    // 设置面板
    $('#set-theme').onclick = (e) => {
      const b = e.target.closest('.swatch');
      if (!b) return;
      settings.theme = b.dataset.theme;
      saveSettings();
      applySettings();
    };
    $('#set-font').onchange = (e) => { settings.font = e.target.value; saveSettings(); applySettings(); };
    const live = (sel, key, transform) => {
      $(sel).oninput = (e) => {
        settings[key] = transform ? transform(e.target.value) : e.target.value;
        saveSettings();
        applySettings();
      };
    };
    live('#set-size', 'size', Number);
    live('#set-lh', 'lh', Number);
    live('#set-width', 'width', Number);
    live('#set-ls', 'ls', Number);
    $('#set-indent').onchange = (e) => { settings.indent = e.target.checked; saveSettings(); applySettings(); };
    $('#set-flip').onchange = (e) => { settings.flip = e.target.checked; saveSettings(); applySettings(); };
    $('#set-immersive').onchange = (e) => { settings.immersive = e.target.checked; saveSettings(); applySettings(); };
    $('#btnReset').onclick = () => {
      settings = { ...DEFAULTS };
      saveSettings();
      applySettings();
      toast('已恢复默认设置');
    };

    // 阅读区滚动
    const area = $('#readingArea');
    area.addEventListener('scroll', () => {
      updateProgress();
      scheduleSave();
      if (!settings.immersive) return;
      const y = area.scrollTop;
      const last = area._lastY || 0;
      area._lastY = y;
      const view = $('#viewReader');
      if (y > last + 8 && y > 90) view.classList.add('hide-bar');
      else if (y < last - 8 || y < 60) view.classList.remove('hide-bar');
    }, { passive: true });

    area.addEventListener('click', (e) => {
      if (e.target.closest('mark, button, a')) return;
      if (window.getSelection().toString()) return;
      $('#viewReader').classList.toggle('hide-bar');
    });

    // 全书搜索
    $('#findInput').oninput = () => {
      clearTimeout(findTimer);
      findTimer = setTimeout(runFind, 220);
    };
    $('#findInput').onkeydown = (e) => {
      if (e.key === 'Enter') { clearTimeout(findTimer); runFind(); }
    };

    // 拖拽导入
    let dragDepth = 0;
    const overlay = el('div', 'drop-overlay', '松开鼠标，把书放进书架');
    document.body.appendChild(overlay);
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      dragDepth += 1;
      overlay.classList.add('on');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) overlay.classList.remove('on');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      overlay.classList.remove('on');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
        importFiles(e.dataTransfer.files);
      }
    });

    document.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', flushProgress);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flushProgress(); });
  }

  /* ══════════════════════════ 启动 ══════════════════════════ */
  async function init() {
    loadSettings();
    applySettings();

    const mode = await Store.init();
    if (mode === 'idb') {
      toast('未通过 start.bat 启动，书暂时存在浏览器里', true);
    }

    bind();
    await refreshShelf();

    // 记住上次的书架滚动位置
    const shelf = $('.shelf');
    try {
      const y = Number(localStorage.getItem('monet.shelfScroll') || 0);
      if (y) shelf.scrollTop = y;
    } catch (_) {}
    shelf.addEventListener('scroll', () => {
      try { localStorage.setItem('monet.shelfScroll', String(shelf.scrollTop)); } catch (_) {}
    }, { passive: true });
  }

  return { init, toast };
})();

document.addEventListener('DOMContentLoaded', App.init);
