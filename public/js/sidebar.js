import { state, WASHOKU_PALETTE } from './state.js';
import { saveChannels, fetchChannelVideos } from './storage.js';
import { showToast } from './toast.js';
import { getRssOnly, apiKeyHeaders } from './channel.js';
import { sidebarOrder, replaceSidebarOrder, saveSidebarOrder, syncSidebarOrder } from './sidebar-order.js';
import { renderCurrentView, showView } from './router.js';
import { shareChannelLink as _shareChannelLink, shareFolderLink as _shareFolderLink } from './share.js';
import { markApiKeyError } from './settings.js';

const channels = state.channels;

let selectChannel;
let _chTooltip = null;
let _chTooltipNameEl = null;
let _chTooltipActionsEl = null;
let _chTooltipHideTimer = null;
let _chTooltipOutsideHandler = null;
let _chTooltipLocked = false;
let _chTooltipGearEscHandler = null;
let _chTooltipF2Action = null;
let _folderColorPop = null;
let _folderColorPopOutsideHandler = null;
let _shiftHeld = false;
let _hoveredTooltipDangerBtn = null; // { iconEl, icon, shiftIcon }
const _refreshingKeys = new Set();

export function configureSidebar({ selectChannel: configuredSelectChannel }) {
  selectChannel = configuredSelectChannel;
}

// --- サイドバー ---
// コンパクト状態を維持

document.addEventListener('keydown', e => {
  if (e.key !== 'Shift' || _shiftHeld) return;
  _shiftHeld = true;
  const hov = document.querySelector('.ch-action-delete:hover');
  if (hov) _setChDelBtnIcon(hov, 'trash-2');
  if (_hoveredTooltipDangerBtn) {
    const { btn, shiftIcon } = _hoveredTooltipDangerBtn;
    _setTooltipBtnIcon(btn, shiftIcon);
  }
});
document.addEventListener('keyup', e => {
  if (e.key !== 'Shift') return;
  _shiftHeld = false;
  const hov = document.querySelector('.ch-action-delete:hover');
  if (hov) _setChDelBtnIcon(hov, 'x');
  if (_hoveredTooltipDangerBtn) {
    const { btn, icon } = _hoveredTooltipDangerBtn;
    _setTooltipBtnIcon(btn, icon);
  }
});

function _setChDelBtnIcon(btn, icon) {
  if (!btn) return;
  btn.innerHTML = `<i data-lucide="${icon}"></i>`;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}

// コンパクトツールチップボタンのアイコンだけ差し替える
// lucide は <i> を <svg> に置換するため iconEl 参照は使えない
function _setTooltipBtnIcon(btn, icon) {
  if (!btn) return;
  const first = btn.firstElementChild;
  if (first) first.remove();
  const i = document.createElement('i');
  i.setAttribute('data-lucide', icon);
  btn.insertBefore(i, btn.firstChild);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}

function _startRefreshSpinner(btn) {
  btn.disabled = true;
}

function _stopRefreshSpinner(btn) {
  btn.disabled = false;
}

// 共有リンクインポート確認ダイアログ（設定モーダルと同スタイル）
// chInfos: [{ channel_id, title, icon_url, handle }]
// onOk: 選択された channel_id[] を引数に呼ぶ
function _showShareImportPopup(chInfos, onOk, onCancel) {
  document.querySelectorAll('.share-import-backdrop').forEach(el => el.remove());
  const backdrop = document.createElement('div');
  backdrop.className = 'share-import-backdrop';
  const dialog = document.createElement('div');
  dialog.className = 'share-import-dialog';
  // ヘッダー
  const hdr = document.createElement('div');
  hdr.className = 'share-import-hdr';
  const title = document.createElement('span');
  title.className = 'share-import-title';
  title.textContent = t('share-link-import-confirm').replace('{count}', chInfos.length);
  hdr.appendChild(title);
  // チャンネル一覧
  const list = document.createElement('ul');
  list.className = 'share-import-ch-list';
  const checkboxes = [];
  chInfos.forEach(ch => {
    const li = document.createElement('li');
    li.className = 'share-import-ch-item';
    if (ch.icon_url) {
      const img = document.createElement('img');
      img.src = ch.icon_url;
      img.className = 'share-import-ch-icon';
      img.referrerPolicy = 'no-referrer';
      img.onerror = function() { this.style.display = 'none'; };
      li.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'share-import-ch-icon share-import-ch-icon--empty';
      li.appendChild(ph);
    }
    const name = document.createElement('span');
    name.className = 'share-import-ch-name';
    name.textContent = ch.title || ch.handle || ch.channel_id;
    li.appendChild(name);
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'rs-dummy-check';
    cb.checked = true;
    cb.dataset.id = ch.channel_id;
    checkboxes.push(cb);
    li.appendChild(cb);
    li.addEventListener('click', e => { if (e.target !== cb) cb.checked = !cb.checked; });
    list.appendChild(li);
  });
  // フッター
  const ftr = document.createElement('div');
  ftr.className = 'share-import-ftr';
  const okBtn = document.createElement('button');
  okBtn.className = 'share-import-ok';
  okBtn.textContent = t('preset-load');
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'share-import-cancel';
  cancelBtn.textContent = t('cancel');
  ftr.append(cancelBtn, okBtn);
  dialog.append(hdr, list, ftr);
  backdrop.appendChild(dialog);
  const _blurTarget = document.querySelector('.app-layout');
  if (_blurTarget) _blurTarget.classList.add('modal-blur');
  document.body.appendChild(backdrop);
  const close = () => { backdrop.remove(); if (_blurTarget) _blurTarget.classList.remove('modal-blur'); };
  okBtn.addEventListener('click', e => {
    e.stopPropagation();
    close();
    onOk(checkboxes.filter(cb => cb.checked).map(cb => cb.dataset.id));
  });
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); close(); if (onCancel) onCancel('cancel'); });
  backdrop.addEventListener('click', e => { if (e.target === backdrop) { close(); if (onCancel) onCancel('cancel'); } });
  const _onEsc = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', _onEsc); close(); if (onCancel) onCancel('cancel'); } };
  document.addEventListener('keydown', _onEsc);
}

