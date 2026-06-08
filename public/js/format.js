// format.js — 表示用フォーマットユーティリティ
// t() は i18n.js が window グローバルとして登録する（ES module からも参照可）

/** 再生数を短縮表記する（例: 1,234,567 → "123万回視聴"） */
export function formatViews(n) {
  if (!n) return '';
  if (n >= 100000000) {
    const oku = Math.floor(n / 100000000);
    if (oku >= 10) return t('fmt-views-100m', { n: oku });
    return t('fmt-views-100m', { n: (Math.floor(n / 10000000) / 10).toString().replace(/\.0$/, '') });
  }
  if (n >= 10000) {
    const man = Math.floor(n / 10000);
    if (man >= 10) return t('fmt-views-10k', { n: man });
    return t('fmt-views-10k', { n: (Math.floor(n / 1000) / 10).toString().replace(/\.0$/, '') });
  }
  if (n >= 1000)  return t('fmt-views-1k',  { n: (Math.floor(n / 100) / 10).toString().replace(/\.0$/, '') });
  return t('fmt-views-raw', { n: n.toLocaleString() });
}

/** 再生数の単位なし短縮表記（ギャラリーオーバーレイ用） */
export function formatViewsShort(n) {
  if (!n) return '';
  if (n >= 100000000) {
    const oku = Math.floor(n / 100000000);
    if (oku >= 10) return t('fmt-views-short-100m', { n: oku });
    return t('fmt-views-short-100m', { n: (Math.floor(n / 10000000) / 10).toString().replace(/\.0$/, '') });
  }
  if (n >= 10000) {
    const man = Math.floor(n / 10000);
    if (man >= 10) return t('fmt-views-short-10k', { n: man });
    return t('fmt-views-short-10k', { n: (Math.floor(n / 1000) / 10).toString().replace(/\.0$/, '') });
  }
  return t('fmt-views-short-raw', { n: n.toLocaleString() });
}

/** ISO 日時を相対時刻文字列に変換する（例: "3日前"） */
export function formatRelTime(isoStr) {
  if (!isoStr) return '';
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60)          return t('fmt-time-now');
  if (diff < 3600)        return t('fmt-time-min',   { n: Math.floor(diff / 60) });
  if (diff < 86400)       return t('fmt-time-hour',  { n: Math.floor(diff / 3600) });
  if (diff < 86400 * 7)   return t('fmt-time-day',   { n: Math.floor(diff / 86400) });
  if (diff < 86400 * 30)  return t('fmt-time-week',  { n: Math.floor(diff / (86400 * 7)) });
  if (diff < 86400 * 365) return t('fmt-time-month', { n: Math.floor(diff / (86400 * 30)) });
  return t('fmt-time-year', { n: Math.floor(diff / (86400 * 365)) });
}

/** 秒数を動画時間形式に変換する（例: 3661 → "1:01:01"） */
export function formatDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
