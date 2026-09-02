import { state } from './state.js';
import { sidebarOrder, replaceSidebarOrder, saveSidebarOrder } from './sidebar-order.js';

const channels = state.channels;

let randomFolderColor = null;
let renderSidebar = null;
let hideChannelTooltip = null;

export function configureSidebarDrag(options) {
  randomFolderColor = options.randomFolderColor;
  renderSidebar = options.renderSidebar;
  hideChannelTooltip = options.hideChannelTooltip;
}
export function initSidebarDrag() {
  const nav = document.getElementById('sidebarNav');
  const THRESHOLD = 5;
  let _pending = null;
  let _draggedEl = null;
  let _ghost = null;
  let _dragType = null;
  let _srcKey = null;
  let _srcFolderId = null;
  let _pointerOffsetY = 0;
  let _dropInfo = null;
  let _mergeTimer = null;
  let _mergeTargetKey = null;

  const _ind = document.createElement('div');
  _ind.className = 'sidebar-drag-indicator';
  _ind.style.display = 'none';
  document.body.appendChild(_ind);

  function _clearState() {
    _ind.style.display = 'none';
    nav.querySelectorAll('.sidebar-merge-hover').forEach(el => el.classList.remove('sidebar-merge-hover'));
    nav.querySelectorAll('.sidebar-folder-drop-hover').forEach(el => el.classList.remove('sidebar-folder-drop-hover'));
    nav.querySelectorAll('.merge-preview').forEach(el => el.classList.remove('merge-preview'));
    clearTimeout(_mergeTimer); _mergeTimer = null;
    _mergeTargetKey = null;
  }

  function _hitTest(mouseY) {
    // 表示中の全対象を DOM 順で収集
    const items = [];
    for (const el of nav.querySelectorAll('.sidebar-channel-item, .sidebar-folder-header')) {
      const isHeader = el.classList.contains('sidebar-folder-header');
      const fid = isHeader ? el.dataset.folderId : null;
      // 自身: 要素上にいる場合は null（インジケータなし）
      if (_dragType === 'channel' && !isHeader && el.dataset.key === _srcKey) {
        const r = el.getBoundingClientRect();
        if (mouseY >= r.top && mouseY <= r.bottom) return null;
        continue;
      }
      if (_dragType === 'folder' && fid === _srcFolderId) {
        const r = el.getBoundingClientRect();
        if (mouseY >= r.top && mouseY <= r.bottom) return null;
        continue;
      }
      // 閉じたフォルダ内はスキップ
      const pc = el.closest('.sidebar-folder-children');
      if (pc) {
        const pf = pc.closest('.sidebar-folder');
        if (pf && !pf.classList.contains('sidebar-folder--open')) continue;
        if (_dragType === 'folder' && pf && pf.dataset.folderId === _srcFolderId) continue;
      }
      items.push({ el, isHeader, fid, pc });
    }

    for (let i = 0; i < items.length; i++) {
      const { el, isHeader, fid, pc } = items[i];
      const r = el.getBoundingClientRect();
      const folderId = pc ? pc.dataset.folderId : null;
      const wrap = isHeader ? el.closest('.sidebar-folder') : null;

      // テリトリー: 常に要素の実際の底辺で計算（フォルダラッパー底辺は使わない）
      const prevBot = i > 0 ? items[i - 1].el.getBoundingClientRect().bottom : -Infinity;
      const nextTop = i < items.length - 1 ? items[i + 1].el.getBoundingClientRect().top : Infinity;
      const topBound = (prevBot + r.top) / 2;
      const botBound = (r.bottom + nextTop) / 2;

      if (mouseY < topBound || mouseY > botBound) continue;

      // フォルダドラッグ中はフォルダ内チャンネルへのヒット判定を抑制（フォルダinフォルダ不可）
      // ただしフォルダラッパー下端より下はフォルダ後ろへの脱出ゾーンとして folder-after を返す
      if (_dragType === 'folder' && !isHeader && pc) {
        const folderWrap = el.closest('.sidebar-folder');
        const naturalBot = folderWrap ? folderWrap.getBoundingClientRect().bottom : r.bottom;
        if (mouseY <= naturalBot) return null;
        return { action: 'folder-after', folderId: pc.dataset.folderId, el: folderWrap || el };
      }

      // ── テリトリー上端の隙間: このアイテムの before ──
      if (mouseY < r.top) {
        // ソース要素がこのギャップに DOM 上存在する → 挿入しても移動なし → null
        if (_draggedEl) {
          const prev = items[i - 1];
          const afterPrev = !prev || !!(prev.el.compareDocumentPosition(_draggedEl) & Node.DOCUMENT_POSITION_FOLLOWING);
          const beforeEl = !!(_draggedEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (afterPrev && beforeEl) return null;
        }
        if (isHeader) return _dragType === 'folder'
          ? { action: 'folder-before', folderId: fid, el }
          : { action: 'channel-before-folder', folderId: fid, el };
        return { action: 'before', targetKey: el.dataset.key, folderId, el };
      }

      // ── テリトリー下端の隙間（r.bottom 〜 botBound）──
      if (mouseY > r.bottom) {
        if (isHeader) {
          // フォルダヘッダー底辺〜フォルダラッパー底辺: フォルダ内部
          const wrapBot = wrap ? wrap.getBoundingClientRect().bottom : r.bottom;
          if (mouseY <= wrapBot) {
            if (_dragType === 'channel') {
              if (_srcFolderId === fid) return null; // 自分のフォルダ内部 → null
              return { action: 'add-to-folder', folderId: fid, el };
            }
            continue;
          }
          // フォルダラッパー底辺より下: 次アイテムの before に統一
          const next = items[i + 1];
          if (next) {
            const nFolderId = next.pc ? next.pc.dataset.folderId : null;
            if (next.isHeader) return _dragType === 'folder'
              ? { action: 'folder-before', folderId: next.fid, el: next.el }
              : { action: 'channel-before-folder', folderId: next.fid, el: next.el };
            return { action: 'before', targetKey: next.el.dataset.key, folderId: nFolderId, el: next.el };
          }
          return { action: _dragType === 'folder' ? 'folder-after' : 'channel-after-folder', folderId: fid, el: wrap || el };
        }
        // チャンネルアイテムの下ギャップ
        if (folderId) {
          const folderWrap = el.closest('.sidebar-folder');
          // drop-bottom 付与中は maxHeight がスナップ済みのため rawBot がそのまま正しい境界
          const rawBot = folderWrap ? folderWrap.getBoundingClientRect().bottom : r.bottom;
          if (mouseY > rawBot) {
            return { action: 'channel-after-folder', folderId, el: folderWrap || el };
          }
          // 同フォルダ内に次のアイテムがあれば before に統一（フォルダ末尾ではない）
          const next = items[i + 1];
          if (next && next.pc && next.pc.dataset.folderId === folderId) {
            // ソースが el と next の間に DOM 上存在する → 挿入しても移動なし → null
            if (_srcFolderId === folderId && _draggedEl) {
              const afterEl   = !!(el.compareDocumentPosition(_draggedEl) & Node.DOCUMENT_POSITION_FOLLOWING);
              const beforeNext = !!(_draggedEl.compareDocumentPosition(next.el) & Node.DOCUMENT_POSITION_FOLLOWING);
              if (afterEl && beforeNext) return null;
            }
            return { action: 'before', targetKey: next.el.dataset.key, folderId, el: next.el };
          }
          // フォルダ内最後の可視アイテムのギャップ
          // next がない = ソースがこのアイテムの直後 → ドロップしても移動なし → null
          if (_srcFolderId === folderId) return null;
          return { action: 'after', targetKey: el.dataset.key, folderId, el };
        }
        // トップレベルチャンネル: 次アイテムの before に統一
        const next = items[i + 1];
        if (next) {
          // ソースが el と next の間に DOM 上存在する → 挿入しても移動なし → null
          if (_draggedEl) {
            const afterEl    = !!(el.compareDocumentPosition(_draggedEl) & Node.DOCUMENT_POSITION_FOLLOWING);
            const beforeNext = !!(_draggedEl.compareDocumentPosition(next.el) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (afterEl && beforeNext) return null;
          }
          const nFolderId = next.pc ? next.pc.dataset.folderId : null;
          if (next.isHeader) return _dragType === 'folder'
            ? { action: 'folder-before', folderId: next.fid, el: next.el }
            : { action: 'channel-before-folder', folderId: next.fid, el: next.el };
          return { action: 'before', targetKey: next.el.dataset.key, folderId: nFolderId, el: next.el };
        }
        return { action: 'after', targetKey: el.dataset.key, folderId, el };
      }

      // ── アイテム本体上 ──
      const relY = (mouseY - r.top) / r.height;
      if (isHeader) {
        if (_dragType === 'channel') {
          if (_srcFolderId && _srcFolderId === fid) return null;
          if (relY < 0.5) return { action: 'channel-before-folder', folderId: fid, el };
          return { action: 'add-to-folder', folderId: fid, el };
        }
        if (relY < 0.5) return { action: 'folder-before', folderId: fid, el };
        // 下半分: ギャップゾーンと統一するため次のトップレベルアイテムの before を返す
        {
          const next = items[i + 1];
          if (next && !next.pc) {
            // 次がトップレベルアイテム（フォルダ内ではない）
            if (next.isHeader) return { action: 'folder-before', folderId: next.fid, el: next.el };
            return { action: 'before', targetKey: next.el.dataset.key, folderId: null, el: next.el };
          }
          // 開いたフォルダ（次が子チャンネル）か最後のアイテム
          // フォルダドラッグ時はヘッダー下半分にインジケーターを出さない（ラッパー下端に出ると誤認されるため）
          if (_dragType === 'folder') return null;
          return { action: 'folder-after', folderId: fid, el: wrap || el };
        }
      }
      // チャンネルアイテム
      if (_dragType === 'channel') {
        const canMerge = !folderId;

        // フォルダ内の最後のアイテムかどうか
        const nextItem = items[i + 1];
        const isLastInFolder = folderId && (
          !nextItem || !nextItem.pc || nextItem.pc.dataset.folderId !== folderId
        );

        // 上端: before
        if (relY < 0.2) return { action: 'before', targetKey: el.dataset.key, folderId, el };

        // フォルダ内最後のアイテム下半分: add-to-folder ゾーン
        if (isLastInFolder && relY >= 0.5) {
          // ラッパー超えチェック（drop-bottom 付与済みなら rawBot が拡張済みの正しい境界）
          const folderWrap = el.closest('.sidebar-folder');
          const rawBot = folderWrap ? folderWrap.getBoundingClientRect().bottom : r.bottom;
          if (mouseY > rawBot) return { action: 'channel-after-folder', folderId, el: folderWrap || el };

          // no-op チェック: ソースが el の直後に DOM 上存在
          if (_draggedEl && nextItem) {
            const afterEl    = !!(el.compareDocumentPosition(_draggedEl) & Node.DOCUMENT_POSITION_FOLLOWING);
            const beforeNext = !!(_draggedEl.compareDocumentPosition(nextItem.el) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (afterEl && beforeNext) return null;
          }
          if (_srcFolderId === folderId && !nextItem) return null; // ソースが同フォルダの最後

          return { action: 'after', targetKey: el.dataset.key, folderId, el };
        }

        if (relY > 0.8) {
          // フォルダ内最終チャンネルでラッパー超え → 脱出
          if (folderId) {
            const folderWrap = el.closest('.sidebar-folder');
            const rawBot = folderWrap ? folderWrap.getBoundingClientRect().bottom : r.bottom;
            if (mouseY > rawBot) return { action: 'channel-after-folder', folderId, el: folderWrap || el };
          }
          if (nextItem) {
            if (_draggedEl) {
              const afterEl    = !!(el.compareDocumentPosition(_draggedEl) & Node.DOCUMENT_POSITION_FOLLOWING);
              const beforeNext = !!(_draggedEl.compareDocumentPosition(nextItem.el) & Node.DOCUMENT_POSITION_FOLLOWING);
              if (afterEl && beforeNext) return null;
            }
            const nFolderId = nextItem.pc ? nextItem.pc.dataset.folderId : null;
            if (nextItem.isHeader) return { action: 'channel-before-folder', folderId: nextItem.fid, el: nextItem.el };
            return { action: 'before', targetKey: nextItem.el.dataset.key, folderId: nFolderId, el: nextItem.el };
          }
          return { action: 'after', targetKey: el.dataset.key, folderId, el };
        }

        if (canMerge) return { action: 'merge', targetKey: el.dataset.key, folderId, el };
        return { action: 'before', targetKey: el.dataset.key, folderId, el };
      }
      // フォルダドラッグ on チャンネルアイテム
      if (relY < 0.5) return { action: 'before', targetKey: el.dataset.key, folderId, el };
      // 下半分: 次アイテムの before に統一（ギャップゾーンと同じ位置）
      {
        const next = items[i + 1];
        if (next) {
          const nFolderId = next.pc ? next.pc.dataset.folderId : null;
          if (next.isHeader) return { action: 'folder-before', folderId: next.fid, el: next.el };
          return { action: 'before', targetKey: next.el.dataset.key, folderId: nFolderId, el: next.el };
        }
        return { action: 'after', targetKey: el.dataset.key, folderId, el };
      }
    }

    // フォルダ内ドロップゾーン（フォルダ末尾への追加 or 脱出）
    for (const el of nav.querySelectorAll('.sidebar-folder-drop-zone')) {
      const pc = el.closest('.sidebar-folder-children');
      if (pc) {
        const pf = pc.closest('.sidebar-folder');
        if (pf && !pf.classList.contains('sidebar-folder--open')) continue;
      }
      const r = el.getBoundingClientRect();
      if (mouseY >= r.top - 12 && mouseY <= r.bottom + 12 && _dragType === 'channel') {
        const zFolderId = el.dataset.folderId;
        // 自分が所属するフォルダのドロップゾーン → フォルダの後ろに脱出
        if (_srcFolderId && _srcFolderId === zFolderId) {
          const hdr = nav.querySelector(`.sidebar-folder-header[data-folder-id="${zFolderId}"]`);
          const wrap = hdr ? hdr.closest('.sidebar-folder') : el;
          return { action: 'channel-after-folder', folderId: zFolderId, el: wrap || el };
        }
        return { action: 'add-to-folder', folderId: zFolderId, el };
      }
    }

    return { action: 'end' };
  }

  function _showDrop(mouseY) {
    const prev = _dropInfo;
    const newInfo = _hitTest(mouseY);

    // _hitTest の結果に基づいて drop-bottom を付与（ポスト判定）
    // 同フォルダなら毎フレームの除去・再付与をしない（rawBot 変動によるちらつき防止）
    if (_dragType === 'channel') {
      const targetFolderId = (newInfo && newInfo.action === 'after' && newInfo.folderId) ? newInfo.folderId : null;
      nav.querySelectorAll('.sidebar-folder--drop-bottom').forEach(el => {
        if (el.dataset.folderId === targetFolderId) return; // 現在のターゲットは維持
        el.classList.remove('sidebar-folder--drop-bottom');
        const ch = el.querySelector('.sidebar-folder-children');
        if (ch) {
          ch.style.transition = 'none';
          ch.style.maxHeight = ch.scrollHeight + 'px';
          requestAnimationFrame(() => { ch.style.transition = ''; });
        }
      });
      if (targetFolderId) {
        const folder = nav.querySelector(`.sidebar-folder[data-folder-id="${targetFolderId}"]`);
        if (folder && !folder.classList.contains('sidebar-folder--drop-bottom')) {
          folder.classList.add('sidebar-folder--drop-bottom');
          const ch = folder.querySelector('.sidebar-folder-children');
          if (ch) {
            ch.style.transition = 'none';
            ch.style.maxHeight = ch.scrollHeight + 'px';
            requestAnimationFrame(() => { ch.style.transition = ''; });
          }
        }
      }
    }
    // ドラッグ元フォルダ上ではインジケータなし
    if (newInfo === null) {
      _clearState();
      _dropInfo = null;
      return;
    }
    // 同じmergeターゲットなら状態を維持
    if (prev && prev.action === 'merge' && newInfo && newInfo.action === 'merge' && newInfo.targetKey === prev.targetKey) {
      _dropInfo = newInfo;
      _ind.style.display = 'none';
      return;
    }
    _clearState();
    _dropInfo = newInfo;
    if (!_dropInfo) return;
    const { action, el } = _dropInfo;
    const indStyle = (r, atTop) =>
      `display:block;position:fixed;left:${r.left}px;top:${atTop ? r.top - 2 : r.bottom - 1}px;width:${r.width}px;height:3px;background:var(--accent,#4f9cf9);border-radius:2px;pointer-events:none;z-index:9998;`;
    if (action === 'before') _ind.style.cssText = indStyle(el.getBoundingClientRect(), true);
    else if (action === 'after') _ind.style.cssText = indStyle(el.getBoundingClientRect(), false);
    else if (action === 'merge') {
      el.classList.add('sidebar-merge-hover');
      _mergeTargetKey = _dropInfo.targetKey;
      _mergeTimer = setTimeout(() => { el.classList.add('merge-preview'); }, 100);
    }
    else if (action === 'add-to-folder') {
      const h = nav.querySelector(`.sidebar-folder-header[data-folder-id="${_dropInfo.folderId}"]`);
      if (h) h.classList.add('sidebar-folder-drop-hover');
    }
    else if (action === 'folder-before') _ind.style.cssText = indStyle(el.getBoundingClientRect(), true);
    else if (action === 'folder-after') _ind.style.cssText = indStyle(el.getBoundingClientRect(), false);
    else if (action === 'channel-before-folder') _ind.style.cssText = indStyle(el.getBoundingClientRect(), true);
    else if (action === 'channel-after-folder') {
      const wrap = el.closest('.sidebar-folder');
      _ind.style.cssText = indStyle((wrap || el).getBoundingClientRect(), false);
    }
    else if (action === 'end') {
      const navR = nav.getBoundingClientRect();
      let bottom = navR.top;
      // トップレベルのチャンネルアイテム（フォルダ外）
      nav.querySelectorAll('.sidebar-channel-item').forEach(el => {
        if (!el.closest('.sidebar-folder-children')) {
          const b = el.getBoundingClientRect().bottom;
          if (b > bottom) bottom = b;
        }
      });
      // 各フォルダの視覚的な末尾（開いている場合はフォルダ全体、閉じている場合はヘッダー）
      nav.querySelectorAll('.sidebar-folder-header').forEach(el => {
        const folder = el.closest('.sidebar-folder');
        const isOpen = folder && folder.classList.contains('sidebar-folder--open');
        const ref = isOpen ? folder : el;
        const b = ref.getBoundingClientRect().bottom;
        if (b > bottom) bottom = b;
      });
      _ind.style.cssText = `display:block;position:fixed;left:${navR.left}px;top:${bottom}px;width:${navR.width}px;height:3px;background:var(--accent,#4f9cf9);border-radius:2px;pointer-events:none;z-index:9998;`;
    }
  }

  function _removeFromOrder(key) {
    for (let i = sidebarOrder.length - 1; i >= 0; i--) {
      const item = sidebarOrder[i];
      if (item.type === 'channel' && item.key === key) { sidebarOrder.splice(i, 1); return; }
      if (item.type === 'folder') {
        const ci = item.children.indexOf(key);
        if (ci !== -1) { item.children.splice(ci, 1); return; }
      }
    }
  }

  function _applyDrop() {
    if (!_dropInfo) return;
    const { action, targetKey, folderId } = _dropInfo;
    if (_dragType === 'channel') {
      const srcKey = _srcKey;
      _removeFromOrder(srcKey);
      if (action === 'before') {
        if (folderId) {
          const f = sidebarOrder.find(i => i.type === 'folder' && i.id === folderId);
          if (f) { const idx = f.children.indexOf(targetKey); f.children.splice(Math.max(0, idx), 0, srcKey); }
        } else {
          const idx = sidebarOrder.findIndex(i => i.type === 'channel' && i.key === targetKey);
          sidebarOrder.splice(idx < 0 ? 0 : idx, 0, { type: 'channel', key: srcKey });
        }
      } else if (action === 'after') {
        if (folderId) {
          const f = sidebarOrder.find(i => i.type === 'folder' && i.id === folderId);
          if (f) { const idx = f.children.indexOf(targetKey); f.children.splice(idx + 1, 0, srcKey); }
        } else {
          const idx = sidebarOrder.findIndex(i => i.type === 'channel' && i.key === targetKey);
          sidebarOrder.splice(idx < 0 ? sidebarOrder.length : idx + 1, 0, { type: 'channel', key: srcKey });
        }
      } else if (action === 'merge') {
        if (folderId) {
          const f = sidebarOrder.find(i => i.type === 'folder' && i.id === folderId);
          if (f && !f.children.includes(srcKey)) f.children.push(srcKey);
          else if (!f) sidebarOrder.push({ type: 'channel', key: srcKey });
        } else {
          const tgtIdx = sidebarOrder.findIndex(i => i.type === 'channel' && i.key === targetKey);
          if (tgtIdx >= 0) {
            const tgtCh = channels[targetKey];
            const defaultName = tgtCh ? (tgtCh.displayName || tgtCh.handle || targetKey) : '';
            sidebarOrder.splice(tgtIdx, 1, { type: 'folder', id: 'f_' + Date.now(), open: false, name: defaultName, color: randomFolderColor(), children: [targetKey, srcKey] });
          } else { sidebarOrder.push({ type: 'channel', key: srcKey }); }
        }
      } else if (action === 'add-to-folder') {
        const f = sidebarOrder.find(i => i.type === 'folder' && i.id === folderId);
        if (f && !f.children.includes(srcKey)) f.children.push(srcKey);
        else if (!f) sidebarOrder.push({ type: 'channel', key: srcKey });
      } else if (action === 'channel-before-folder') {
        const ti = sidebarOrder.findIndex(i => i.type === 'folder' && i.id === folderId);
        sidebarOrder.splice(ti < 0 ? 0 : ti, 0, { type: 'channel', key: srcKey });
      } else if (action === 'channel-after-folder') {
        const ti = sidebarOrder.findIndex(i => i.type === 'folder' && i.id === folderId);
        sidebarOrder.splice(ti < 0 ? sidebarOrder.length : ti + 1, 0, { type: 'channel', key: srcKey });
      } else {
        sidebarOrder.push({ type: 'channel', key: srcKey });
      }
      replaceSidebarOrder(sidebarOrder.map(item =>
        (item.type === 'folder' && item.children.length === 1)
          ? { type: 'channel', key: item.children[0] } : item
      ));
      replaceSidebarOrder(sidebarOrder.filter(item => item.type !== 'folder' || item.children.length > 0));
    } else if (_dragType === 'folder') {
      const fi = sidebarOrder.findIndex(i => i.type === 'folder' && i.id === _srcFolderId);
      if (fi < 0) return;
      const [folder] = sidebarOrder.splice(fi, 1);
      if (action === 'folder-before') {
        const ti = sidebarOrder.findIndex(i => i.type === 'folder' && i.id === folderId);
        sidebarOrder.splice(ti < 0 ? 0 : ti, 0, folder);
      } else if (action === 'folder-after') {
        const ti = sidebarOrder.findIndex(i => i.type === 'folder' && i.id === folderId);
        sidebarOrder.splice(ti < 0 ? sidebarOrder.length : ti + 1, 0, folder);
      } else if (action === 'before') {
        const ti = sidebarOrder.findIndex(i => i.type === 'channel' && i.key === targetKey);
        sidebarOrder.splice(ti < 0 ? 0 : ti, 0, folder);
      } else if (action === 'after') {
        const ti = sidebarOrder.findIndex(i => i.type === 'channel' && i.key === targetKey);
        sidebarOrder.splice(ti < 0 ? sidebarOrder.length : ti + 1, 0, folder);
      } else {
        sidebarOrder.push(folder);
      }
    }
    saveSidebarOrder();
  }

  function _cleanup() {
    document.removeEventListener('mousemove', _onMove);
    document.removeEventListener('mouseup', _onUp);
    document.removeEventListener('touchmove', _onTouchMove);
    document.removeEventListener('touchend', _onUp);
    if (_ghost) { _ghost.remove(); _ghost = null; }
    if (_draggedEl) { _draggedEl.style.opacity = ''; _draggedEl.classList.remove('sidebar--drag-source'); _draggedEl = null; }
    _clearState();
    nav.querySelectorAll('.sidebar-folder--drop-bottom').forEach(el => el.classList.remove('sidebar-folder--drop-bottom'));
    nav.classList.remove('sidebar--dragging');
    nav.classList.remove('sidebar--folder-dragging');
    document.body.style.cursor = '';
    _dragType = _srcKey = _srcFolderId = _dropInfo = _pending = null;
  }

  function _startDrag(p) {
    const { unit, rect, downY, type, srcKey, srcFolderId } = p;
    _draggedEl = unit;
    _dragType = type;
    _srcKey = srcKey;
    _srcFolderId = srcFolderId;
    _pointerOffsetY = downY - rect.top;
    // 開いているフォルダをドラッグする場合は先に視覚的に閉じる（データは変更しない→ドロップ後に元の状態に戻る）
    if (type === 'folder' && unit.classList.contains('sidebar-folder--open')) {
      unit.classList.remove('sidebar-folder--open');
      const chevron = unit.querySelector('.sidebar-folder-chevron');
      if (chevron) chevron.textContent = '\u25be';
      // 子要素を即座に閉じる（transition無効化）
      const childrenEl = unit.querySelector('.sidebar-folder-children');
      if (childrenEl) {
        childrenEl.style.transition = 'none';
        childrenEl.style.maxHeight = '0';
        void childrenEl.offsetHeight;
        setTimeout(() => { childrenEl.style.transition = ''; }, 0);
      }
    }
    // ゴースト生成（コンパクト時はヘッダのみ）
    let ghostSrc = unit;
    if (type === 'folder' && document.getElementById('sidebar').classList.contains('sidebar--compact')) {
      ghostSrc = unit.querySelector('.sidebar-folder-header') || unit;
    }
    _ghost = ghostSrc.cloneNode(true);
    const ghostRect = ghostSrc.getBoundingClientRect();
    _ghost.style.cssText = `position:fixed;top:${ghostRect.top}px;left:${ghostRect.left}px;width:${ghostRect.width}px;pointer-events:none;z-index:9999;opacity:0.85;box-shadow:0 6px 24px rgba(0,0,0,0.55);border-radius:8px;transition:none;`;
    _pointerOffsetY = downY - ghostRect.top;
    document.body.appendChild(_ghost);
    unit.style.opacity = '0.2';
    unit.classList.add('sidebar--drag-source');
    hideChannelTooltip();
    nav.classList.add('sidebar--dragging');
    if (type === 'folder') nav.classList.add('sidebar--folder-dragging');
    document.body.style.cursor = 'grabbing';
    document.addEventListener('mousemove', _onMove);
    document.addEventListener('mouseup', _onUp);
    document.addEventListener('touchmove', _onTouchMove, { passive: false });
    document.addEventListener('touchend', _onUp);
  }

  function _onMove(e) {
    if (!_draggedEl) return;
    e.preventDefault();
    const src = e.touches ? e.touches[0] : e;
    _ghost.style.top = (src.clientY - _pointerOffsetY) + 'px';
    _showDrop(src.clientY);
  }
  const _onTouchMove = e => { if (_draggedEl) { e.preventDefault(); _onMove(e); } };
  function _onUp() {
    if (!_draggedEl) return;
    _applyDrop();
    _cleanup();
    renderSidebar();
  }
  function _cancelPending() {
    document.removeEventListener('mousemove', _onPendingMove);
    document.removeEventListener('mouseup', _onPendingUp);
    document.removeEventListener('touchmove', _onPendingMove);
    document.removeEventListener('touchend', _onPendingUp);
    _pending = null;
  }
  function _onPendingMove(e) {
    if (!_pending) return;
    const src = e.touches ? e.touches[0] : e;
    if (Math.abs(src.clientY - _pending.downY) < THRESHOLD && Math.abs(src.clientX - _pending.downX) < THRESHOLD) return;
    const p = _pending;
    _cancelPending();
    _startDrag(p);
    e.preventDefault();
    _onMove(e);
  }
  function _onPendingUp() { _cancelPending(); }

  nav.addEventListener('mousedown', e => {
    if (e.target.closest('button, input, select, textarea')) return;
    const chItem = e.target.closest('.sidebar-channel-item');
    const fldHdr = !chItem && e.target.closest('.sidebar-folder-header');
    if (!chItem && !fldHdr) return;
    const type = chItem ? 'channel' : 'folder';
    const unit = chItem || fldHdr.closest('.sidebar-folder');
    _pending = { downY: e.clientY, downX: e.clientX, unit, rect: unit.getBoundingClientRect(), type,
      srcKey: chItem ? chItem.dataset.key : null,
      srcFolderId: fldHdr ? fldHdr.dataset.folderId
        : (chItem ? (chItem.closest('.sidebar-folder-children') || {}).dataset?.folderId || null : null) };
    document.addEventListener('mousemove', _onPendingMove);
    document.addEventListener('mouseup', _onPendingUp);
  });
  nav.addEventListener('touchstart', e => {
    if (e.target.closest('button, input, select, textarea')) return;
    const chItem = e.target.closest('.sidebar-channel-item');
    const fldHdr = !chItem && e.target.closest('.sidebar-folder-header');
    if (!chItem && !fldHdr) return;
    const type = chItem ? 'channel' : 'folder';
    const unit = chItem || fldHdr.closest('.sidebar-folder');
    const touch = e.touches[0];
    _pending = { downY: touch.clientY, downX: touch.clientX, unit, rect: unit.getBoundingClientRect(), type,
      srcKey: chItem ? chItem.dataset.key : null,
      srcFolderId: fldHdr ? fldHdr.dataset.folderId
        : (chItem ? (chItem.closest('.sidebar-folder-children') || {}).dataset?.folderId || null : null) };
    document.addEventListener('touchmove', _onPendingMove, { passive: false });
    document.addEventListener('touchend', _onPendingUp);
  }, { passive: false });
}