function _showChDelPopup(anchorBtn, msg, onConfirm, okClass, anchorRect) {
  // anchorRect を事前渡しできる（コンパクトモードで tooltip hide 前に取得した rect を使う）
  const rect = anchorRect || anchorBtn.getBoundingClientRect();
  document.querySelectorAll('.ch-del-popup').forEach(p => p.remove());
  const popup = document.createElement('div');
  popup.className = 'ch-del-popup';
  popup.style.visibility = 'hidden';
  const msgEl = document.createElement('span');
  msgEl.className = 'ch-del-popup-msg';
  msgEl.textContent = msg;
  const btnRow = document.createElement('div');
  btnRow.className = 'ch-del-popup-btns';
  const okBtn = document.createElement('button');
  okBtn.className = 'ch-del-popup-ok' + (okClass ? ' ' + okClass : '');
  okBtn.textContent = okClass === 'ch-del-popup-ok--refresh' ? t('folder-refresh-ok') : okClass === 'ch-del-popup-ok--folder-delete' ? t('folder-delete-ok') : t('ch-delete-ok');
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ch-del-popup-cancel';
  cancelBtn.textContent = t('cancel');
  btnRow.append(okBtn, cancelBtn);
  popup.append(msgEl, btnRow);
  document.body.appendChild(popup);
  const pw = popup.offsetWidth, ph = popup.offsetHeight;
  // ボタンの真下に表示（左端をボタン左端に揃える）
  let left = rect.left;
  let top  = rect.bottom + 6;
  if (left + pw > window.innerWidth  - 4) left = window.innerWidth  - pw - 4;
  if (left < 4) left = 4;
  if (top  + ph > window.innerHeight - 4) top  = rect.top - ph - 6;
  if (top  < 4) top = 4;
  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';
  popup.style.visibility = '';
  const close = () => {
    popup.remove();
    document.removeEventListener('keydown', escHandler);
  };
  const escHandler = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', escHandler);
  okBtn.addEventListener('click', e => { e.stopPropagation(); close(); onConfirm(); });
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); close(); });
  setTimeout(() => {
    const outside = e => { if (!popup.contains(e.target)) { close(); document.removeEventListener('click', outside, true); } };
    document.addEventListener('click', outside, true);
  }, 0);
}

function deleteChannel(key) {
  delete channels[key];
  saveChannels();
  // sidebarOrder から対象チャンネルを除去
  replaceSidebarOrder(sidebarOrder.filter(item => {
    if (item.type === 'channel') return item.key !== key;
    if (item.type === 'folder') {
      item.children = item.children.filter(k => k !== key);
      return item.children.length > 0;
    }
    return true;
  }));
  // 子が1件のフォルダを解除してチャンネル直置きに変換
  replaceSidebarOrder(sidebarOrder.map(item =>
    (item.type === 'folder' && item.children.length === 1)
      ? { type: 'channel', key: item.children[0] } : item
  ));
  saveSidebarOrder();
  if (state.currentChannelKey === key) {
    state.currentChannelKey = null;
    document.getElementById('chAvatar').style.display = 'none';
    document.getElementById('chName').style.display = 'none';
    document.getElementById('chTabs').style.display = 'none';
    document.getElementById('catFilter').style.display = 'none';
    showView('welcome');
  }
  renderSidebar();
}

function deleteFolder(folderId) {
  const idx = sidebarOrder.findIndex(item => item.type === 'folder' && item.id === folderId);
  if (idx === -1) return;
  const folder = sidebarOrder[idx];
  const channelItems = folder.children.map(key => ({ type: 'channel', key }));
  sidebarOrder.splice(idx, 1, ...channelItems);
  saveSidebarOrder();
  renderSidebar();
}

function deleteFolderWithChannels(folderId) {
  const idx = sidebarOrder.findIndex(item => item.type === 'folder' && item.id === folderId);
  if (idx === -1) return;
  const childKeys = [...sidebarOrder[idx].children];
  for (const key of childKeys) {
    delete channels[key];
  }
  saveChannels();
  sidebarOrder.splice(idx, 1);
  saveSidebarOrder();
  if (childKeys.includes(state.currentChannelKey)) {
    state.currentChannelKey = null;
    document.getElementById('chAvatar').style.display = 'none';
    document.getElementById('chName').style.display = 'none';
    document.getElementById('chTabs').style.display = 'none';
    document.getElementById('catFilter').style.display = 'none';
    showView('welcome');
  }
  renderSidebar();
}

function _updateFolderPreview(channelKey) {
  const folder = sidebarOrder.find(item => item.type === 'folder' && item.children.includes(channelKey));
  if (!folder) return;
  const wrap = document.querySelector(`.sidebar-folder[data-folder-id="${folder.id}"]`);
  if (!wrap) return;
  const preview = wrap.querySelector('.sidebar-folder-preview');
  if (!preview) return;
  preview.querySelectorAll('.sidebar-folder-preview-img').forEach(el => el.remove());
  folder.children.slice(0, 2).forEach(key => {
    const ch = channels[key];
    if (!ch) return;
    const el = ch.avatar
      ? Object.assign(document.createElement('img'), { className: 'sidebar-folder-preview-img', src: ch.avatar, referrerPolicy: 'no-referrer' })
      : Object.assign(document.createElement('div'), { className: 'sidebar-folder-preview-img sidebar-folder-preview-ph' + (_refreshingKeys.has(key) ? ' sidebar-folder-preview-ph--refreshing' : '') });
    if (ch.avatar) el.onerror = () => el.style.display = 'none';
    preview.insertBefore(el, preview.querySelector('.sidebar-folder-open-icon'));
  });
}

