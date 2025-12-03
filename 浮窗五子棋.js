// ==UserScript==
// @name         浮窗五子棋（可配置快捷键/透明度/锁定置顶）
// @namespace    https://scriptcat.org/
// @version      1.1.0
// @description  任意页面悬浮小窗五子棋，默认 Alt+K 显示/隐藏，支持自定义热键、窗口透明度调节、锁定置顶，含较强 AI（αβ剪枝+模式评估+邻域裁剪）
// @author       Bymode
// @match        https://linux.do/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  if (window.__GOMOKU_PANEL__) return;
  window.__GOMOKU_PANEL__ = true;

  const BLACK = 1, WHITE = -1, EMPTY = 0;
  const SIZE = 15;
  const Z = 2147483646;
  const STORAGE_KEY = 'gomoku_panel_state_v2';

  const defaultHotkey = { alt: true, ctrl: false, shift: false, key: 'K' };
  const defaultOpacity = 100; // %
  const defaultLock = false;

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : d;
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    }
  };

  // ---- DOM 结构 ----
  const root = document.createElement('div');
  root.style.position = 'fixed';
  root.style.zIndex = Z;
  root.style.inset = 'auto 16px 16px auto';
  root.style.pointerEvents = 'none';
  document.documentElement.appendChild(root);

  const host = document.createElement('div');
  host.style.pointerEvents = 'auto';
  root.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const ui = document.createElement('div');
  shadow.appendChild(ui);

  const css = document.createElement('style');
  css.textContent = `
  :host { all: initial; }
  .wrap { position: relative; width: 360px; background: rgba(255,255,255,.98); color:#222; border:1px solid #ddd; border-radius:10px; box-shadow:0 8px 30px rgba(0,0,0,.18); font:13px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif; user-select:none; }
  .dark .wrap { background:#1f1f1f; color:#e8e8e8; border-color:#333; box-shadow:0 8px 30px rgba(0,0,0,.55); }
  .hdr { display:flex; align-items:center; height:36px; padding:0 8px; cursor:move; border-bottom:1px solid rgba(0,0,0,.06); }
  .dark .hdr { border-bottom-color:#2a2a2a; }
  .title { font-weight:600; margin-right:8px; }
  .sp { flex:1; }
  .btn, select { appearance:none; border:1px solid #d0d0d0; background:#fff; color:#222; border-radius:6px; padding:4px 8px; margin-left:6px; cursor:pointer; font-size:12px; }
  .dark .btn, .dark select { background:#2a2a2a; color:#eee; border-color:#3a3a3a; }
  .btn:hover { filter:brightness(0.98); }
  .btn.min { width:28px; height:28px; display:inline-flex; justify-content:center; align-items:center; }
  .btn.icon { width:28px; height:28px; padding:0; display:inline-flex; align-items:center; justify-content:center; font-size:14px; }
  .body { padding:8px; }
  .row { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
  .status { font-size:12px; opacity:.9; }
  .canvas-wrap { display:flex; justify-content:center; margin-top:4px; }
  canvas { width: 340px; height: 340px; background: #f8f4de; border-radius:8px; border:1px solid #e3d8a8; touch-action: none; }
  .dark canvas { background:#2a2618; border-color:#40371a; }
  .launcher { position: fixed; right:16px; bottom:16px; width:28px; height:28px; border-radius:50%; background:#000; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; box-shadow:0 6px 20px rgba(0,0,0,.3); cursor:pointer; z-index:${Z}; }
  .launcher:hover { transform: translateY(-1px); }
  .settings { font-size:12px; border-top:1px solid rgba(0,0,0,.06); padding-top:6px; margin-top:4px; }
  .dark .settings { border-top-color:#2a2a2a; }
  .settings-row { display:flex; align-items:center; margin-bottom:4px; gap:6px; }
  .settings-row label { white-space:nowrap; }
  .settings-row input[type="text"] { width:90px; font-size:12px; padding:2px 4px; }
  .settings-row input[type="range"] { flex:1; }
  `;
  shadow.appendChild(css);

  const uiRoot = document.createElement('div');
  ui.appendChild(uiRoot);

  const themeDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (themeDark) uiRoot.classList.add('dark');

  // 右下角小圆点（在普通 DOM）
  const launcher = document.createElement('div');
  launcher.className = 'launcher';
  launcher.textContent = '五';
  document.body.appendChild(launcher);
  launcher.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.style.width = '360px';
  uiRoot.appendChild(wrap);

  const hdr = document.createElement('div');
  hdr.className = 'hdr';
  hdr.innerHTML = `
    <div class="title">五子棋</div>
    <div class="sp"></div>
  `;
  const sel = document.createElement('select');
  sel.innerHTML = `
    <option value="easy">简单</option>
    <option value="normal" selected>普通</option>
    <option value="hard">困难</option>
    <option value="expert">专家</option>
  `;
  const firstBtn = document.createElement('button');
  firstBtn.className = 'btn';
  firstBtn.textContent = '我先手';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn';
  resetBtn.textContent = '重开';

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'btn icon';
  settingsBtn.title = '设置';
  settingsBtn.textContent = '⚙';

  const minBtn = document.createElement('button');
  minBtn.className = 'btn min';
  minBtn.title = '隐藏';
  minBtn.textContent = '—';

  hdr.appendChild(sel);
  hdr.appendChild(firstBtn);
  hdr.appendChild(resetBtn);
  hdr.appendChild(settingsBtn);
  hdr.appendChild(minBtn);
  wrap.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'body';
  const row = document.createElement('div');
  row.className = 'row';
  const status = document.createElement('div');
  status.className = 'status';
  status.textContent = '准备就绪';
  row.appendChild(status);
  body.appendChild(row);

  const settingsPanel = document.createElement('div');
  settingsPanel.className = 'settings';
  settingsPanel.style.display = 'none';
  settingsPanel.innerHTML = `
    <div class="settings-row">
      <label>快捷键:</label>
      <input type="text" class="hk-input" />
      <span class="hk-hint" style="opacity:.7;">例如: Alt+K</span>
    </div>
    <div class="settings-row">
      <label>透明度:</label>
      <input type="range" class="opacity-range" min="40" max="100" step="5">
      <span class="opacity-val"></span>
    </div>
    <div class="settings-row">
      <label><input type="checkbox" class="lock-pos"> 锁定位置</label>
    </div>
  `;
  body.appendChild(settingsPanel);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'canvas-wrap';
  const canvas = document.createElement('canvas');
  canvasWrap.appendChild(canvas);
  body.appendChild(canvasWrap);
  wrap.appendChild(body);

  const hkInput = settingsPanel.querySelector('.hk-input');
  const opacityRange = settingsPanel.querySelector('.opacity-range');
  const opacityVal = settingsPanel.querySelector('.opacity-val');
  const lockCheckbox = settingsPanel.querySelector('.lock-pos');

  const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const CSIZE = 340;
  canvas.width = CSIZE * DPR;
  canvas.height = CSIZE * DPR;
  canvas.style.width = CSIZE + 'px';
  canvas.style.height = CSIZE + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(DPR, DPR);

  const pad = 12;
  const grid = SIZE - 1;
  const cell = (CSIZE - pad * 2) / grid;
  const starPoints = [[3,3],[3,11],[11,3],[11,11],[7,7]];

  let board, human, ai, turn, last, over, searching;
  let panelHidden = false;
  let hotkey = { ...defaultHotkey };
  let lockPos = defaultLock;
  let currentOpacity = defaultOpacity;

  const saved = store.get(STORAGE_KEY, null);
  human = BLACK;
  ai = WHITE;

  // ---- 工具：快捷键序列化/反序列化 ----
  function hotkeyToString(hk) {
    const parts = [];
    if (hk.ctrl) parts.push('Ctrl');
    if (hk.alt) parts.push('Alt');
    if (hk.shift) parts.push('Shift');
    if (hk.key) parts.push(hk.key.toUpperCase());
    return parts.join('+') || '未设置';
  }

  function parseHotkeyString(str) {
    if (!str) return { ...defaultHotkey };
    const parts = str.split('+').map(s => s.trim().toLowerCase()).filter(Boolean);
    let hk = { ctrl: false, alt: false, shift: false, key: '' };
    for (const p of parts) {
      if (p === 'ctrl' || p === 'control') hk.ctrl = true;
      else if (p === 'alt') hk.alt = true;
      else if (p === 'shift') hk.shift = true;
      else if (/^[a-z]$/.test(p)) hk.key = p.toUpperCase();
    }
    if (!hk.key) hk.key = defaultHotkey.key;
    if (!hk.ctrl && !hk.alt && !hk.shift) hk.alt = true;
    return hk;
  }

  function matchHotkey(e, hk) {
    const key = (e.key || '').toUpperCase();
    return !!(
      e.altKey === !!hk.alt &&
      e.ctrlKey === !!hk.ctrl &&
      e.shiftKey === !!hk.shift &&
      key === hk.key
    );
  }

  function setStatus(t) { status.textContent = t; }

  function applyPanelVisibility(hidden) {
    panelHidden = hidden;
    host.style.display = hidden ? 'none' : 'block';
    launcher.style.display = 'none';
    saveState({ hidden });
  }

  function togglePanel() {
    applyPanelVisibility(!panelHidden);
  }

  function applyOpacity(percent) {
    currentOpacity = percent;
    const v = Math.max(40, Math.min(100, percent)) / 100;
    wrap.style.opacity = String(v);
    opacityRange.value = String(percent);
    opacityVal.textContent = percent + '%';
  }

  function applyLockPos(lock) {
    lockPos = lock;
    lockCheckbox.checked = lock;
  }

  function saveState(extra = {}) {
    const rect = host.getBoundingClientRect();
    const pos = { x: rect.left, y: rect.top };
    store.set(STORAGE_KEY, {
      diff: sel.value,
      first: human === BLACK ? 'me' : 'ai',
      pos,
      hidden: panelHidden,
      hotkey,
      opacity: currentOpacity,
      lockPos,
      ...extra
    });
  }

  // ---- 棋盘绘制与规则 ----
  function draw() {
    ctx.clearRect(0, 0, CSIZE, CSIZE);
    ctx.fillStyle = themeDark ? '#2a2618' : '#f8f4de';
    ctx.fillRect(0, 0, CSIZE, CSIZE);
    ctx.strokeStyle = themeDark ? '#8c7a4a' : '#b08c3a';
    ctx.lineWidth = 1;
    for (let i = 0; i < SIZE; i++) {
      const x = pad + i * cell;
      ctx.beginPath();
      ctx.moveTo(pad, x);
      ctx.lineTo(CSIZE - pad, x);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, CSIZE - pad);
      ctx.stroke();
    }
    ctx.fillStyle = themeDark ? '#b08c3a' : '#8c6a1a';
    starPoints.forEach(([i, j]) => {
      const x = pad + i * cell, y = pad + j * cell;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
    const r = Math.min(9, Math.floor(cell * 0.42));
    for (let i = 0; i < SIZE; i++) {
      for (let j = 0; j < SIZE; j++) {
        const v = board[i][j];
        if (v === EMPTY) continue;
        const x = pad + i * cell, y = pad + j * cell;
        const grd = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
        if (v === BLACK) {
          grd.addColorStop(0, '#555');
          grd.addColorStop(1, '#000');
        } else {
          grd.addColorStop(0, '#fff');
          grd.addColorStop(1, '#ddd');
        }
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (last) {
      const [i, j] = last;
      const x = pad + i * cell, y = pad + j * cell;
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function posToCell(px, py) {
    const rect = canvas.getBoundingClientRect();
    const x = (px - rect.left);
    const y = (py - rect.top);
    const i = Math.round((x - pad) / cell);
    const j = Math.round((y - pad) / cell);
    if (i < 0 || i >= SIZE || j < 0 || j >= SIZE) return null;
    const cx = pad + i * cell;
    const cy = pad + j * cell;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist > cell * 0.45 + 2) return null;
    return [i, j];
  }

  function inBounds(i, j) { return i >= 0 && j >= 0 && i < SIZE && j < SIZE; }

  const DIRS = [[1,0],[0,1],[1,1],[1,-1]];

  function isWinAt(i, j) {
    const c = board[i][j];
    for (const [dx, dy] of DIRS) {
      let cnt = 1, x = i + dx, y = j + dy;
      while (inBounds(x,y) && board[x][y] === c) { cnt++; x += dx; y += dy; }
      x = i - dx; y = j - dy;
      while (inBounds(x,y) && board[x][y] === c) { cnt++; x -= dx; y -= dy; }
      if (cnt >= 5) return true;
    }
    return false;
  }

  function hasNeighbor(i, j, d) {
    for (let dx = -d; dx <= d; dx++) {
      for (let dy = -d; dy <= d; dy++) {
        if (!dx && !dy) continue;
        const x = i + dx, y = j + dy;
        if (inBounds(x,y) && board[x][y] !== EMPTY) return true;
      }
    }
    return false;
  }

  function lineString(mapTo, sx, sy, dx, dy) {
    let s = '2';
    let x = sx, y = sy;
    while (inBounds(x,y)) {
      const v = board[x][y];
      s += v === EMPTY ? '0' : (v === mapTo ? '1' : '2');
      x += dx; y += dy;
    }
    s += '2';
    return s;
  }

  const PAT = [
    { re: /011110/g, sc: 1000000 },
    { re: /211110|011112|11101|11011|10111/g, sc: 120000 },
    { re: /0011110|0111100/g, sc: 140000 },
    { re: /01110/g, sc: 8000 },
    { re: /0011100/g, sc: 10000 },
    { re: /010110|011010/g, sc: 5000 },
    { re: /001100|0010100|010100/g, sc: 800 },
    { re: /00011000/g, sc: 600 }
  ];

  function countMatches(str, re) {
    let c = 0, m;
    re.lastIndex = 0;
    while ((m = re.exec(str)) !== null) c++;
    return c;
  }

  function scoreLine(str) {
    let s = 0;
    for (const p of PAT) s += countMatches(str, p.re) * p.sc;
    return s;
  }

  function evalSide(side) {
    let t = 0;
    for (let i = 0; i < SIZE; i++) {
      t += scoreLine(lineString(side, 0, i, 1, 0));
      t += scoreLine(lineString(side, i, 0, 0, 1));
    }
    for (let k = 0; k < SIZE; k++) {
      t += scoreLine(lineString(side, 0, k, 1, 1));
      if (k) t += scoreLine(lineString(side, k, 0, 1, 1));
      t += scoreLine(lineString(side, 0, k, 1, -1));
      if (k) t += scoreLine(lineString(side, k, SIZE - 1, 1, -1));
    }
    return t;
  }

  function evaluate() {
    const my = evalSide(ai);
    const opp = evalSide(human);
    return my - opp * 1.02;
  }

  function generateMoves(side) {
    const moves = [];
    let hasAny = false;
    for (let i = 0; i < SIZE; i++) {
      for (let j = 0; j < SIZE; j++) {
        if (board[i][j] !== EMPTY) { hasAny = true; }
      }
    }
    if (!hasAny) return [[7,7]];
    for (let i = 0; i < SIZE; i++) {
      for (let j = 0; j < SIZE; j++) {
        if (board[i][j] !== EMPTY) continue;
        if (!hasNeighbor(i, j, 2)) continue;
        let scoreQuick = 0;
        board[i][j] = side;
        if (isWinAt(i, j)) scoreQuick += 1e9;
        const s1 = evaluate();
        board[i][j] = -side;
        const s2 = evaluate();
        board[i][j] = EMPTY;
        scoreQuick += (side === ai ? s1 : -s1) - (side === ai ? s2 : -s2) * 0.2;
        moves.push([i, j, scoreQuick]);
      }
    }
    moves.sort((a, b) => b[2] - a[2]);
    return moves.map(m => [m[0], m[1]]);
  }

  function timeLimitByDiff() {
    const diff = sel.value;
    if (diff === 'easy') return { ms: 180, depth: 2 };
    if (diff === 'hard') return { ms: 800, depth: 5 };
    if (diff === 'expert') return { ms: 1500, depth: 6 };
    return { ms: 400, depth: 4 };
  }

  function findImmediateWin(side) {
    const moves = generateMoves(side);
    for (const [i, j] of moves) {
      board[i][j] = side;
      const win = isWinAt(i, j);
      board[i][j] = EMPTY;
      if (win) return [i, j];
    }
    return null;
  }

  function negamax(depth, alpha, beta, side, deadline) {
    if (performance.now() > deadline) return { score: 0, timeout: true };
    const iw = last && isWinAt(last[0], last[1]);
    if (iw) return { score: side === ai ? -Infinity : Infinity, timeout: false };
    if (depth === 0) return { score: evaluate(), timeout: false };

    const moves = generateMoves(side);
    if (!moves.length) return { score: 0, timeout: false };

    let bestScore = -Infinity;
    let bestMove = moves[0];
    for (const [i, j] of moves) {
      board[i][j] = side;
      const prevLast = last; last = [i, j];
      const ie = isWinAt(i, j);
      let val;
      if (ie) {
        val = Infinity - (4 - depth);
      } else {
        const res = negamax(depth - 1, -beta, -alpha, -side, deadline);
        if (res.timeout) { board[i][j] = EMPTY; last = prevLast; return { score: 0, timeout: true }; }
        val = -res.score;
      }
      board[i][j] = EMPTY;
      last = prevLast;

      if (val > bestScore) {
        bestScore = val;
        bestMove = [i, j];
      }
      if (bestScore > alpha) alpha = bestScore;
      if (alpha >= beta) break;
    }
    return { score: bestScore, move: bestMove, timeout: false };
  }

  function findBestMove() {
    const { ms, depth: maxD } = timeLimitByDiff();
    const deadline = performance.now() + ms;
    const imm = findImmediateWin(ai);
    if (imm) return imm;
    const block = findImmediateWin(human);
    if (block) return block;

    let best = null;
    for (let d = 1; d <= maxD; d++) {
      const res = negamax(d, -Infinity, Infinity, ai, deadline);
      if (res.timeout) break;
      if (res.move) best = res.move;
      if (performance.now() > deadline - 5) break;
    }
    return best || generateMoves(ai)[0] || [7, 7];
  }

  function place(i, j, side) {
    if (board[i][j] !== EMPTY) return false;
    board[i][j] = side;
    last = [i, j];
    const win = isWinAt(i, j);
    if (win) {
      over = true;
      setStatus(side === human ? '你赢了' : 'AI 赢了');
    }
    return true;
  }

  function humanTurn(i, j) {
    if (over || searching) return;
    if (!place(i, j, human)) return;
    draw();
    if (over) return;
    turn = ai;
    setStatus('AI 思考中…');
    searching = true;
    setTimeout(() => {
      const mv = findBestMove();
      if (mv) place(mv[0], mv[1], ai);
      turn = human;
      searching = false;
      if (!over) setStatus('轮到你');
      draw();
    }, 0);
  }

  // ---- 新的一局 / 重开 / 切换先手 ----
  function resetGame(keepFirst) {
    board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    last = null;
    over = false;
    searching = false;

    if (!keepFirst) {
      const t = human; human = ai; ai = t;
    }
    firstBtn.textContent = human === BLACK ? '我先手' : 'AI先手';

    turn = BLACK;
    setStatus('新的一局，' + (human === BLACK ? '你先手' : 'AI先手'));
    draw();
    saveState();

    if (human !== BLACK) {
      searching = true;
      setTimeout(() => {
        const mv = findBestMove();
        if (mv) place(mv[0], mv[1], ai);
        turn = human;
        searching = false;
        if (!over) setStatus('轮到你');
        draw();
      }, 20);
    }
  }

  // ---- 鼠标交互 ----
  canvas.addEventListener('pointerdown', (e) => {
    if (over || searching) return;
    const p = posToCell(e.clientX, e.clientY);
    if (!p) return;
    if (turn !== human) return;
    humanTurn(p[0], p[1]);
  });

  // ---- 设置面板交互 ----
  settingsBtn.addEventListener('click', () => {
    const visible = settingsPanel.style.display !== 'none';
    settingsPanel.style.display = visible ? 'none' : 'block';
  });

  hkInput.addEventListener('change', () => {
    hotkey = parseHotkeyString(hkInput.value);
    hkInput.value = hotkeyToString(hotkey);
    saveState();
  });

  opacityRange.addEventListener('input', () => {
    applyOpacity(parseInt(opacityRange.value, 10) || defaultOpacity);
    saveState();
  });

  lockCheckbox.addEventListener('change', () => {
    applyLockPos(lockCheckbox.checked);
    saveState();
  });

  // ---- 控件事件 ----
  resetBtn.addEventListener('click', () => resetGame(true));
  firstBtn.addEventListener('click', () => resetGame(false));
  sel.addEventListener('change', () => saveState());
  minBtn.addEventListener('click', () => togglePanel());
  launcher.addEventListener('click', () => togglePanel());

  // ---- 键盘快捷键：使用捕获阶段，减少被页面拦截的概率 ----
  window.addEventListener('keydown', (e) => {
  const t = e.target;
  const inEditable = t && (
    t.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/i.test(t.tagName)
  );
  if (inEditable) return;
  if (matchHotkey(e, hotkey)) {
    e.preventDefault();
    togglePanel();
   }
  }, { capture: true });

  // ---- 拖拽窗口 ----
  (function enableDrag() {
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

    hdr.addEventListener('pointerdown', (e) => {
      if (lockPos) return;

      // 如果点击的是按钮、选择框、输入框，交给它自己处理，不启动拖拽
      const t = e.target;
      if (t !== hdr && t.closest && t.closest('button,select,input')) {
        return;
      }

      dragging = true;
      sx = e.clientX; sy = e.clientY;
      const rect = root.getBoundingClientRect();
      ox = rect.left; oy = rect.top;
      root.style.right = 'auto'; root.style.bottom = 'auto';
      hdr.setPointerCapture(e.pointerId);
    });

    hdr.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const nx = ox + (e.clientX - sx), ny = oy + (e.clientY - sy);
      root.style.left = Math.max(8, Math.min(window.innerWidth - 100, nx)) + 'px';
      root.style.top = Math.max(8, Math.min(window.innerHeight - 100, ny)) + 'px';
    });

    hdr.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      hdr.releasePointerCapture(e.pointerId);
      saveState();
    });
  })();



  // ---- 初始化（位置 / 难度 / 显示状态 / 设置恢复） ----
  if (saved && typeof saved === 'object') {
    if (saved.diff) sel.value = saved.diff;
    if (saved.first === 'ai') {
      human = WHITE; ai = BLACK;
      firstBtn.textContent = 'AI先手';
    }
    if (saved.pos && typeof saved.pos === 'object') {
      const { x, y } = saved.pos;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      root.style.left = x + 'px';
      root.style.top = y + 'px';
    }
    if (saved.hotkey) {
      hotkey = saved.hotkey;
    }
    if (typeof saved.opacity === 'number') {
      currentOpacity = saved.opacity;
    }
    if (typeof saved.lockPos === 'boolean') {
      lockPos = saved.lockPos;
    }
    applyOpacity(currentOpacity);
    applyLockPos(lockPos);
    hkInput.value = hotkeyToString(hotkey);

    if (saved.hidden) {
      applyPanelVisibility(true);
    } else {
      applyPanelVisibility(false);
    }
  } else {
    // 默认设置
    hotkey = { ...defaultHotkey };
    currentOpacity = defaultOpacity;
    lockPos = defaultLock;
    hkInput.value = hotkeyToString(hotkey);
    applyOpacity(currentOpacity);
    applyLockPos(lockPos);
    applyPanelVisibility(true);
  }

  resetGame(true);
})();
