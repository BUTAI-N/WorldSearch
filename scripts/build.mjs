// BCC VRChatワールド検索 - ビルドスクリプト
// data/worlds.csv を読み込み、VRChat API からワールド名・サムネを取得して
// site/data.js / site/data.json を生成する。依存パッケージなし（Node 18+）。
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = path.join(ROOT, 'data', 'worlds.csv');
const CACHE_DIR = path.join(ROOT, '.cache');
const CACHE_PATH = path.join(CACHE_DIR, 'worlds-cache.json');
const SITE_DIR = path.join(ROOT, 'site');

const API_BASE = 'https://api.vrchat.cloud/api/1/worlds/';
const USER_AGENT = 'BCC-VRChat-World-Search/1.0 (open-source world list; contact via GitHub)';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7日でサムネ等を再取得
const REQUEST_INTERVAL_MS = 1000; // API負荷軽減のため1件/秒

// ---------- CSVパーサー（RFC4180準拠: 引用符・引用内改行・カンマ対応） ----------
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = text.replace(/^﻿/, ''); // BOM除去
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// ---------- ヘッダー行を探して列を対応付け ----------
function mapColumns(rows) {
  const headerIndex = rows.findIndex((r) => r.some((c) => c.includes('ワールド名')));
  if (headerIndex === -1) throw new Error('ヘッダー行（「ワールド名」を含む行）が見つかりません');
  const header = rows[headerIndex];
  const find = (pred) => header.findIndex(pred);
  const cols = {
    name: find((h) => h.includes('ワールド名')),
    url: find((h) => h.toUpperCase().includes('URL')),
    season: find((h) => h.includes('季節')),
    brightness: find((h) => h.includes('明るさ')),
    event: find((h) => h.includes('行事') || h.includes('イベント')),
    location: find((h) => h.includes('ロケーション')),
    description: find((h) => h.includes('説明')),
  };
  for (const [key, idx] of Object.entries(cols)) {
    if (idx === -1) console.warn(`警告: 列「${key}」が見つかりません`);
  }
  return { headerIndex, cols };
}

// ---------- 行事イベント「数字 ラベル」を解析（数字＝月、並び順に使用） ----------
function parseEvent(raw) {
  const value = (raw || '').trim();
  if (!value) return { month: null, label: '' };
  const m = value.match(/^(\d+)\s*(.*)$/);
  if (m) return { month: Number(m[1]), label: m[2].trim() || value };
  return { month: null, label: value };
}

// ---------- VRChat API ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWorld(worldId) {
  const res = await fetch(API_BASE + worldId, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (res.status === 404) return { ok: false, status: 404 };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const w = await res.json();
  return {
    ok: true,
    name: w.name,
    thumbnailImageUrl: w.thumbnailImageUrl,
    imageUrl: w.imageUrl,
    releaseStatus: w.releaseStatus,
    authorName: w.authorName,
    authorId: w.authorId,
  };
}

// ---------- メイン ----------
async function main() {
  const csvText = await readFile(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  const { headerIndex, cols } = mapColumns(rows);

  // キャッシュ読み込み
  let cache = { version: 1, worlds: {} };
  if (existsSync(CACHE_PATH)) {
    try { cache = JSON.parse((await readFile(CACHE_PATH, 'utf8')).replace(/^﻿/, '')); }
    catch { console.warn('警告: キャッシュが壊れているため作り直します'); }
  }

  const worlds = [];
  let fetched = 0;

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    const get = (idx) => (idx >= 0 && idx < row.length ? row[idx].trim() : '');
    const urlRaw = get(cols.url);
    const nameCsv = get(cols.name);
    if (!urlRaw && !nameCsv) continue; // 空行はスキップ

    const idMatch = urlRaw.match(/wrld_[0-9a-fA-F-]+/);
    if (!idMatch) {
      console.warn(`警告: ${i + 1}行目「${nameCsv}」のURLから worldId を抽出できませんでした。スキップします`);
      continue;
    }
    const worldId = idMatch[0];

    // キャッシュ確認（TTL内ならAPIを呼ばない）
    let entry = cache.worlds[worldId];
    const stale = !entry || !entry.fetchedAt || Date.now() - entry.fetchedAt > CACHE_TTL_MS || (entry.ok && !entry.authorId);
    if (stale) {
      if (fetched > 0) await sleep(REQUEST_INTERVAL_MS);
      try {
        const result = await fetchWorld(worldId);
        entry = { ...result, fetchedAt: Date.now() };
        cache.worlds[worldId] = entry;
        fetched++;
        console.log(`取得: ${worldId} → ${result.ok ? result.name : '取得不可(' + result.status + ')'}`);
      } catch (e) {
        console.warn(`警告: ${worldId} の取得に失敗（${e.message}）。${entry ? '古いキャッシュを使用' : 'CSVの値を使用'}`);
        if (!entry) entry = { ok: false };
      }
    }

    worlds.push({
      id: worldId,
      name: (entry.ok && entry.name) || nameCsv || worldId,
      url: `https://vrchat.com/home/world/${worldId}`,
      thumb: (entry.ok && entry.thumbnailImageUrl) || '',
      image: (entry.ok && entry.imageUrl) || '',
      author: (entry.ok && entry.authorName) || '',
      authorId: (entry.ok && entry.authorId) || '',
      season: get(cols.season),
      brightness: get(cols.brightness),
      event: parseEvent(get(cols.event)),
      locations: get(cols.location).split(/[、,]/).map((t) => t.trim()).filter(Boolean),
      description: get(cols.description),
      available: !!entry.ok,
    });
  }

  const data = { generatedAt: new Date().toISOString(), count: worlds.length, worlds };

  await mkdir(CACHE_DIR, { recursive: true });
  await mkdir(SITE_DIR, { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
  await writeFile(path.join(SITE_DIR, 'data.json'), JSON.stringify(data, null, 2));
  await writeFile(
    path.join(SITE_DIR, 'data.js'),
    '// 自動生成ファイル。手動で編集しないでください（scripts/build.mjs が生成）\n' +
      'window.WORLD_DATA = ' + JSON.stringify(data) + ';\n'
  );
  console.log(`完了: ${worlds.length}件のワールド（API取得 ${fetched}件、キャッシュ ${worlds.length - fetched}件）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