function _calcSidebarSlide(el) {
  el.querySelectorAll('.name-inner').forEach(inner => {
    const outer = inner.parentElement;
    if (!outer || !outer.clientWidth) return;
    const overflow = inner.scrollWidth - outer.clientWidth;
    if (overflow > 2) {
      inner.classList.add('overflows');
      const fadeZone = outer.clientWidth * 0.08;
      inner.style.setProperty('--slide-dist', `-${overflow + fadeZone}px`);
    } else {
      inner.classList.remove('overflows');
      inner.style.removeProperty('--slide-dist');
    }
  });
}

// コンパクトモード: チャンネル名ホバーパネルのヘルパー関数
function _showCompactTooltip(anchorRect, name, buttons) {
  if (_chTooltipLocked) return;
  if (_chTooltipHideTimer) { clearTimeout(_chTooltipHideTimer); _chTooltipHideTimer = null; }
  if (_chTooltipOutsideHandler) { document.removeEventListener('click', _chTooltipOutsideHandler); _chTooltipOutsideHandler = null; }
  _chTooltip.style.width = '';
  _chTooltipF2Action = null;
  // 名前ヘッダー: テキスト + 歯車ボタン
  _chTooltipNameEl.innerHTML = '';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'ch-tooltip-name-text';
  nameSpan.textContent = name;
  const gearBtn = document.createElement('button');
  gearBtn.className = 'ch-tooltip-gear';
  gearBtn.innerHTML = '<i data-lucide="settings"></i>';
  _chTooltipNameEl.appendChild(nameSpan);
  _chTooltipNameEl.appendChild(gearBtn);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [gearBtn] });
  // アクションボタン: 非表示で構築、歯車クリックで表示
  _chTooltipActionsEl.style.display = 'none';
  _chTooltipActionsEl.style.visibility = '';
  _chTooltipActionsEl.innerHTML = '';
  buttons.forEach(function(b) {
    const btn = document.createElement('button');
    btn.className = 'ch-tooltip-btn' + (b.danger ? ' danger' : '');
    btn.title = b.title || '';
    const iconEl = document.createElement('i');
    iconEl.setAttribute('data-lucide', b.icon);
    const labelEl = document.createElement('span');
    labelEl.textContent = b.label || '';
    btn.appendChild(iconEl);
    btn.appendChild(labelEl);
    if (b.shiftIcon) {
      btn.dataset.icon = b.icon;
      btn.dataset.shiftIcon = b.shiftIcon;
      btn.addEventListener('mouseenter', function() {
        _hoveredTooltipDangerBtn = { btn, icon: b.icon, shiftIcon: b.shiftIcon };
        if (_shiftHeld) _setTooltipBtnIcon(btn, b.shiftIcon);
      });
      btn.addEventListener('mouseleave', function() {
        _hoveredTooltipDangerBtn = null;
        _setTooltipBtnIcon(btn, b.icon);
      });
    }
    btn.addEventListener('click', function(e) { e.stopPropagation(); if (!_chTooltipLocked) b.onClick(btn, e); });
    _chTooltipActionsEl.appendChild(btn);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: Array.from(_chTooltipActionsEl.querySelectorAll('[data-lucide]')) });
  gearBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    _chTooltipActionsEl.style.display = '';
    _chTooltipActionsEl.style.visibility = '';
    if (_chTooltipGearEscHandler) { document.removeEventListener('keydown', _chTooltipGearEscHandler); }
    _chTooltipGearEscHandler = function(ke) { if (ke.key === 'Escape') { _hideCompactTooltip(0); } };
    document.addEventListener('keydown', _chTooltipGearEscHandler);
    // アクション展開後に高さが増すので再クランプ
    requestAnimationFrame(() => {
      const th = _chTooltip.offsetHeight;
      const maxTop = window.innerHeight - th - 4;
      if (parseFloat(_chTooltip.style.top) > maxTop) _chTooltip.style.top = Math.max(4, maxTop) + 'px';
    });
  });
  _chTooltip.style.top = anchorRect.top + 'px';
  _chTooltip.style.left = (anchorRect.right + 10) + 'px';
  _chTooltip.classList.add('visible');
  // 画面下端からはみ出す場合は上にずらす
  const _clampTooltipTop = () => {
    const th = _chTooltip.offsetHeight;
    const maxTop = window.innerHeight - th - 4;
    if (parseFloat(_chTooltip.style.top) > maxTop) _chTooltip.style.top = Math.max(4, maxTop) + 'px';
  };
  _clampTooltipTop();
}

function _hideCompactTooltip(delay) {
  if (_chTooltipLocked) return;
  if (_chTooltipHideTimer) { clearTimeout(_chTooltipHideTimer); _chTooltipHideTimer = null; }
  function _doHide() {
    _chTooltip.classList.remove('visible');
    if (_chTooltipOutsideHandler) { document.removeEventListener('click', _chTooltipOutsideHandler); _chTooltipOutsideHandler = null; }
    if (_chTooltipGearEscHandler) { document.removeEventListener('keydown', _chTooltipGearEscHandler); _chTooltipGearEscHandler = null; }
    _chTooltipF2Action = null;
    _hoveredTooltipDangerBtn = null;
  }
  if (delay) {
    _chTooltipHideTimer = setTimeout(function() { _doHide(); _chTooltipHideTimer = null; }, delay);
  } else {
    _doHide();
  }
}

