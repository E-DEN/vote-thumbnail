import { state, LS_SIDEBAR_ORDER } from './state.js';

const channels = state.channels;

export let sidebarOrder = [];

export function replaceSidebarOrder(nextOrder) {
  sidebarOrder = nextOrder;
}

export function channelKeyFromUrl(url) {
  const m = url.match(/@([\w.-]+)/);
  if (m) return m[1].toLowerCase();
  const mi = url.match(/UC([\w-]+)/);
  if (mi) return 'UC' + mi[1];
  return url.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20) || 'channel';
}

export function loadSidebarOrder() {
  const raw = localStorage.getItem(LS_SIDEBAR_ORDER);
  sidebarOrder = raw ? JSON.parse(raw) : [];
}

export function saveSidebarOrder() {
  try { localStorage.setItem(LS_SIDEBAR_ORDER, JSON.stringify(sidebarOrder)); } catch {}
}

export function syncSidebarOrder() {
  const known = new Set(Object.keys(channels));
  // 削除済みチャンネルのエントリを除去
  sidebarOrder = sidebarOrder.filter(item => {
    if (item.type === 'channel') return known.has(item.key);
    if (item.type === 'folder') {
      item.children = item.children.filter(k => known.has(k));
      return item.children.length > 0;
    }
    return false;
  });
  // 子が1件のフォルダを解除してチャンネル直置きに変換
  sidebarOrder = sidebarOrder.map(item =>
    (item.type === 'folder' && item.children.length === 1)
      ? { type: 'channel', key: item.children[0] } : item
  );
  // フォルダ内にあるチャンネルのスタンドアロンエントリを除去（重複防止）
  const inFolders = new Set();
  sidebarOrder.forEach(item => { if (item.type === 'folder') item.children.forEach(k => inFolders.add(k)); });
  sidebarOrder = sidebarOrder.filter(item => !(item.type === 'channel' && inFolders.has(item.key)));
  // まだ order に入っていないチャンネルを末尾に追加
  const inOrder = new Set();
  sidebarOrder.forEach(item => {
    if (item.type === 'channel') inOrder.add(item.key);
    else if (item.type === 'folder') item.children.forEach(k => inOrder.add(k));
  });
  Object.keys(channels).forEach(k => {
    if (!inOrder.has(k)) sidebarOrder.push({ type: 'channel', key: k });
  });
}