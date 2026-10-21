/* 云南奶龙大学 · 跳转动画
   时序：入画 → 抠出贴纸 → 卡片飞入 → 四条轮廓汇聚成铜钱 → 校徽环升起 → 便签贴上 → 跳转官网
   ?stay 停在最终画面方便调试；点过任意便签会暂停自动跳转。 */
(() => {
  'use strict';

  const URL_TARGET = 'https://www.ynufe.edu.cn/';
  const S = window.NAILONG_SHAPES;
  const body = document.body;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stay = new URLSearchParams(location.search).has('stay');
  let cancelled = false;
  const go = () => { if (!stay && !cancelled) location.replace(URL_TARGET); };
  const T = reduced ? 0.25 : 1;
  const DWELL = reduced ? 2600 : 7000;      // 最终画面停留时长（毫秒）

  const nl = document.getElementById('nl');
  const emblem = document.getElementById('emblem');
  const morph = document.getElementById('morph');
  const bar = document.getElementById('bar');
  const cardEls = [...document.querySelectorAll('.card')];
  const statusText = document.getElementById('statusText');
  const dots = document.getElementById('dots');

  const NS = 'http://www.w3.org/2000/svg';
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp01 = t => Math.min(1, Math.max(0, t));

  /* ---------- 图片兜底 ----------
     所有图片都托管在 7bu 图床，地址写在 index.html 里：场景图加载不到就用内置的
     SVG 夜色，卡片图加载不到就用 daishu.png。所以断网打开也不会出现破图。 */
  (function wireImages() {
    const sceneImg = document.querySelector('img[data-photo]');
    if (sceneImg) {
      const ok = () => {
        sceneImg.hidden = false;
        sceneImg.closest('.photo').classList.add('has-photo');
      };
      const no = () => { sceneImg.hidden = true; };
      if (sceneImg.complete) { sceneImg.naturalWidth ? ok() : no(); }
      else {
        sceneImg.addEventListener('load', ok, { once: true });
        sceneImg.addEventListener('error', no, { once: true });
      }
    }
    document.querySelectorAll('img[data-fallback]').forEach(img => {
      const fallback = () => {
        const src = img.dataset.fallback;       // 先取值，再删属性
        if (!src) return;                       // 免得回退图也失败时无限重试
        img.removeAttribute('data-fallback');
        img.dataset.fallbackUsed = '1';         // 标记：这张用的是贴纸图，轮廓要按它自己的比例量
        img.src = src;
      };
      img.addEventListener('error', fallback);
      // 图片往往在解析阶段就已经 404 了，那时监听还没绑上，所以这里补一次判断
      if (img.complete && img.naturalWidth === 0) fallback();
    });
  })();

  // 轮廓点 -> path。pts 是最大半径为 1 的归一化坐标，h 是轮廓的像素直径。
  const toD = (pts, cx, cy, h) => {
    const k = h / 2;
    let d = '';
    for (let i = 0; i < pts.length; i++) {
      d += (i ? 'L' : 'M') + (cx + pts[i][0] * k).toFixed(1) + ' ' + (cy + pts[i][1] * k).toFixed(1);
    }
    return d + 'Z';
  };

  // 轮廓在屏幕上的中心与直径。at 是轮廓原点在元素内的相对位置，k 是轮廓直径 ÷ 元素高度，
  // 两个数都由 shapes.js 给出，所以轮廓能精确套住图片里的主体。
  const measure = (el, shape) => {
    const r = el.getBoundingClientRect();
    return {
      cx: r.left + shape.at[0] * r.width,
      cy: r.top + shape.at[1] * r.height,
      h: shape.k * r.height
    };
  };

  // 每条轮廓两条 path：外轮廓与内孔。内孔让铜钱是真正的“外圆内方”，
  // 补间到布币时它收缩归零，不会留下任何接缝。
  const mkPaths = () => {
    const mk = () => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('fill', 'url(#coinGrad)');
      p.setAttribute('stroke', '#c9962c');
      p.setAttribute('fill-opacity', 0);
      p.setAttribute('stroke-opacity', 0);
      morph.appendChild(p);
      return p;
    };
    return { o: mk(), n: mk() };
  };

  const blend = (a, b, e) => a.map((p, k) => [lerp(p[0], b[k][0], e), lerp(p[1], b[k][1], e)]);

  // 量校徽的布局位置，顺便把转场圆心定在它身上。
  // BU_RATIO 是布币直径占校徽宽度的比例，emblem 里那条 path 用同一个系数生成，
  // 所以汇聚的终点和校标上的布币严丝合缝，交接时看不出断点。
  // 0.42 是配新布币比例（高宽比 1.68）调出来的：布币高约占内圆直径的 62%，
  // 上下左右都留出余量。早期 0.52 配瘦长布币会上下顶格、左右空荡。
  const BU_RATIO = 0.42;
  function build(sources) {
    const e = emblem.getBoundingClientRect();
    const ew = parseFloat(getComputedStyle(emblem).width);
    const tc = { cx: e.left + e.width / 2, cy: e.top + e.height / 2, h: ew * BU_RATIO };
    document.documentElement.style.setProperty('--wx', tc.cx + 'px');
    document.documentElement.style.setProperty('--wy', tc.cy + 'px');
    return { items: sources.map((s, i) => ({ ...s, el: mkPaths(), i })), tc };
  }

  // 把每条轮廓画到进度 t（0=源形状，1=合成后的古钱）
  function paint(items, tc, t) {
    for (const it of items) {
      const e = ease(clamp01((t - it.i * .06) / .82));
      const cx = lerp(it.cx, tc.cx, e), cy = lerp(it.cy, tc.cy, e), h = lerp(it.h, tc.h, e);

      it.el.o.setAttribute('d', toD(blend(it.outer, S.coin.outer, e), cx, cy, h));
      it.el.o.setAttribute('fill-opacity', (it.i ? 0 : 1 - e * e).toFixed(3));
      it.el.o.setAttribute('stroke-opacity', clamp01((e - .3) / .7).toFixed(3));
      it.el.o.setAttribute('stroke-width', (3 + 2 * (1 - e)).toFixed(1));

      // 内孔从中心展开，晚一点显形，免得开局就是一堆挤在中心的点
      it.el.n.setAttribute('d', toD(blend(it.inner, S.coin.inner, e), cx, cy, h));
      it.el.n.setAttribute('stroke-opacity', clamp01((e - .55) / .45).toFixed(3));
      it.el.n.setAttribute('stroke-width', 3);
    }
  }

  function converge(sources) {
    const { items, tc } = build(sources);
    const dur = 1400 * T;

    if (reduced) {
      items.forEach(it => {
        it.el.o.setAttribute('d', toD(S.coin.outer, tc.cx, tc.cy, tc.h));
        it.el.o.setAttribute('stroke-opacity', 1);
        it.el.n.setAttribute('d', toD(S.coin.inner, tc.cx, tc.cy, tc.h));
        it.el.n.setAttribute('stroke-opacity', 1);
      });
      return Promise.resolve({ items, tc });
    }

    return new Promise(res => {
      let t0 = null;
      const frame = now => {
        // 用 rAF 自带的时间戳而不是 performance.now()：前者在任何时钟下都单调推进
        if (t0 === null) t0 = now;
        try {
          const t = (now - t0) / dur;
          paint(items, tc, t);
          t < 1 ? requestAnimationFrame(frame) : res();
        } catch (err) { res(); }        // 万一画崩了也放行，别把整个流程卡死
      };
      requestAnimationFrame(frame);
    }).then(() => ({ items, tc }));
  }

  // 第二段补间：古钱继续变成校标上的方足布，方孔收缩消失、金色透出来。
  // 这是“贴纸的形状逐步变成云财校标”的那一步。
  function morphToBu(items, tc) {
    const dur = 900 * T;
    const paintBu = (e, snap) => {
      const o = snap ? S.bu.outer : blend(S.coin.outer, S.bu.outer, e);
      const n = snap ? S.bu.inner : blend(S.coin.inner, S.bu.inner, e);
      for (const it of items) {
        it.el.o.setAttribute('d', toD(o, tc.cx, tc.cy, tc.h));
        it.el.o.setAttribute('fill-opacity', (it.i ? 0 : .38 * e).toFixed(3));
        it.el.o.setAttribute('stroke-opacity', 1);
        it.el.o.setAttribute('stroke-width', (3 + 1.5 * e).toFixed(1));
        it.el.n.setAttribute('d', toD(n, tc.cx, tc.cy, tc.h));
        it.el.n.setAttribute('stroke-opacity', clamp01(1 - e * 1.6).toFixed(3));
      }
    };

    if (reduced) { paintBu(1, true); return Promise.resolve(); }

    return new Promise(res => {
      let t0 = null;
      const frame = now => {
        if (t0 === null) t0 = now;
        try {
          const t = clamp01((now - t0) / dur);
          paintBu(ease(t), false);
          t < 1 ? requestAnimationFrame(frame) : res();
        } catch (err) { res(); }
      };
      requestAnimationFrame(frame);
    });
  }

  /* ---------- 便签弹窗：点开后暂停跳转 ---------- */

  const modal = document.getElementById('qrModal');
  const modalTitle = document.getElementById('modalTitle');
  const modalBody = document.getElementById('modalBody');
  const modalHint = document.getElementById('modalHint');
  let lastFocus = null;

  const BODY = {
    tuzi: `
      <svg class="modal-figure" viewBox="0 0 120 120" aria-hidden="true">
        <ellipse cx="42" cy="34" rx="9" ry="26" fill="#fdf6ef" stroke="#e4d6c8" stroke-width="2" transform="rotate(-12 42 34)"/>
        <ellipse cx="78" cy="34" rx="9" ry="26" fill="#fdf6ef" stroke="#e4d6c8" stroke-width="2" transform="rotate(12 78 34)"/>
        <ellipse cx="42" cy="34" rx="4" ry="16" fill="#f7d9d2" transform="rotate(-12 42 34)"/>
        <ellipse cx="78" cy="34" rx="4" ry="16" fill="#f7d9d2" transform="rotate(12 78 34)"/>
        <circle cx="60" cy="74" r="34" fill="#fdf6ef" stroke="#e4d6c8" stroke-width="2"/>
        <circle cx="47" cy="70" r="5" fill="#3a2a12"/>
        <circle cx="73" cy="70" r="5" fill="#3a2a12"/>
        <ellipse cx="36" cy="84" rx="7" ry="4.5" fill="#f7a08a" opacity=".6"/>
        <ellipse cx="84" cy="84" rx="7" ry="4.5" fill="#f7a08a" opacity=".6"/>
        <path d="M56 82 C58 86 62 86 64 82" fill="none" stroke="#c39a7a" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="98" cy="34" r="11" fill="#f7cf3c" opacity=".9"/>
      </svg>
      <p><strong>云财兔宝</strong>是云南财经大学的官方吉祥物，今年中秋初次亮相。</p>
      <p>龙泉路校区与安宁校区的活动里都可能撞见它，见到可以合影。</p>`,
    cat: `
      <p><strong>猫猫学长</strong>不上课，但从不缺席：图书馆台阶、食堂后门、宿舍楼下，各有各的固定座位。</p>
      <p>云财校友栏目的原话是“漫步林荫道，总能邂逅‘猫学长’”。天气好的时候狗子也来凑热闹——猫狗相伴，是校园里最稳的一对。</p>
      <p>点开这个页面的人，最后都会被送到 <strong>www.ynufe.edu.cn</strong></p>`
  };

  const HINT = {
    tuzi: '点击任意处关闭 · 关闭后可继续点“直接前往”',
    cat: '点击任意处关闭 · 跳转倒计时已暂停'
  };

  function cancelRedirect() {
    if (cancelled) return;
    cancelled = true;
    body.classList.remove('s-wipe');
    if (statusText) statusText.textContent = '已暂停跳转';
    if (dots) dots.style.display = 'none';
  }

  const onKey = e => {
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key !== 'Tab') return;
    const items = modal.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])');
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  function openModal(btn) {
    cancelRedirect();
    const { label, kind } = btn.dataset;
    modalTitle.textContent = label;
    modalBody.innerHTML = BODY[kind] || '';
    modalHint.textContent = HINT[kind] || '';
    lastFocus = document.activeElement;
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('is-open'));
    modal.querySelector('.modal-x').focus();
    document.addEventListener('keydown', onKey);
  }

  function closeModal() {
    if (modal.hidden) return;
    modal.classList.remove('is-open');
    document.removeEventListener('keydown', onKey);
    const done = () => { modal.hidden = true; };
    reduced ? done() : setTimeout(done, 300);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn));
  });
  modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });

  // 校标上的布币与补间终点共用同一组点与同一比例，交接时零位移
  document.getElementById('buPath').setAttribute('d', toD(S.bu.outer, 200, 200, 400 * BU_RATIO));

  /* ---------- 调试入口 ----------
     ?stay   走完整动画但停在最终画面，不跳转
     ?final  跳过动画直接呈现最终画面，方便调样式
     ?probe  配合 final 使用：用红色虚线画出汇聚层的布币轮廓，核对与校标是否重合 */
  const params = new URLSearchParams(location.search);
  const finalOnly = params.has('final');

  if (finalOnly) {
    const e = emblem.getBoundingClientRect();
    const ew = parseFloat(getComputedStyle(emblem).width);
    const g = { cx: e.left + e.width / 2, cy: e.top + e.height / 2, h: ew * BU_RATIO };
    document.documentElement.style.setProperty('--wx', g.cx + 'px');
    document.documentElement.style.setProperty('--wy', g.cy + 'px');
    body.classList.add('s-in', 's-cut', 's-lift', 's-cards', 's-merge', 's-tint', 's-ring', 's-notes');
    if (params.has('probe')) {
      const probe = document.createElementNS(NS, 'path');
      probe.setAttribute('d', toD(S.bu.outer, g.cx, g.cy, g.h));
      probe.setAttribute('fill', 'none');
      probe.setAttribute('stroke', '#b8232f');
      probe.setAttribute('stroke-width', '1.5');
      probe.setAttribute('stroke-dasharray', '5 5');
      // 必须用 inline style：body.s-ring .morph path{opacity:0} 是 CSS 规则，
      // 优先级高于 SVG 的 opacity 表现属性，用 setAttribute 会被直接隐藏掉
      probe.style.opacity = '.9';
      morph.appendChild(probe);
    }
  }

  /* ---------- 主时序 ---------- */

  async function run() {
    await wait(120 * T);                      // 让首帧样式先落地

    // 1. 夜色校园入画
    body.classList.add('s-in');
    await wait(1000 * T);

    // 2. 贴纸被抠出：画面压暗，轮廓发光并抖一下
    body.classList.add('s-cut');
    nl.classList.add('wobble');
    await wait(800 * T);

    // 3. 脱离场景
    body.classList.add('s-lift');
    await wait(600 * T);

    // 4. 校园其它几处的贴纸以拍立得卡片飞入
    body.classList.add('s-cards');
    await wait(950 * T);

    // 5. 四条轮廓汇聚成古钱
    const src = [{ outer: S.main.outer, inner: S.main.inner, ...measure(nl.querySelector('.nl-img'), S.main) }];
    cardEls.forEach((c, i) => {
      const k = String(i + 1);
      const shape = S[k];
      const el = c.querySelector('img');
      if (!shape || !shape.outer || !el) return;   // 形状或节点缺失时跳过，不把异常冒到 catch 里
      // 照片没传、回退成贴纸图时，整张图就是贴纸本身，得按它自己的比例量；
      // 传了照片才用 shapes.js 里那套“贴纸占照片六成高”的估计值。
      const geo = el.dataset.fallbackUsed ? S.main : shape;
      src.push({ outer: shape.outer, inner: shape.inner, ...measure(el, geo) });
    });
    body.classList.add('s-merge');
    await wait(320 * T);
    const { items, tc } = await converge(src);

    // 5b. 古钱继续变形为校标上的方足布——贴纸至此长成了云财校标的形状
    await morphToBu(items, tc);

    // 6. 底色转宣纸，校徽环升起，布币、地球、外环、1951、中英文校名依次描出
    body.classList.add('s-tint', 's-ring');

    // 7. 便签贴上
    await wait(600 * T);
    body.classList.add('s-notes');

    // 8. 进度条即停留计时，走完再扩散跳转
    bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: DWELL, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    await wait(DWELL);

    if (!stay && !cancelled) {
      body.classList.add('s-wipe');
      await wait(850 * T);
      go();
    }
  }

  if (!finalOnly) {
    run().catch(go);
    setTimeout(go, 20000);   // 兜底：任何一步卡住也把人送到官网
  }
})();