function _showFolderColorPop(anchorRect, folder) {
  if (!_folderColorPop) return;
  if (_folderColorPopOutsideHandler) {
    document.removeEventListener('click', _folderColorPopOutsideHandler);
    _folderColorPopOutsideHandler = null;
  }
  _folderColorPop.innerHTML = '';

  WASHOKU_PALETTE.forEach(function(entry) {
    const sw = document.createElement('button');
    const isNone = entry.hue == null;
    sw.className = 'folder-color-swatch' + (isNone ? ' folder-color-swatch--none' : '') + (isNone ? (folder.color == null ? ' active' : '') : (folder.color === entry.hue ? ' active' : ''));
    if (!isNone) sw.style.background = 'hsl(' + entry.hue + ',40%,52%)';
    sw.title = _lang === 'ja' ? entry.name : entry.en;
    sw.addEventListener('click', function(e) {
      e.stopPropagation();
      folder.color = isNone ? null : entry.hue;
      saveSidebarOrder();
      renderSidebar();
      _hideFolderColorPop();
    });
    _folderColorPop.appendChild(sw);
  });

  _folderColorPop.hidden = false;
  requestAnimationFrame(function() {
    _folderColorPop.classList.add('visible');
    const pw = _folderColorPop.offsetWidth;
    const ph = _folderColorPop.offsetHeight;
    let left = anchorRect.right + 8;
    let top  = anchorRect.top;
    if (left + pw > window.innerWidth - 4) left = anchorRect.left - pw - 8;
    if (top  + ph > window.innerHeight - 4) top = Math.max(4, window.innerHeight - ph - 4);
    _folderColorPop.style.left = Math.max(4, left) + 'px';
    _folderColorPop.style.top  = top + 'px';
  });

  setTimeout(function() {
    _folderColorPopOutsideHandler = function(e) {
      if (_folderColorPop && !_folderColorPop.contains(e.target)) _hideFolderColorPop();
    };
    document.addEventListener('click', _folderColorPopOutsideHandler);
  }, 0);
}

function _hideFolderColorPop() {
  if (!_folderColorPop) return;
  _folderColorPop.classList.remove('visible');
  if (_folderColorPopOutsideHandler) {
    document.removeEventListener('click', _folderColorPopOutsideHandler);
    _folderColorPopOutsideHandler = null;
  }
  setTimeout(function() {
    if (!_folderColorPop.classList.contains('visible')) _folderColorPop.hidden = true;
  }, 150);
}

function _showCompactRename(anchorBtn, currentName, onCommit) {
  document.querySelectorAll('.ch-compact-rename-pop').forEach(function(p) { p.remove(); });
  const pop = document.createElement('div');
  pop.className = 'ch-compact-rename-pop';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'ch-compact-rename-input';
  inp.value = currentName;
  inp.maxLength = 40;
  const submit = document.createElement('button');
  submit.className = 'ch-compact-rename-submit';
  submit.innerHTML = '<i data-lucide="check"></i>';
  pop.append(inp, submit);
  document.body.appendChild(pop);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [submit] });
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.top  = (rect.top + rect.height / 2 - pop.offsetHeight / 2) + 'px';
  pop.style.left = (rect.right + 8) + 'px';
  inp.focus();
  inp.select();
  function commit() {
    const v = inp.value.trim().slice(0, 40);
    pop.remove();
    document.removeEventListener('click', outside, true);
    if (v) onCommit(v);
  }
  function outside(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', outside, true); } }
  submit.addEventListener('click', function(e) { e.stopPropagation(); commit(); });
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { pop.remove(); document.removeEventListener('click', outside, true); }
  });
  setTimeout(function() { document.addEventListener('click', outside, true); }, 0);
}

function _startTooltipInlineRename(currentName, onCommit) {
  let _done = false;
  _chTooltipLocked = true;
  // 自然幅を測定するためアクションパネルが非表示なら一時展開する(F2経由時)
  if (_chTooltipActionsEl.style.display === 'none') {
    _chTooltipActionsEl.style.visibility = 'hidden';
    _chTooltipActionsEl.style.display = '';
  }
  const _naturalWidth = _chTooltip.getBoundingClientRect().width;
  _chTooltipActionsEl.style.display = 'none';
  _chTooltipActionsEl.style.visibility = '';
  _chTooltip.style.width = Math.max(_naturalWidth, 160) + 'px';
  if (_chTooltipGearEscHandler) { document.removeEventListener('keydown', _chTooltipGearEscHandler); _chTooltipGearEscHandler = null; }
  _chTooltipNameEl.innerHTML = '';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'ch-tooltip-rename-input';
  inp.value = currentName;
  inp.maxLength = 40;
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'ch-tooltip-gear';
  confirmBtn.innerHTML = '<i data-lucide="check"></i>';
  _chTooltipNameEl.appendChild(inp);
  _chTooltipNameEl.appendChild(confirmBtn);
  if (typeof lucide !== 'undefined') {
    lucide.createIcons({ nodes: [confirmBtn] });
    const checkSvg = confirmBtn.querySelector('svg');
    if (checkSvg) { checkSvg.setAttribute('width', '13'); checkSvg.setAttribute('height', '13'); }
  }
  function finish(save) {
    if (_done) return;
    _done = true;
    _chTooltipLocked = false;
    document.removeEventListener('click', outsideHandler, true);
    const v = save ? inp.value.trim().slice(0, 40) : '';
    if (v && v !== currentName) onCommit(v);
    _hideCompactTooltip(0);
  }
  function outsideHandler(e) {
    if (!_chTooltip.contains(e.target)) { finish(true); }
  }
  confirmBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
  confirmBtn.addEventListener('click', function(e) { e.stopPropagation(); finish(true); });
  inp.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { finish(false); }
  });
  setTimeout(function() {
    inp.focus();
    inp.select();
    document.addEventListener('click', outsideHandler, true);
  }, 0);
}

