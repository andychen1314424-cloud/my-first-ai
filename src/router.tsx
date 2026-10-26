import { useSyncExternalStore, type AnchorHTMLAttributes } from 'react';

// 极简 hash 路由：不依赖额外库，也不需要服务端做路径回退（与现有 Node 静态服务兼容）。
const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const read = () => window.location.hash.replace(/^#/, '') || '/';

export const usePath = () => useSyncExternalStore(subscribe, read, () => '/');
export const navigate = (to: string) => {
  window.location.hash = to;
};
export const isActive = (path: string, to: string) =>
  to === '/' ? path === '/' : path === to || path.startsWith(to + '/');

export function Link({ to, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a href={`#${to}`} {...rest} />;
}
