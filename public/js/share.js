import { state } from './state.js';
import { saveChannels } from './storage.js';
import { showToast } from './toast.js';
import { getRssOnly, apiKeyHeaders } from './channel.js';
import { sidebarOrder, saveSidebarOrder } from './sidebar-order.js';

const channels = state.channels;

let _showShareImportPopup;
let _renderSidebar;
let _startRefreshSpinner;
let _stopRefreshSpinner;
let _buildChannelItem;
let _refreshingKeys;

export function configureShare(config) {
  _showShareImportPopup = config.showShareImportPopup;
  _renderSidebar = config.renderSidebar;
  _startRefreshSpinner = config.startRefreshSpinner;
  _stopRefreshSpinner = config.stopRefreshSpinner;
  _buildChannelItem = config.buildChannelItem;
  _refreshingKeys = config.refreshingKeys;
}

// 共有リンク生成・コピー共通処理
export async function postShareLink(payload) {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error();
  const { code } = await res.json();
  const url = location.origin + location.pathname + '#s=' + code;
  await navigator.clipboard.writeText(url).catch(() => {});
  showToast(t('share-link-copied'));
}

export async function shareChannelLink(ch) {
  try {
    await postShareLink({ channels: { [ch.key]: { tags: ch.tags || [], title: ch.displayName || '', icon_url: ch.avatar || '' } }, sidebarOrder: [{ type: 'channel', key: ch.key }] });
  } catch { showToast(t('share-link-err'), 'err'); }
}

export async function shareFolderLink(folder) {
  const chPayload = {};
  (folder.children || []).forEach(k => {
    const c = channels[k];
    chPayload[k] = { tags: c?.tags || [], title: c?.displayName || '', icon_url: c?.avatar || '' };
  });
  try {
    await postShareLink({ channels: chPayload, sidebarOrder: [{ type: 'folder', id: folder.id, name: folder.name, hue: folder.color, children: folder.children || [], open: true }] });
  } catch { showToast(t('share-link-err'), 'err'); }
}

export async function importFromShareCode(code) {
  // コンパクト追加ポップアップが開いていれば先に閉じる
  const _cp = document.querySelector('.sidebar-compact-add-pop');
  if (_cp && !_cp.hidden) {
    _cp.classList.remove('visible');
    setTimeout(function() { _cp.hidden = true; }, 160);
  }
  try {
    const res = await fetch('/api/share/' + code);
    if (!res.ok) { showToast(t('share-link-not-found'), 'err'); return; }
    const data = await res.json();
    if (!data.channels || typeof data.channels !== 'object') return;
    let dbMap = {};
    try {
      const allRes = await fetch('/api/channels');
      if (allRes.ok) dbMap = Object.fromEntries((await allRes.json()).map(c => [c.channel_id, c]));
    } catch { /* ignore */ }
    const channelIds = Object.keys(data.channels);
    const chInfos = channelIds.map(id => dbMap[id] || { channel_id: id, title: data.channels[id]?.title || id, icon_url: data.channels[id]?.icon_url || '', handle: '' });
    const selectedIds = await new Promise((resolve, reject) => { _showShareImportPopup(chInfos, resolve, reject); });
    if (!selectedIds.length) return;
    if (data.sidebarOrder && Array.isArray(data.sidebarOrder)) {
      for (const item of data.sidebarOrder) {
        if (!sidebarOrder.some(i => (i.type === item.type && (i.key === item.key || i.id === item.id)))) sidebarOrder.push(item);
      }
      saveSidebarOrder();
    }
    for (const [id, meta] of Object.entries(data.channels)) {
      if (!selectedIds.includes(id)) continue;
      if (dbMap[id]) channels[id] = { key: id, channelId: id, handle: dbMap[id].handle, displayName: dbMap[id].title, avatar: dbMap[id].icon_url, tags: meta.tags || channels[id]?.tags || [], addedAt: channels[id]?.addedAt || new Date().toISOString() };
      else channels[id] = { key: id, channelId: id, handle: channels[id]?.handle || '', displayName: meta.title || channels[id]?.displayName || '', avatar: meta.icon_url || channels[id]?.avatar || '', tags: meta.tags || channels[id]?.tags || [], addedAt: channels[id]?.addedAt || new Date().toISOString() };
    }
    saveChannels();
    _renderSidebar();
    showToast(t('status-ch-fetching'), 'loading');
    (async () => {
      // 選択した全チャンネルをリフレッシュ（既存・新規問わずフォルダリフレッシュと同じ挙動）
      selectedIds.forEach(id => _refreshingKeys.add(id));
      // 既存 DOM にも即反映（renderSidebar より後に _refreshingKeys を追加するため手動で付与）
      document.querySelectorAll('.sidebar-folder-header').forEach(h => {
        const folderEntry = sidebarOrder.find(i => i.type === 'folder' && i.id === h.dataset.folderId);
        if (folderEntry?.children?.some(k => _refreshingKeys.has(k))) h.classList.add('compact-refreshing');
      });
      let totalVideos = 0, addedVideos = 0, updatedVideos = 0;
      for (const id of selectedIds) {
        const item = document.querySelector(`.sidebar-channel-item[data-key="${id}"]`);
        const chRefBtn = item?.querySelector('.ch-action-refresh');
        if (chRefBtn) _startRefreshSpinner(chRefBtn);
        if (item) item.classList.add('compact-refreshing');
        showToast(t('status-ch-refreshing', { name: channels[id]?.displayName || channels[id]?.handle || id }), 'loading');
        try {
          const r = await fetch('/api/channels/' + id + '/refresh', { method: 'POST', headers: getRssOnly() ? { 'X-RSS-Only': '1' } : apiKeyHeaders() });
          const d = r.ok ? await r.json().catch(() => ({})) : {};
          if (d.channel && channels[id]) {
            channels[id] = { ...channels[id], handle: d.channel.handle, displayName: d.channel.title, avatar: d.channel.icon_url };
            saveChannels();
            const cur = document.querySelector(`.sidebar-channel-item[data-key="${id}"]`);
            if (cur) { const n = _buildChannelItem(channels[id]); cur.replaceWith(n); if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [n] }); }
          }
          if (d.total != null) totalVideos += d.total;
          if (d.added != null) addedVideos += d.added;
          if (d.updated != null) updatedVideos += d.updated;
        } catch { /* ignore */ }
        _refreshingKeys.delete(id);
        if (chRefBtn) _stopRefreshSpinner(chRefBtn);
        const cur2 = document.querySelector(`.sidebar-channel-item[data-key="${id}"]`);
        if (cur2) cur2.classList.remove('compact-refreshing');
        document.querySelectorAll('.sidebar-folder-header.compact-refreshing').forEach(h => {
          const folderEntry = sidebarOrder.find(i => i.type === 'folder' && i.id === h.dataset.folderId);
          if (!folderEntry?.children?.some(k => _refreshingKeys.has(k))) h.classList.remove('compact-refreshing');
        });
      }
      const toastMsg = getRssOnly()
        ? t('status-refresh-rss').replace('{changed}', addedVideos + updatedVideos)
        : t('status-refresh-api').replace('{total}', totalVideos);
      showToast(toastMsg);
    })();
  } catch (e) {
    if (e !== 'cancel') showToast(t('share-link-err'), 'err');
  }
}