function buildChannelItem(ch) {
  const item = document.createElement('div');
  item.className = 'sidebar-channel-item' + (state.currentChannelKey === ch.key ? ' active' : '');
  item.dataset.key = ch.key;
  if (_refreshingKeys.has(ch.key)) item.classList.add('compact-refreshing');
  const name = ch.displayName || ch.handle || ch.key;
  const avatarEl = ch.avatar
    ? `<img class="sidebar-ch-avatar" src="${ch.avatar}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : `<div class="sidebar-ch-avatar"></div>`;
  item.innerHTML = `<div class="sidebar-ch-avatar-wrap">${avatarEl}</div><span class="sidebar-ch-name"><span class="name-inner">${name}</span></span>`;

  // アクションボタン
  const actions = document.createElement('div');
  actions.className = 'ch-actions';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'ch-action-btn ch-action-refresh';
  refreshBtn.title = t('ch-refresh-title');
  refreshBtn.innerHTML = '<i data-lucide="refresh-cw"></i>';

  const shareBtn = document.createElement('button');
  shareBtn.className = 'ch-action-btn ch-action-share';
  shareBtn.title = t('share-link-copy-title');
  shareBtn.innerHTML = '<i data-lucide="copy"></i>';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'ch-action-btn ch-action-delete';
  deleteBtn.title = t('ch-delete-title');
  deleteBtn.innerHTML = '<i data-lucide="x"></i>';

  actions.append(refreshBtn, shareBtn, deleteBtn);
  item.appendChild(actions);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [refreshBtn, shareBtn, deleteBtn] });

  item.addEventListener('click', () => selectChannel(ch.key));

  shareBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await _shareChannelLink(ch);
  });

  refreshBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const key = ch.key;
    if (_refreshingKeys.has(key)) return;
    _refreshingKeys.add(key);
    item.classList.add('compact-refreshing');
    if (key !== state.currentChannelKey) await selectChannel(key);
    _startRefreshSpinner(refreshBtn);
    showToast(t('status-ch-fetching'), 'loading');
    // リフレッシュ中に定期ポーリングしてギャラリーをライブ更新
    const _pollRefresh = setInterval(async () => {
      if (key !== state.currentChannelKey) return;
      const videos = await fetchChannelVideos(key);
      if (videos.length !== state.allVideos.length) {
        state.allVideos = videos;
        renderCurrentView();
      }
    }, 2500);
    try {
      const res = await fetch('/api/channels/' + key + '/refresh', { method: 'POST', headers: getRssOnly() ? { 'X-RSS-Only': '1' } : apiKeyHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(data.error || t('status-refresh-err'), true);
        // 失敗してもDBに既存動画があれば反映する
        const fallback = await fetchChannelVideos(key).catch(() => null);
        if (fallback && fallback.length > 0 && key === state.currentChannelKey) {
          state.allVideos = fallback;
          renderCurrentView();
        }
        return;
      }
      if (data.apiKeyError) { markApiKeyError(); showToast(t('apikey-err-details'), true); }
      const toastMsg = getRssOnly()
        ? t('status-refresh-rss').replace('{changed}', (data.added ?? 0) + (data.updated ?? 0))
        : t('status-refresh-api').replace('{total}', data.total ?? '?');
      showToast(toastMsg);
      state.allVideos = await fetchChannelVideos(key);
      renderCurrentView();
    } catch (err) { showToast(t('status-refresh-err'), true); console.error('refresh:', err); }
    finally {
      clearInterval(_pollRefresh);
      _refreshingKeys.delete(key);
      _stopRefreshSpinner(refreshBtn);
      document.querySelectorAll(`.sidebar-channel-item[data-key="${key}"]`).forEach(el => el.classList.remove('compact-refreshing'));
    }
  });

  deleteBtn.addEventListener('mouseenter', () => { if (_shiftHeld) _setChDelBtnIcon(deleteBtn, 'trash-2'); });
  deleteBtn.addEventListener('mouseleave', () => { _setChDelBtnIcon(deleteBtn, 'x'); });
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    const key = ch.key;
    const doDelete = () => deleteChannel(key);
    if (e.shiftKey) {
      doDelete();
    } else {
      _showChDelPopup(deleteBtn, t('ch-delete-confirm').replace('{name}', name), doDelete);
    }
  });
  // コンパクト時のチャンネル名ツールチップ + アクションパネル
  item.addEventListener('mouseenter', () => {
    _calcSidebarSlide(item);
    if (!_chTooltip || !document.getElementById('sidebar').classList.contains('sidebar--compact')) return;
    const _nav = document.getElementById('sidebarNav');
    if (_nav.classList.contains('sidebar--folder-dragging')) return;
    if (item.closest('.sidebar-folder-children') && _nav.classList.contains('sidebar--dragging')) return;
    if (item.classList.contains('sidebar--drag-source')) return;
    const rect = item.getBoundingClientRect();
    _showCompactTooltip(rect, name, [
      { icon: 'refresh-cw', label: t('ch-refresh-title'), title: t('ch-refresh-title'), onClick: (_btn) => {
        _hideCompactTooltip(0);
        refreshBtn.dispatchEvent(new MouseEvent('click'));
      }},
      { icon: 'copy', label: t('m-ch-share'), title: t('m-ch-share'), onClick: async () => {
        _hideCompactTooltip(0);
        await _shareChannelLink(ch);
      }},
      { icon: 'x', shiftIcon: 'trash-2', label: t('ch-delete-title'), title: t('ch-delete-title'), danger: true, onClick: (btn, e) => {
        const savedRect = btn.getBoundingClientRect();
        _hideCompactTooltip(0);
        if (e.shiftKey) { deleteChannel(ch.key); }
        else { _showChDelPopup(btn, t('ch-delete-confirm').replace('{name}', name), () => deleteChannel(ch.key), undefined, savedRect); }
      }}
    ]);
  });
  item.addEventListener('mouseleave', () => { if (_chTooltip) _hideCompactTooltip(200); });
  return item;
}

function randomFolderColor() {
  const colored = WASHOKU_PALETTE.filter(e => e.hue != null);
  return colored[Math.floor(Math.random() * colored.length)].hue;
}

function buildFolderItem(folder) {
  const wrap = document.createElement('div');
  wrap.className = 'sidebar-folder' + (folder.open ? ' sidebar-folder--open' : '');
  wrap.dataset.folderId = folder.id;

  const header = document.createElement('div');
  header.className = 'sidebar-folder-header';
  header.dataset.folderId = folder.id;
  header.tabIndex = 0;
  if (folder.children.some(k => _refreshingKeys.has(k))) header.classList.add('compact-refreshing');

  const preview = document.createElement('div');
  preview.className = 'sidebar-folder-preview';
  if (folder.color != null) {
    wrap.style.setProperty('--folder-tint', 'hsla(' + folder.color + ',60%,45%,0.18)');
  }
  folder.children.slice(0, 2).forEach(key => {
    const ch = channels[key];
    if (!ch) return;
    const el = ch.avatar
      ? Object.assign(document.createElement('img'), { className: 'sidebar-folder-preview-img', src: ch.avatar, referrerPolicy: 'no-referrer' })
      : Object.assign(document.createElement('div'), { className: 'sidebar-folder-preview-img sidebar-folder-preview-ph' + (_refreshingKeys.has(key) ? ' sidebar-folder-preview-ph--refreshing' : '') });
    if (ch.avatar) el.onerror = () => el.style.display = 'none';
    preview.appendChild(el);
  });
  const folderIcon = document.createElement('div');
  folderIcon.className = 'sidebar-folder-open-icon';
  folderIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  preview.appendChild(folderIcon);
  header.appendChild(preview);

  const nameEl = document.createElement('span');
  nameEl.className = 'sidebar-folder-name';
  const nameInnerEl = document.createElement('span');
  nameInnerEl.className = 'name-inner';
  nameInnerEl.textContent = folder.name || '';
  nameEl.appendChild(nameInnerEl);
  header.appendChild(nameEl);

  const folderActions = document.createElement('div');
  folderActions.className = 'ch-actions';

  const folderRenameBtn = document.createElement('button');
  folderRenameBtn.className = 'ch-action-btn ch-action-rename';
  folderRenameBtn.title = t('folder-rename');
  folderRenameBtn.innerHTML = '<i data-lucide="pencil"></i>';

  const folderRefreshBtn = document.createElement('button');
  folderRefreshBtn.className = 'ch-action-btn ch-action-refresh';
  folderRefreshBtn.title = t('folder-refresh');
  folderRefreshBtn.innerHTML = '<i data-lucide="refresh-cw"></i>';

  const folderShareBtn = document.createElement('button');
  folderShareBtn.className = 'ch-action-btn ch-action-share';
  folderShareBtn.title = t('share-link-copy-title');
  folderShareBtn.innerHTML = '<i data-lucide="copy"></i>';

  const folderDeleteBtn = document.createElement('button');
  folderDeleteBtn.className = 'ch-action-btn ch-action-delete';
  folderDeleteBtn.title = t('folder-delete');
  folderDeleteBtn.innerHTML = '<i data-lucide="x"></i>';

  folderActions.append(folderRenameBtn, folderRefreshBtn, folderShareBtn, folderDeleteBtn);
  header.appendChild(folderActions);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [folderRenameBtn, folderRefreshBtn, folderShareBtn, folderDeleteBtn] });

  folderShareBtn.addEventListener('click', async e => {
    e.stopPropagation();
    await _shareFolderLink(folder);
  });

  folderRenameBtn.addEventListener('click', e => { e.stopPropagation(); startRename(); });

  folderRefreshBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const doRefresh = async () => {
      const keys = [...folder.children].filter(k => !_refreshingKeys.has(k));
      if (!keys.length) return;
      keys.forEach(k => _refreshingKeys.add(k));
      _startRefreshSpinner(folderRefreshBtn);
      header.classList.add('compact-refreshing');
      try {
        let totalVideos = 0;
        let addedVideos = 0;
        let updatedVideos = 0;
        for (const key of keys) {
          // 子チャンネルアイテムのリフレッシュボタンにもスピナーを表示
          const chItem = document.querySelector(`.sidebar-channel-item[data-key="${key}"]`);
          const chRefBtn = chItem?.querySelector('.ch-action-refresh');
          if (chRefBtn) _startRefreshSpinner(chRefBtn);
          if (chItem) chItem.classList.add('compact-refreshing');
        showToast(t('status-ch-refreshing', { name: channels[key]?.displayName || channels[key]?.handle || '' }), 'loading');
          try {
            const res = await fetch('/api/channels/' + key + '/refresh', { method: 'POST', headers: getRssOnly() ? { 'X-RSS-Only': '1' } : apiKeyHeaders() });
            const data = await res.json().catch(() => ({}));
            if (data.apiKeyError) { markApiKeyError(); showToast(t('apikey-err-details'), true); if (chRefBtn) _stopRefreshSpinner(chRefBtn); _refreshingKeys.delete(key); document.querySelectorAll(`.sidebar-channel-item[data-key="${key}"]`).forEach(el => el.classList.remove('compact-refreshing')); break; }
            if (data.total != null) totalVideos += data.total;
            if (data.added != null) addedVideos += data.added;
            if (data.updated != null) updatedVideos += data.updated;
          } catch (err) { console.error('folder refresh:', err); }
          _refreshingKeys.delete(key);
          if (chRefBtn) _stopRefreshSpinner(chRefBtn);
          document.querySelectorAll(`.sidebar-channel-item[data-key="${key}"]`).forEach(el => el.classList.remove('compact-refreshing'));
          // チャンネル完了ごとに即UIへ反映
          if (key === state.currentChannelKey) {
            state.allVideos = await fetchChannelVideos(key);
            renderCurrentView();
          }
        }
        const toastMsg = getRssOnly()
          ? t('status-refresh-rss').replace('{changed}', addedVideos + updatedVideos)
          : t('status-refresh-api').replace('{total}', totalVideos);
        showToast(toastMsg);
      } finally {
        _stopRefreshSpinner(folderRefreshBtn);
        document.querySelector(`.sidebar-folder-header[data-folder-id="${folder.id}"]`)?.classList.remove('compact-refreshing');
      }
    };
    if (e.shiftKey) {
      await doRefresh();
    } else {
      const count = folder.children.length;
      const msg = t('folder-refresh-confirm').replace('{name}', folder.name || '').replace('{count}', count);
      _showChDelPopup(folderRefreshBtn, msg, doRefresh, 'ch-del-popup-ok--refresh');
    }
  });

  folderDeleteBtn.addEventListener('mouseenter', () => { if (_shiftHeld) _setChDelBtnIcon(folderDeleteBtn, 'trash-2'); });
  folderDeleteBtn.addEventListener('mouseleave', () => { _setChDelBtnIcon(folderDeleteBtn, 'x'); });
  folderDeleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    const fid = folder.id;
    const fname = folder.name || '';
    const doDelete = () => deleteFolder(fid);
    if (e.shiftKey) {
      deleteFolderWithChannels(fid);
    } else {
      _showChDelPopup(folderDeleteBtn, t('folder-delete-confirm').replace('{name}', fname), doDelete, 'ch-del-popup-ok--folder-delete');
    }
  });

  function startRename() {
    if (nameEl.contentEditable === 'plaintext-only' || nameEl.contentEditable === 'true') return;
    const prev = folder.name || '';
    nameEl.textContent = prev;
    nameEl.contentEditable = 'plaintext-only';
    nameEl.focus();
    const sel = window.getSelection(), range = document.createRange();
    range.selectNodeContents(nameEl); sel.removeAllRanges(); sel.addRange(range);
    function onMouseDown(e) { e.stopPropagation(); }
    function onKeyDown(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
      if (ev.key === 'Escape') {
        nameEl.contentEditable = 'false';
        nameEl.innerHTML = '';
        const ni = document.createElement('span');
        ni.className = 'name-inner';
        ni.textContent = prev;
        nameEl.appendChild(ni);
        nameEl.removeEventListener('blur', commit);
        nameEl.removeEventListener('keydown', onKeyDown);
        nameEl.removeEventListener('mousedown', onMouseDown);
      }
    }
    function commit() {
      nameEl.contentEditable = 'false';
      const next = nameEl.textContent.trim().slice(0, 40) || prev;
      nameEl.innerHTML = '';
      const ni = document.createElement('span');
      ni.className = 'name-inner';
      ni.textContent = next;
      nameEl.appendChild(ni);
      folder.name = next;
      saveSidebarOrder();
      _calcSidebarSlide(header);
      nameEl.removeEventListener('keydown', onKeyDown);
      nameEl.removeEventListener('mousedown', onMouseDown);
    }
    nameEl.addEventListener('blur', commit, { once: true });
    nameEl.addEventListener('keydown', onKeyDown);
    nameEl.addEventListener('mousedown', onMouseDown);
  }

  header.addEventListener('keydown', e => {
    if (e.key === 'F2') { e.preventDefault(); startRename(); }
  });

  // コンパクト時のフォルダ名ツールチップ + アクションパネル
  header.addEventListener('mouseenter', () => {
    _calcSidebarSlide(header);
    if (!_chTooltip || !document.getElementById('sidebar').classList.contains('sidebar--compact')) return;
    if (document.getElementById('sidebarNav').classList.contains('sidebar--folder-dragging')) return;
    if (header.classList.contains('sidebar--drag-source') || wrap.classList.contains('sidebar--drag-source')) return;
    const rect = header.getBoundingClientRect();
    _showCompactTooltip(rect, folder.name || '', [
      { icon: 'pencil', label: t('folder-rename'), title: t('folder-rename'), onClick: () => {
        _startTooltipInlineRename(folder.name || '', function(newName) {
          folder.name = newName;
          saveSidebarOrder();
          renderSidebar();
        });
      }},
      { icon: 'refresh-cw', label: t('ch-refresh-title'), title: t('folder-refresh'), onClick: (_btn) => {
        _hideCompactTooltip(0);
        folderRefreshBtn.dispatchEvent(new MouseEvent('click', { shiftKey: true }));
      }},
      { icon: 'palette', label: t('folder-color'), title: t('folder-color'), onClick: (btn) => {
        const existing = _chTooltipActionsEl.querySelector('.ch-tooltip-color-grid');
        if (existing) { existing.remove(); return; }
        const folderWrap = document.querySelector(`.sidebar-folder[data-folder-id="${folder.id}"]`);
        const applyColor = (hue) => {
          folder.color = hue;
          saveSidebarOrder();
          if (folderWrap) {
            if (hue == null) folderWrap.style.removeProperty('--folder-tint');
            else folderWrap.style.setProperty('--folder-tint', 'hsla(' + hue + ',60%,45%,0.18)');
          }
          // active 状態を更新
          grid.querySelectorAll('.folder-color-swatch').forEach(s => s.classList.remove('active'));
          if (hue == null) grid.querySelector('.folder-color-swatch--none')?.classList.add('active');
          else grid.querySelector(`[data-hue="${hue}"]`)?.classList.add('active');
        };
        const grid = document.createElement('div');
        grid.className = 'ch-tooltip-color-grid';
        WASHOKU_PALETTE.forEach(function(entry) {
          const sw = document.createElement('button');
          const isNone = entry.hue == null;
          sw.className = 'folder-color-swatch' + (isNone ? ' folder-color-swatch--none' : '') + (isNone ? (folder.color == null ? ' active' : '') : (folder.color === entry.hue ? ' active' : ''));
          if (!isNone) sw.style.background = 'hsl(' + entry.hue + ',40%,52%)';
          sw.title = _lang === 'ja' ? entry.name : entry.en;
          if (!isNone) sw.dataset.hue = entry.hue;
          sw.addEventListener('click', function(e) { e.stopPropagation(); applyColor(isNone ? null : entry.hue); });
          grid.appendChild(sw);
        });
        btn.insertAdjacentElement('afterend', grid);
        requestAnimationFrame(() => {
          grid.classList.add('open');
          const th = _chTooltip.offsetHeight;
          const maxTop = window.innerHeight - th - 4;
          if (parseFloat(_chTooltip.style.top) > maxTop) _chTooltip.style.top = Math.max(4, maxTop) + 'px';
        });
      }},
      { icon: 'copy', label: t('folder-share'), title: t('folder-share'), onClick: async () => {
        _hideCompactTooltip(0);
        await _shareFolderLink(folder);
      }},
      { icon: 'x', shiftIcon: 'trash-2', label: t('folder-delete'), title: t('folder-delete'), danger: true, onClick: (btn, e) => {
        const savedRect = btn.getBoundingClientRect();
        _hideCompactTooltip(0);
        if (e.shiftKey) { deleteFolderWithChannels(folder.id); }
        else { _showChDelPopup(btn, t('folder-delete-confirm').replace('{name}', folder.name || ''), () => deleteFolder(folder.id), 'ch-del-popup-ok--folder-delete', savedRect); }
      }}
    ]);
    _chTooltipF2Action = function() {
      _startTooltipInlineRename(folder.name || '', function(newName) {
        folder.name = newName;
        saveSidebarOrder();
        renderSidebar();
      });
    };
  });
  header.addEventListener('mouseleave', () => { if (_chTooltip) _hideCompactTooltip(200); });

  const childrenEl = document.createElement('div');
  childrenEl.className = 'sidebar-folder-children';
  childrenEl.dataset.folderId = folder.id;

  folder.children.forEach(key => {
    const ch = channels[key];
    if (ch) childrenEl.appendChild(buildChannelItem(ch));
  });

  const dropZone = document.createElement('div');
  dropZone.className = 'sidebar-folder-drop-zone';
  dropZone.dataset.folderId = folder.id;
  childrenEl.appendChild(dropZone);

  function applyFolderOpen(animated) {
    if (folder.open) {
      childrenEl.style.maxHeight = childrenEl.scrollHeight + 'px';
    } else {
      if (animated) childrenEl.style.maxHeight = childrenEl.scrollHeight + 'px';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { childrenEl.style.maxHeight = '0'; });
      });
    }
  }
  if (folder.open) {
    // 即座に大きな値でスナップ表示（DOM挿入前でも見た目は開いた状態に）
    childrenEl.style.maxHeight = '9999px';
    requestAnimationFrame(() => {
      // DOM挿入後に正確な値へ（transition無効化でアニメなし）
      childrenEl.style.transition = 'none';
      childrenEl.style.maxHeight = childrenEl.scrollHeight + 'px';
      requestAnimationFrame(() => {
        // 以降のトグル操作でtransitionが有効になる
        childrenEl.style.transition = '';
      });
    });
  }

  header.addEventListener('click', e => {
    if (e.target.closest('button, [contenteditable]:not([contenteditable="false"])')) return;
    folder.open = !folder.open;
    saveSidebarOrder();
    wrap.classList.toggle('sidebar-folder--open', folder.open);
    applyFolderOpen(true);
  });

  wrap.appendChild(header);
  wrap.appendChild(childrenEl);
  return wrap;
}

function renderSidebar() {
  syncSidebarOrder();
  const nav = document.getElementById('sidebarNav');
  const sidebar = document.getElementById('sidebar');
  const addWrap = document.getElementById('sidebarCompactAddWrap');
  const isCompact = sidebar.classList.contains('sidebar--compact');

  // nav.innerHTML = '' の前に addWrap を退避
  if (addWrap && addWrap.parentNode === nav) {
    nav.removeChild(addWrap);
  }

  nav.innerHTML = '';

  if (isCompact && addWrap) {
    // コンパクト: navの先頭に配置（navのalign-items:centerで水平位置が揃う）
    nav.appendChild(addWrap);
  } else if (addWrap && addWrap.parentNode !== sidebar) {
    // ワイド: サイドバー直下・navの前に戻す（display:noneで非表示）
    sidebar.insertBefore(addWrap, nav);
  }

  sidebarOrder.forEach(item => {
    if (item.type === 'channel') {
      const ch = channels[item.key];
      if (ch) nav.appendChild(buildChannelItem(ch));
    } else if (item.type === 'folder') {
      nav.appendChild(buildFolderItem(item));
    }
  });
}

export function initSidebarUi() {
  // チャンネル名ツールチップ要素を一度だけ生成
  _chTooltip = document.createElement('div');
  _chTooltip.className = 'ch-tooltip';
  _chTooltipNameEl = document.createElement('div');
  _chTooltipNameEl.className = 'ch-tooltip-name';
  _chTooltipActionsEl = document.createElement('div');
  _chTooltipActionsEl.className = 'ch-tooltip-actions';
  _chTooltip.appendChild(_chTooltipNameEl);
  _chTooltip.appendChild(_chTooltipActionsEl);
  _chTooltip.addEventListener('mouseenter', function() {
    if (_chTooltipHideTimer) { clearTimeout(_chTooltipHideTimer); _chTooltipHideTimer = null; }
  });
  _chTooltip.addEventListener('mouseleave', function() { _hideCompactTooltip(150); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'F2' && _chTooltip.classList.contains('visible') && _chTooltipF2Action && !_chTooltipLocked) {
      e.preventDefault();
      e.stopPropagation();
      _chTooltipF2Action();
    }
  }, true);
  document.body.appendChild(_chTooltip);

  // フォルダ色変えポップオーバー
  _folderColorPop = document.createElement('div');
  _folderColorPop.className = 'folder-color-pop';
  _folderColorPop.hidden = true;
  document.body.appendChild(_folderColorPop);
}

export {
  buildChannelItem,
  _updateFolderPreview,
  _updateFolderPreview as updateFolderPreview,
  _startRefreshSpinner as startRefreshSpinner,
  _stopRefreshSpinner as stopRefreshSpinner,
  _showShareImportPopup as showShareImportPopup,
  randomFolderColor,
  renderSidebar,
  _hideCompactTooltip as hideChannelTooltip,
  _refreshingKeys as refreshingKeys,
};
