/* ==========================================================================
   封面
   没有封面图也不难看：按书名算一个稳定的随机种子，用 SVG 现画一幅小画——
   天空、水面、睡莲叶、花、柳枝，配色全部取自莫奈。
   同一本书每次打开都是同一幅画。
   ========================================================================== */

const Covers = (() => {
  /* ── 确定性随机 ───────────────────────────────────────────────────── */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /* ── 八组配色，色相尽量拉开，一眼能看出是不同的画 ─────────────────── */
  const PALETTES = [
    { name: '睡莲池塘', sky: ['#f3e7dc', '#e6d9d3'], water: ['#8fb5b8', '#5c8890'],
      pad: ['#7fa08c', '#5e8474'], bloom: ['#e6b3b3', '#f2d7d7', '#fbf3ef'],
      foliage: ['#8ba58f', '#b9c9ae'], light: '#fdf0d5', ink: '#2b3c3a' },

    { name: '干草堆', sky: ['#fbeed3', '#f3dcae'], water: ['#d9ab63', '#b9853f'],
      pad: ['#c99a52', '#a8763a'], bloom: ['#e8c179', '#f6e3bb', '#fff6e2'],
      foliage: ['#c9a25c', '#e2c286'], light: '#fff3d4', ink: '#4a3718' },

    { name: '罂粟花田', sky: ['#f6e6e1', '#eccecb'], water: ['#93ab86', '#6d8a63'],
      pad: ['#7d9a6e', '#5f7c55'], bloom: ['#cf7a78', '#e8a9a2', '#f7d9d2'],
      foliage: ['#93ab86', '#b7c7a4'], light: '#fdeadd', ink: '#3c2a2c' },

    { name: '日本桥', sky: ['#eee7f2', '#ddd4e6'], water: ['#9d9cc4', '#6f7fae'],
      pad: ['#8c9bb0', '#6d7f9c'], bloom: ['#c4a2c9', '#e3cbe6', '#f6ecf7'],
      foliage: ['#9b93bd', '#bfb6d6'], light: '#f2e6f7', ink: '#302f45' },

    { name: '白杨树', sky: ['#f1f3e2', '#dfe6c8'], water: ['#9fb483', '#79975f'],
      pad: ['#8aa06d', '#6b8552'], bloom: ['#e5d79a', '#f4ecc9', '#fdfaea'],
      foliage: ['#8fa86e', '#b6c893'], light: '#f8f5cf', ink: '#31401f' },

    { name: '晨雾塞纳河', sky: ['#f0f4f5', '#dde7ea'], water: ['#9ab5c0', '#7295a5'],
      pad: ['#8aa8b2', '#6d8f9c'], bloom: ['#e2b9bc', '#f1d5d6', '#faf0f0'],
      foliage: ['#a5bcc2', '#c6d7da'], light: '#fdf6f2', ink: '#2c3a41' },

    { name: '花园玫瑰', sky: ['#f9ece9', '#f0d6d6'], water: ['#a8bfa5', '#7f9c80'],
      pad: ['#8fae8b', '#6f8f70'], bloom: ['#d99aa0', '#efc4c6', '#fbe8e6'],
      foliage: ['#9db89a', '#c3d3b8'], light: '#fff2ec', ink: '#432d31' },

    { name: '威尼斯黄昏', sky: ['#fce9cf', '#f6cfa2'], water: ['#7fa3a8', '#5b7d86'],
      pad: ['#6f9490', '#557a78'], bloom: ['#e8a17f', '#f6ccae', '#fdf0e0'],
      foliage: ['#c98f6a', '#e5b78d'], light: '#fff0cd', ink: '#3d3330' },
  ];

  /* ── 画一张封面 ───────────────────────────────────────────────────── */
  let uid = 0;

  function svg(title, author) {
    const seed = hash((title || '') + '|' + (author || ''));
    const rnd = mulberry32(seed);
    const p = PALETTES[seed % PALETTES.length];
    const W = 300;
    const H = 400;
    const id = 'cv' + (uid++);

    const r = (a, b) => a + rnd() * (b - a);
    const horizon = r(H * 0.34, H * 0.5);

    const parts = [];

    // 天空 / 底色
    parts.push(`<rect width="${W}" height="${H}" fill="url(#${id}s)"/>`);
    // 水面（渐变顶端透明，水天过渡才不会像一刀切开）
    parts.push(`<rect y="${horizon.toFixed(0)}" width="${W}" height="${(H - horizon).toFixed(0)}" fill="url(#${id}w)"/>`);
    // 天光落在水面上
    parts.push(
      `<ellipse cx="${r(W * 0.3, W * 0.75).toFixed(0)}" cy="${(horizon + 16).toFixed(0)}" rx="${r(70, 130).toFixed(0)}" ry="${r(16, 30).toFixed(0)}" fill="url(#${id}g)"/>`
    );

    // 顶上的树冠：用带透明渐变的圆，边缘自然就糊了
    const clumps = 3 + Math.floor(rnd() * 3);
    for (let i = 0; i < clumps; i++) {
      const cx = r(-20, W + 20);
      const cy = r(-30, horizon * 0.62);
      const rr = r(50, 110);
      parts.push(
        `<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rr.toFixed(0)}" fill="url(#${id}f)" opacity="${r(0.35, 0.75).toFixed(2)}"/>`
      );
    }

    // 柳枝 / 竖笔触
    if (rnd() > 0.35) {
      const n = 3 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const x = r(10, W - 10);
        const y0 = r(0, 30);
        const y1 = r(horizon * 0.6, horizon * 1.5);
        const wob = r(-26, 26);
        parts.push(
          `<path d="M${x.toFixed(0)} ${y0.toFixed(0)} Q${(x + wob).toFixed(0)} ${((y0 + y1) / 2).toFixed(0)} ${(x + wob * 0.4).toFixed(0)} ${y1.toFixed(0)}" stroke="${p.foliage[i % 2]}" stroke-width="${r(1, 2.4).toFixed(1)}" fill="none" opacity="${r(0.25, 0.55).toFixed(2)}" stroke-linecap="round"/>`
        );
      }
    }

    // 水面上的横向笔触
    const bands = 5 + Math.floor(rnd() * 5);
    for (let i = 0; i < bands; i++) {
      const y = r(horizon + 6, H - 6);
      const x0 = r(-30, W * 0.55);
      const len = r(50, 170);
      parts.push(
        `<path d="M${x0.toFixed(0)} ${y.toFixed(0)} q${(len / 2).toFixed(0)} ${r(-7, 7).toFixed(0)} ${len.toFixed(0)} ${r(-3, 3).toFixed(0)}" stroke="${rnd() > 0.5 ? p.bloom[1] : p.pad[0]}" stroke-width="${r(1.2, 3.4).toFixed(1)}" fill="none" opacity="${r(0.16, 0.42).toFixed(2)}" stroke-linecap="round"/>`
      );
    }

    // 睡莲叶：聚成两三簇，比均匀撒开更像真的池塘
    const clusters = [];
    const nCluster = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < nCluster; i++) {
      clusters.push({ x: r(30, W - 30), y: r(horizon + 26, H - 26) });
    }
    const pads = 6 + Math.floor(rnd() * 5);
    for (let i = 0; i < pads; i++) {
      const c = clusters[i % clusters.length];
      const cx = Math.min(W - 12, Math.max(12, c.x + r(-46, 46)));
      const cy = Math.min(H - 10, Math.max(horizon + 8, c.y + r(-26, 26)));
      const rx = r(13, 34);
      const ry = rx * r(0.3, 0.46);
      const dark = rnd() > 0.45;
      parts.push(
        `<ellipse cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" rx="${rx.toFixed(0)}" ry="${ry.toFixed(0)}" fill="${p.pad[dark ? 1 : 0]}" opacity="${r(0.4, 0.78).toFixed(2)}"/>` +
          `<ellipse cx="${(cx - rx * 0.18).toFixed(0)}" cy="${(cy - ry * 0.35).toFixed(0)}" rx="${(rx * 0.5).toFixed(0)}" ry="${(ry * 0.45).toFixed(0)}" fill="${p.light}" opacity="${r(0.08, 0.2).toFixed(2)}"/>`
      );
    }

    // 花
    const blooms = 5 + Math.floor(rnd() * 6);
    for (let i = 0; i < blooms; i++) {
      const c = clusters[i % clusters.length];
      const cx = Math.min(W - 14, Math.max(14, c.x + r(-50, 50)));
      const cy = Math.min(H - 14, Math.max(horizon + 6, c.y + r(-30, 30)));
      const rr = r(4.5, 11);
      const petals = 3 + Math.floor(rnd() * 3);
      const g = [];
      for (let k = 0; k < petals; k++) {
        g.push(
          `<circle cx="${(cx + r(-rr, rr)).toFixed(1)}" cy="${(cy + r(-rr * 0.6, rr * 0.6)).toFixed(1)}" r="${(rr * r(0.6, 1)).toFixed(1)}" fill="${p.bloom[k % p.bloom.length]}" opacity="${r(0.65, 0.97).toFixed(2)}"/>`
        );
      }
      parts.push(`<g>${g.join('')}</g>`);
    }

    // 顶部留出一块干净的地方给书名
    parts.push(`<rect width="${W}" height="${(H * 0.42).toFixed(0)}" fill="url(#${id}v)"/>`);
    // 底部稍微压暗，衬托书名
    parts.push(`<rect y="${(H * 0.72).toFixed(0)}" width="${W}" height="${(H * 0.28).toFixed(0)}" fill="url(#${id}n)"/>`);

    const defs =
      `<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${p.sky[0]}"/><stop offset="1" stop-color="${p.sky[1]}"/></linearGradient>` +
      `<linearGradient id="${id}w" x1="0" y1="0" x2="0.25" y2="1">` +
      `<stop offset="0" stop-color="${p.water[0]}" stop-opacity="0"/><stop offset="0.16" stop-color="${p.water[0]}"/><stop offset="1" stop-color="${p.water[1]}"/></linearGradient>` +
      `<radialGradient id="${id}g"><stop offset="0" stop-color="${p.light}" stop-opacity=".8"/><stop offset="1" stop-color="${p.light}" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="${id}f"><stop offset="0" stop-color="${p.foliage[0]}" stop-opacity=".95"/><stop offset="1" stop-color="${p.foliage[1]}" stop-opacity="0"/></radialGradient>` +
      `<linearGradient id="${id}v" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${p.sky[0]}" stop-opacity=".78"/><stop offset="0.62" stop-color="${p.sky[0]}" stop-opacity=".34"/><stop offset="1" stop-color="${p.sky[0]}" stop-opacity="0"/></linearGradient>` +
      `<linearGradient id="${id}n" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${p.water[1]}" stop-opacity="0"/><stop offset="1" stop-color="${p.water[1]}" stop-opacity=".38"/></linearGradient>`;

    return {
      markup: `<svg class="cover-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>${parts.join('')}</svg>`,
      ink: p.ink,
      palette: p,
    };
  }

  return { svg, hash, PALETTES };
})();
