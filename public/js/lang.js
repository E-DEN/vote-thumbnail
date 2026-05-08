// lang.js — 言語ポップオーバー・言語インポートダイアログ
// i18n.js より後、app.js より前に読み込む前提

// ── ダイアログ構築 ────────────────────────────────────────────

function rebuildLangDialog() {
  const list = document.getElementById('langOptionList');
  if (!list) return;
  list.innerHTML = '';

  let extCodes = [];
  try {
    extCodes = JSON.parse(localStorage.getItem('thumb-ext-langs') || '[]').map(function (x) { return x.code; });
  } catch (e) {}

  getRegisteredLangs().forEach(function (langItem) {
    const code  = langItem.code;
    const label = langItem.label;
    const isExt = extCodes.includes(code);

    const btn = document.createElement('button');
    btn.className = 'lang-option-item' + (code === _lang ? ' active' : '');
    btn.innerHTML =
      '<span class="lang-option-check">' + (code === _lang ? '\u2713' : '') + '</span>' +
      '<span style="flex:1">' + label + '</span>' +
      (isExt
        ? '<span class="lang-option-del" data-code="' + code + '" style="margin-left:4px;opacity:0.5;font-size:12px;padding:0 4px;line-height:1">\u2715</span>'
        : '');

    btn.addEventListener('click', function (e) {
      const delBtn = e.target.closest('.lang-option-del');
      if (delBtn) {
        e.stopPropagation();
        const delCode = delBtn.dataset.code;
        try {
          const saved = JSON.parse(localStorage.getItem('thumb-ext-langs') || '[]')
            .filter(function (x) { return x.code !== delCode; });
          localStorage.setItem('thumb-ext-langs', JSON.stringify(saved));
        } catch (err) {}
        unregisterLang(delCode);
        if (_lang === delCode) applyLang('ja');
        if (typeof renderList === 'function') {
          if (typeof _listMode !== 'undefined' && _listMode === 'grid') { renderListGrid(); } else { renderList(); }
        }
        rebuildLangDialog();
        return;
      }
      applyLang(code);
      if (typeof renderList === 'function') {
        if (typeof _listMode !== 'undefined' && _listMode === 'grid') { renderListGrid(); } else { renderList(); }
      }
      const addSec = document.getElementById('langAddSection');
      if (addSec) addSec.hidden = true;
      closePopover();
    });

    list.appendChild(btn);
  });

  // 「+ 追加」ボタン
  const addBtn = document.createElement('button');
  addBtn.id = 'langAddToggle';
  addBtn.className = 'lang-option-item lang-option-add';
  const _sec = document.getElementById('langAddSection');

  function _addLabel() { return (_sec && !_sec.hidden) ? t('lang-cancel') : t('lang-add'); }

  addBtn.innerHTML =
    '<span class="lang-option-check"></span>' +
    '<span>' + _addLabel() + '</span>';

  addBtn.addEventListener('click', function () {
    if (!_sec) return;
    const wasOpen = !_sec.hidden;
    _sec.hidden = !_sec.hidden;
    addBtn.querySelector('span:last-child').textContent = _addLabel();
    if (!_sec.hidden) {
      const textEl = document.getElementById('langImportText');
      if (textEl) textEl.value = '';
      const dropEl = document.getElementById('langImportDrop');
      if (dropEl) dropEl.classList.remove('hover');
    } else if (wasOpen) {
      closePopover();
    }
  });

  list.appendChild(addBtn);
}

// ── ポップオーバー開閉 ────────────────────────────────────────

function _syncAddToggle() {
  const toggle = document.getElementById('langAddToggle');
  if (toggle) toggle.querySelector('span:last-child').textContent = t('lang-add');
}

function resetDialog() {
  const textEl = document.getElementById('langImportText');
  if (textEl) textEl.value = '';
  const dropEl = document.getElementById('langImportDrop');
  if (dropEl) dropEl.classList.remove('hover');
  const addSec = document.getElementById('langAddSection');
  if (addSec) addSec.hidden = true;
  _syncAddToggle();
}

function openPopover() {
  const dialog = document.getElementById('langImportDialog');
  if (!dialog) return;
  rebuildLangDialog();
  dialog.hidden = false;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function closePopover() {
  const dialog = document.getElementById('langImportDialog');
  if (!dialog) return;
  dialog.hidden = true;
  resetDialog();
}

// ── 初期化（DOMContentLoaded 後に実行） ──────────────────────

(function () {
  function init() {
    rebuildLangDialog();
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const dialog   = document.getElementById('langImportDialog');
    const dropEl   = document.getElementById('langImportDrop');
    const textEl   = document.getElementById('langImportText');
    const applyBtn = document.getElementById('langImportApply');
    const trigBtn  = document.getElementById('langImportBtn');
    const dlBtn    = document.getElementById('langTemplateDownload');

    // --- トリガーボタン ---
    if (trigBtn) {
      trigBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (!dialog) return;
        if (!dialog.hidden) { closePopover(); return; }
        resetDialog();
        openPopover();
      });
    }

    // --- 外クリックで閉じる ---
    document.addEventListener('click', function (e) {
      if (!dialog || dialog.hidden) return;
      if (dialog.contains(e.target)) return;
      if (trigBtn && trigBtn.contains(e.target)) return;
      closePopover();
    });

    // --- 伝播止め ---
    if (dialog) dialog.addEventListener('click', function (e) { e.stopPropagation(); });

    // --- Escape で閉じる ---
    function onEscape(e) {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      const addSec = document.getElementById('langAddSection');
      if (addSec && !addSec.hidden) {
        addSec.hidden = true;
        _syncAddToggle();
      } else {
        closePopover();
      }
    }
    if (dialog) dialog.addEventListener('keydown', onEscape);
    if (textEl)  textEl.addEventListener('keydown', onEscape);

    // --- JSON テキスト適用 ---
    function applyJSONText(text) {
      try {
        loadLangJSON(text);
        rebuildLangDialog();
        applyLang(_lang);
        if (typeof renderList === 'function') {
          if (typeof _listMode !== 'undefined' && _listMode === 'grid') { renderListGrid(); } else { renderList(); }
        }
        closePopover();
      } catch (e) {
        alert(t('lang-import-err'));
      }
    }

    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        if (!textEl) return;
        const text = textEl.value.trim();
        if (text) applyJSONText(text);
      });
    }

    // --- テンプレートDL ---
    if (dlBtn) {
      dlBtn.addEventListener('click', function () { downloadLangTemplate(); });
    }

    // --- ドラッグ&ドロップ ---
    if (dropEl) {
      dropEl.addEventListener('dragover', function (e) {
        // 動画ファイルは無視（アプリ本体へ渡す）
        const hasVideo = Array.from(e.dataTransfer.items || []).some(function (i) {
          return i.kind === 'file' && i.type.startsWith('video/');
        });
        if (hasVideo) return;
        e.preventDefault();
        dropEl.classList.add('hover');
      });

      dropEl.addEventListener('dragleave', function () {
        dropEl.classList.remove('hover');
      });

      dropEl.addEventListener('drop', function (e) {
        const hasVideo = Array.from(e.dataTransfer.items || []).some(function (i) {
          return i.kind === 'file' && i.type.startsWith('video/');
        });
        if (hasVideo) return;
        e.preventDefault();
        dropEl.classList.remove('hover');
        const file = e.dataTransfer.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function (ev) { applyJSONText(ev.target.result); };
        reader.readAsText(file, 'utf-8');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
