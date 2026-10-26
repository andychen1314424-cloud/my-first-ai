import { useCallback, useEffect, useSyncExternalStore } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'zx-theme';
const CHANGED = 'zx-theme-changed';

const subscribe = (notify: () => void) => {
  window.addEventListener('storage', notify);
  window.addEventListener(CHANGED, notify);
  return () => { window.removeEventListener('storage', notify); window.removeEventListener(CHANGED, notify); };
};
const read = (): ThemePref => {
  try { const value = localStorage.getItem(KEY); return value === 'light' || value === 'dark' ? value : 'system'; }
  catch { return 'system'; }
};

const resolve = (p: ThemePref) =>
  p === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : p;

export function useTheme() {
  const pref = useSyncExternalStore<ThemePref>(subscribe, read, () => 'system');

  useEffect(() => {
    const apply = () => document.documentElement.setAttribute('data-theme', resolve(pref));
    apply();
    if (pref !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    localStorage.setItem(KEY, p);
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return { pref, setPref, resolved: resolve(pref) };
}
