import { state } from './state.js';

const LS_VIEW = 'thumb-view';
const SCREENS = ['welcome', 'vote', 'list', 'ranking', 'reaction'];
export const CAT_VIEWS = ['vote', 'list', 'ranking'];

let _renderVote;
let _renderList;
let _renderRanking;
let _renderReactionsPlaylist;
let _getReactionsCurrentVideoId;
let _isHistorySuppressed;

export let currentView = 'welcome';

export function configureRouter(config) {
  _renderVote = config.renderVote;
  _renderList = config.renderList;
  _renderRanking = config.renderRanking;
  _renderReactionsPlaylist = config.renderReactionsPlaylist;
  _getReactionsCurrentVideoId = config.getReactionsCurrentVideoId;
  _isHistorySuppressed = config.isHistorySuppressed;
}

export function buildHash(channelKey, view, vid) {
  if (!channelKey || view === 'welcome') return location.pathname;
  const p = new URLSearchParams();
  p.set('ch', channelKey);
  p.set('view', view || 'list');
  if (vid) p.set('vid', vid);
  return '#' + p.toString();
}

export function parseHash() {
  const hash = location.hash.slice(1);
  if (!hash) return { channelKey: null, view: 'welcome', vid: null, cat: null };
  try {
    const p = new URLSearchParams(hash);
    return {
      channelKey: p.get('ch') || null,
      view: p.get('view') || 'list',
      vid: p.get('vid') || null,
      cat: p.get('cat') || null,
    };
  } catch {
    return { channelKey: null, view: 'welcome', vid: null, cat: null };
  }
}

export function renderCurrentView() {
  if (currentView === 'vote') _renderVote();
  else if (currentView === 'list') _renderList();
  else if (currentView === 'ranking') _renderRanking();
  else if (currentView === 'reaction') _renderReactionsPlaylist(_getReactionsCurrentVideoId());
}

export function showView(view) {
  const _viewBeforeSwitch = currentView;
  currentView = view;
  if (CAT_VIEWS.includes(view)) localStorage.setItem(LS_VIEW, view);
  SCREENS.forEach(s => {
    const el = document.getElementById(s + 'Screen');
    if (!el) return;
    if (s === view) {
      el.style.removeProperty('display');
    } else {
      el.style.display = 'none';
    }
  });
  document.querySelectorAll('.ch-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (!_isHistorySuppressed()) {
    const vid = view === 'reaction' ? _getReactionsCurrentVideoId() : null;
    const hash = buildHash(state.currentChannelKey, view, vid);
    const curSt = history.state;
    const isDuplicate = curSt &&
      curSt.channelKey === state.currentChannelKey &&
      curSt.view === view &&
      curSt.vid === (vid || null);
    if (!isDuplicate) {
      history.pushState({ channelKey: state.currentChannelKey, view, vid: vid || null }, '', hash);
    }
  }
  renderCurrentView();
}

export function buildMobileHash(channelKey, tab, vid) {
  if (!channelKey) return location.pathname;
  const p = new URLSearchParams();
  p.set('ch', channelKey);
  p.set('tab', tab || 'list');
  if (vid) p.set('vid', vid);
  return '#' + p.toString();
}

export function parseMobileHash() {
  const hash = location.hash.slice(1);
  if (!hash) return { channelKey: null, tab: null, vid: null };
  try {
    const p = new URLSearchParams(hash);
    return { channelKey: p.get('ch') || null, tab: p.get('tab') || null, vid: p.get('vid') || null };
  } catch {
    return { channelKey: null, tab: null, vid: null };
  }
}
