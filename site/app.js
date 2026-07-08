// BCC VRChatワールド検索 - フロントエンド
// 検索条件の選択肢はすべて data.js（CSV由来）から動的に生成する。
(function () {
  'use strict';

  const DATA = window.WORLD_DATA || { worlds: [], generatedAt: null };
  const worlds = DATA.worlds.map((w, i) => ({ ...w, _i: i }));

  const $ = (sel) => document.querySelector(sel);
  const PLACEHOLDER =
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="192"><rect width="100%" height="100%" fill="#2a2f3a"/><text x="50%" y="50%" fill="#5a6272" font-size="14" text-anchor="middle" dominant-baseline="middle">NO IMAGE</text></svg>'
    );

  // ---------- 状態 ----------
  const state = { q: '', season: null, brightness: null, event: null, locs: new Set(), locMode: 'OR' };
  const settings = Object.assign({ cols: 4, showDesc: true, showAuthor: true, sort: 'default', userId: '' }, loadSettings());

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem('bccvws:settings')) || {}; } catch { return {}; }
  }
  function saveSettings() {
    try { localStorage.setItem('bccvws:settings', JSON.stringify(settings)); } catch { /* 無視 */ }
  }

  // ---------- 選択肢をデータから動的生成 ----------
  function uniqInOrder(list) {
    const seen = new Set(); const out = [];
    for (const v of list) if (v && !seen.has(v)) { seen.add(v); out.push(v); }
    return out;
  }
  function orderByPreference(values, preferred) {
    const inPref = preferred.filter((p) => values.includes(p));
    const rest = values.filter((v) => !preferred.includes(v));
    return [...inPref, ...rest];
  }

  const SEASON_ORDER = ['春', '夏', '秋', '冬', '季節性なし'];
  const seasons = orderByPreference(uniqInOrder(worlds.map((w) => w.season)), SEASON_ORDER);
  const brightnesses = uniqInOrder(worlds.map((w) => w.brightness));
  const events = (() => {
    const map = new Map(); // label -> month
    for (const w of worlds) {
      if (w.event && w.event.label && !map.has(w.event.label)) map.set(w.event.label, w.event.month);
    }
    return [...map.entries()]
      .map(([label, month]) => ({ label, month }))
      .sort((a, b) => (a.month ?? 99) - (b.month ?? 99) || a.label.localeCompare(b.label, 'ja'));
  })();
  const locations = uniqInOrder(worlds.flatMap((w) => w.locations));

  // ---------- フィルタUI生成 ----------
  function buildChips(container, values, getSelected, setSelected) {
    container.innerHTML = '';
    for (const value of values) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = value;
      btn.addEventListener('click', () => { setSelected(value); update(); });
      container.appendChild(btn);
    }
    container._sync = () => {
      [...container.children].forEach((btn) => btn.classList.toggle('active', getSelected(btn.textContent)));
    };
  }

  buildChips($('#f-season'), seasons,
    (v) => state.season === v,
    (v) => { state.season = state.season === v ? null : v; });
  buildChips($('#f-brightness'), brightnesses,
    (v) => state.brightness === v,
    (v) => { state.brightness = state.brightness === v ? null : v; });
  buildChips($('#f-event'), events.map((e) => e.label),
    (v) => state.event === v,
    (v) => { state.event = state.event === v ? null : v; });
  buildChips($('#f-location'), locations,
    (v) => state.locs.has(v),
    (v) => { state.locs.has(v) ? state.locs.delete(v) : state.locs.add(v); });

  // ---------- フィルタリング ----------
  function haystack(w) {
    return [w.name, w.description, w.season, w.brightness, w.event.label, w.author, ...w.locations]
      .join(' ').toLowerCase();
  }
  function applyFilters() {
    const terms = state.q.toLowerCase().split(/[\s　]+/).filter(Boolean);
    return worlds.filter((w) => {
      if (state.season && w.season !== state.season) return false;
      if (state.brightness && w.brightness !== state.brightness) return false;
      if (state.event && w.event.label !== state.event) return false;
      if (state.locs.size > 0) {
        const has = (t) => w.locations.includes(t);
        const match = state.locMode === 'AND' ? [...state.locs].every(has) : [...state.locs].some(has);
        if (!match) return false;
      }
      if (terms.length > 0) {
        const hay = haystack(w);
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }

  // ---------- ソート ----------
  const seasonRank = (s) => { const i = SEASON_ORDER.indexOf(s); return i === -1 ? 99 : i; };
  const eventRank = (e) => (e.month == null || e.month === 0 ? 99 : e.month);
  function applySort(list) {
    const sorted = [...list];
    switch (settings.sort) {
      case 'name': sorted.sort((a, b) => a.name.localeCompare(b.name, 'ja') || a._i - b._i); break;
      case 'season': sorted.sort((a, b) => seasonRank(a.season) - seasonRank(b.season) || a._i - b._i); break;
      case 'event': sorted.sort((a, b) => eventRank(a.event) - eventRank(b.event) || a._i - b._i); break;
      default: sorted.sort((a, b) => a._i - b._i);
    }
    return sorted;
  }

  // ---------- 描画 ----------
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // 入力値から usr_ 形式のUser IDを抽出（プロフィールURLの貼り付けにも対応）
  function getUserId() {
    const m = (settings.userId || '').match(/usr_[0-9a-fA-F-]+/);
    return m ? m[0] : null;
  }
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }
  // 新規インスタンス（invite・region: jp）のインバイトページURLを生成
  function inviteUrl(w, userId) {
    const instanceNumber = Math.floor(10000 + Math.random() * 90000);
    return `https://vrchat.com/home/launch?worldId=${w.id}&instanceId=${instanceNumber}~private(${userId})~region(jp)~nonce(${uuid()})`;
  }
  function card(w) {
    const uid = getUserId();
    const openBtn = uid
      ? `<a class="open-btn" href="${esc(inviteUrl(w, uid))}" target="_blank" rel="noopener">ワールドページを開く</a>`
      : `<a class="open-btn need-id" href="#" title="上のUser ID欄に自分のusr_...を入力すると使えます">ワールドページを開く</a>`;
    const authorHtml = settings.showAuthor && w.author
      ? `<p class="author">作者: ${w.authorId
          ? `<a href="https://vrchat.com/home/user/${esc(w.authorId)}" target="_blank" rel="noopener">${esc(w.author)}</a>`
          : esc(w.author)}</p>`
      : '';
    const tags = [
      w.season && `<span class="tag t-season">${esc(w.season)}</span>`,
      w.brightness && `<span class="tag t-bright">${esc(w.brightness)}</span>`,
      w.event.label && w.event.label !== '関連なし' && `<span class="tag t-event">${esc(w.event.label)}</span>`,
      ...w.locations.map((l) => `<span class="tag t-loc">${esc(l)}</span>`),
    ].filter(Boolean).join('');
    return `<article class="card${w.available ? '' : ' unavailable'}">
      <a class="thumb" href="${esc(w.url)}" target="_blank" rel="noopener">
        <img loading="lazy" src="${esc(w.thumb || PLACEHOLDER)}" alt="${esc(w.name)}のサムネイル">
        ${w.available ? '' : '<span class="badge">非公開/削除の可能性</span>'}
      </a>
      <div class="card-body">
        <h3 class="world-name">${esc(w.name)}</h3>
        ${authorHtml}
        <div class="tags">${tags}</div>
        ${settings.showDesc && w.description ? `<p class="desc">${esc(w.description)}</p>` : ''}
        ${openBtn}
      </div>
    </article>`;
  }

  function update() {
    ['#f-season', '#f-brightness', '#f-event', '#f-location'].forEach((s) => $(s)._sync());
    $('#loc-mode').textContent = state.locMode;

    const results = applySort(applyFilters());
    const grid = $('#grid');
    grid.style.setProperty('--cols', settings.cols);
    grid.innerHTML = results.map(card).join('');
    grid.querySelectorAll('img').forEach((img) => {
      img.addEventListener('error', () => { img.src = PLACEHOLDER; }, { once: true });
    });
    $('#empty').hidden = results.length > 0;
    $('#hit-count').textContent = `${results.length}件 / 全${worlds.length}件`;
    $('#cols-value').textContent = `${settings.cols}列`;
  }

  // ---------- イベントハンドラ ----------
  $('#keyword').addEventListener('input', (e) => { state.q = e.target.value; update(); });
  $('#clear-btn').addEventListener('click', () => {
    state.q = ''; state.season = null; state.brightness = null; state.event = null; state.locs.clear();
    $('#keyword').value = '';
    update();
  });
  $('#loc-mode').addEventListener('click', () => {
    state.locMode = state.locMode === 'OR' ? 'AND' : 'OR';
    update();
  });
  $('#sort').addEventListener('change', (e) => { settings.sort = e.target.value; saveSettings(); update(); });
  $('#cols').addEventListener('input', (e) => { settings.cols = Number(e.target.value); saveSettings(); update(); });
  $('#show-desc').addEventListener('change', (e) => { settings.showDesc = e.target.checked; saveSettings(); update(); });
  $('#show-author').addEventListener('change', (e) => { settings.showAuthor = e.target.checked; saveSettings(); update(); });
  $('#user-id').addEventListener('input', (e) => { settings.userId = e.target.value.trim(); saveSettings(); update(); });
  $('#grid').addEventListener('click', (e) => {
    const btn = e.target.closest('.need-id');
    if (btn) {
      e.preventDefault();
      alert('inviteインスタンスを作るには、検索パネルの「VRChat User ID」欄に自分のUser ID（usr_...）を入力してください。\nUser IDはVRChat公式サイトの自分のプロフィールページのURLで確認できます。');
    }
  });

  // ---------- 初期化 ----------
  $('#sort').value = settings.sort;
  $('#cols').value = settings.cols;
  $('#show-desc').checked = settings.showDesc;
  $('#show-author').checked = settings.showAuthor;
  $('#user-id').value = settings.userId;
  if (DATA.generatedAt) {
    const d = new Date(DATA.generatedAt);
    $('#updated-at').textContent = `データ更新: ${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  }
  update();
})();
