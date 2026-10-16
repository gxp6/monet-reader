/* ==========================================================================
   文本解析：把一整本小说切成章节，再把章节渲染成 HTML
   ========================================================================== */

const Parser = (() => {
  const CN_NUM = '〇零一二三四五六七八九十百千万亿两0-9０-９';

  // 最强的一类：第一章 / 第12章 / 第一百二十回 / 第 3 节 / 第2卷
  const RE_NUM_CHAPTER = new RegExp(
    '^\\s*[【\\[（(]?\\s*第\\s*[' + CN_NUM + ']{1,12}\\s*[章節章节回卷篇集幕话話部折]\\s*[】\\]）)]?\\s*[:：、.．\\-—]?\\s*\\S{0,40}\\s*$'
  );

  // 特殊章节名
  const RE_SPECIAL = new RegExp(
    '^\\s*[【\\[（(]?\\s*(?:楔\\s*子|序\\s*章|序\\s*言|序\\s*幕|序|引\\s*子|引\\s*言|前\\s*言|后\\s*记|後\\s*記|尾\\s*声|尾\\s*聲|终\\s*章|終\\s*章|终\\s*曲|大\\s*结\\s*局|番\\s*外(?:篇)?|外\\s*传|外\\s*傳|完\\s*结\\s*感\\s*言|感\\s*言|作\\s*者\\s*的\\s*话|正\\s*文)\\s*[】\\]）)]?\\s*[:：、.．\\-—]?\\s*\\S{0,40}\\s*$'
  );

  // Chapter 1 / CHAPTER IV
  const RE_EN_CHAPTER = /^\s*Chapter\s*[0-9IVXLCDM]{1,8}\b.{0,40}$/i;

  // 常见的连载站残留广告行
  const RE_JUNK = [
    /^本章(未完|完)/,
    /^(请|求)(记住|收藏|推荐|投票|订阅)/,
    /(加入书签|返回目录|手机用户请|请用手机|笔趣阁|www\.|http:\/\/|https:\/\/)/i,
    /^\s*[（(]?(?:本章完|全文完|未完待续|待续)[)）]?\s*$/,
    /^[\s\-=*_~#·]{6,}$/,
    /^&[a-z]+;$/,
  ];

  // 单章太长会让浏览器排版卡顿，超过这个长度就再切一刀
  const MAX_CHAPTER_CHARS = 120000;
  // 完全找不到章节号时，按这个长度切块
  const CHUNK_CHARS = 4500;

  const isJunk = (line) => RE_JUNK.some((re) => re.test(line));

  /** 识别一行是不是章节标题，是就返回标题文字，不是返回 null */
  function chapterTitleOf(line) {
    const t = line.trim();
    if (!t || t.length > 60) return null;
    if (/[。！？；：，]$/.test(t) && !/[”’]$/.test(t)) return null;
    if (RE_NUM_CHAPTER.test(t)) return t;
    if (t.length <= 12 && RE_SPECIAL.test(t)) return t;
    if (RE_EN_CHAPTER.test(t)) return t;
    // EPUB 转换时留的记号（server.py 里写死为 @@CH@@）
    if (t.startsWith('@@CH@@')) return t.slice(6).trim() || '未命名章节';
    return null;
  }

  /** 把整本书切成章节列表 [{title, start, end}] */
  function parseChapters(full) {
    const text = full || '';
    const lines = [];
    let idx = 0;
    for (const raw of text.split('\n')) {
      lines.push({ line: raw, start: idx });
      idx += raw.length + 1;
    }

    const marks = [];
    for (let i = 0; i < lines.length; i++) {
      const title = chapterTitleOf(lines[i].line);
      if (title) marks.push({ title, start: lines[i].start, line: lines[i].line, lineNo: i });
    }

    // 找到的"章节"密度高得不合常理，说明是误判，退回按长度切块
    const sane = marks.length > 0 && (marks.length < 4000 || text.length / marks.length > 120);

    if (!sane) {
      return chunkify(text);
    }

    const chapters = [];
    // 第一个章节标记之前的内容，作为"前言"
    if (marks[0].start > 40) {
      const head = text.slice(0, marks[0].start).trim();
      if (head.length > 20) chapters.push({ title: '前言', start: 0, bodyStart: 0, end: marks[0].start });
    }
    for (let i = 0; i < marks.length; i++) {
      const cur = marks[i];
      const nextStart = i + 1 < marks.length ? marks[i + 1].start : text.length;
      const titleEnd = cur.start + cur.line.length;
      chapters.push({
        title: cur.title,
        start: cur.start,
        bodyStart: Math.min(titleEnd + 1, nextStart),
        end: nextStart,
      });
    }

    return splitHugeChapters(chapters, text);
  }

  /** 没有章节号的书：按段落边界切成长度相近的小节 */
  function chunkify(text) {
    const out = [];
    const paras = text.split(/\n/);
    let buf = [];
    let bufLen = 0;
    let cursor = 0;
    let start = 0;
    let n = 0;

    const flush = (end) => {
      if (!buf.length) return;
      n += 1;
      const first = buf.find((l) => l.trim()) || '';
      const label = `第 ${n} 节`;
      out.push({
        title: label,
        start,
        bodyStart: start,
        end,
        preview: first.trim().slice(0, 24),
      });
      buf = [];
      bufLen = 0;
      start = end;
    };

    for (const line of paras) {
      const len = line.length + 1;
      if (bufLen > 0 && bufLen + len > CHUNK_CHARS) flush(cursor);
      if (!buf.length) start = cursor;
      buf.push(line);
      bufLen += len;
      cursor += len;
    }
    flush(text.length);
    return out.length ? out : [{ title: '正文', start: 0, bodyStart: 0, end: text.length }];
  }

  /** 一章过长时按空行切成「（上）（中）（下）」 */
  function splitHugeChapters(chapters, text) {
    const out = [];
    for (const ch of chapters) {
      const body = text.slice(ch.bodyStart, ch.end);
      if (body.length <= MAX_CHAPTER_CHARS) {
        out.push(ch);
        continue;
      }
      const parts = [];
      let cursor = 0;
      const lines = body.split('\n');
      let buf = '';
      for (const line of lines) {
        if (buf.length + line.length > MAX_CHAPTER_CHARS && buf.trim()) {
          parts.push({ at: cursor - buf.length, text: buf });
          buf = '';
        }
        buf += line + '\n';
        cursor += line.length + 1;
      }
      if (buf.trim()) parts.push({ at: cursor - buf.length, text: buf });

      parts.forEach((p, i) => {
        out.push({
          title: `${ch.title}（${'上中下'.charAt(i) || i + 1}）`,
          start: ch.start,
          bodyStart: ch.bodyStart + p.at,
          end: ch.bodyStart + p.at + p.text.length,
          sub: true,
        });
      });
    }
    return out;
  }

  /** 拿到某一章的正文（不含标题行），顺便清掉广告行 */
  function chapterText(full, ch) {
    return clean(full.slice(ch.bodyStart, ch.end));
  }

  function clean(body) {
    if (!body) return '';
    const lines = body.split('\n');
    const out = [];
    for (const line of lines) {
      const t = line.trim();
      if (!t) { out.push(''); continue; }
      if (isJunk(t)) continue;
      out.push(line.replace(/[\t\u00a0]/g, ' ').replace(/\s+$/, ''));
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * 判断这本书的段落是"一行一段"还是"空行分段"。
   * 前者是国内 txt 的常态，后者常见于从网页另存 / 硬换行的文件。
   */
  function paragraphMode(body) {
    const lines = body.split('\n').filter((l) => l.trim());
    if (lines.length < 6) return 'line';
    const blanks = (body.match(/\n\s*\n/g) || []).length;
    const avg = lines.reduce((s, l) => s + l.length, 0) / lines.length;
    // 有大量空行、并且行普遍较短 —— 说明是被硬换行过的，要按空行合并
    return blanks / lines.length > 0.25 && avg < 60 ? 'blank' : 'line';
  }

  const esc = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /** 把章节正文渲染成 HTML；每段带 data-o（该段在正文里的字符偏移），供搜索定位 */
  function renderBody(body) {
    const mode = paragraphMode(body);
    const paras = [];
    let offset = 0;
    let buf = null;

    const flush = () => {
      if (buf && buf.text.trim()) paras.push(buf);
      buf = null;
    };

    for (const line of body.split('\n')) {
      const t = line.trim();
      if (!t) {
        if (mode === 'blank') flush();
      } else if (mode === 'blank') {
        if (!buf) buf = { text: '', offset };
        buf.text += t;
      } else {
        paras.push({ text: t, offset: offset + (line.length - line.trimStart().length) });
      }
      offset += line.length + 1;
    }
    flush();

    return paras
      .map(({ text: p, offset: o }) => {
        // 场景分隔符（* * * / ─────）单独处理
        if (/^[*＊\-—─·•※✽✳❋\s]{3,12}$/.test(p)) {
          return `<p class="rd-dinkus" data-o="${o}" style="text-align:center;text-indent:0;letter-spacing:.4em;color:var(--ink-3)">${esc(p)}</p>`;
        }
        const quoted = /^[“"「『]/.test(p) && /[”"」』]$/.test(p);
        return `<p data-o="${o}"${quoted ? ' class="rd-quote"' : ''}>${esc(p)}</p>`;
      })
      .join('\n');
  }

  /** 全书搜索，返回命中列表 */
  function search(full, chapters, query, limit = 200) {
    const q = query.trim();
    if (q.length < 1) return [];
    const lower = q.toLowerCase();
    const hits = [];
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const body = full.slice(ch.bodyStart, ch.end);
      const hay = body.toLowerCase();
      let from = 0;
      let perChapter = 0;
      while (hits.length < limit && perChapter < 8) {
        const at = hay.indexOf(lower, from);
        if (at < 0) break;
        const a = Math.max(0, at - 34);
        const b = Math.min(body.length, at + q.length + 46);
        hits.push({
          chapter: i,
          chapterTitle: ch.title,
          offset: ch.bodyStart + at,
          before: body.slice(a, at),
          match: body.slice(at, at + q.length),
          after: body.slice(at + q.length, b),
        });
        from = at + q.length;
        perChapter += 1;
      }
      if (hits.length >= limit) break;
    }
    return hits;
  }

  /** 全书字数统计用（去掉空白） */
  function countChars(text) {
    return (text || '').replace(/\s/g, '').length;
  }

  return { parseChapters, chapterText, renderBody, search, countChars, esc };
})();
