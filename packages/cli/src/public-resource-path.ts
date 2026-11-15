export function normalizePublicResourcePath(relativePath: string): (
  | { ok: true; relativePath: string; publicPath: `/${string}`; sourcePath: `public/${string}` }
  | { ok: false; reason: string }
) {
  const value = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!value || value.endsWith('/')) return { ok: false, reason: 'empty resource path.' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return { ok: false, reason: 'URL-like paths are not allowed.' };
  if (value.includes('//')) return { ok: false, reason: 'double slashes are not allowed.' };
  const parts = value.split('/');
  if (parts.some((part) => part === '.' || part === '..' || part.trim() !== part || part.length === 0)) {
    return { ok: false, reason: 'dot segments and whitespace-padded path parts are not allowed.' };
  }
  if (!/^[A-Za-z0-9._~!$&'()+,;=@/-]+$/.test(value)) {
    return { ok: false, reason: 'path contains unsupported characters.' };
  }
  return {
    ok: true,
    relativePath: value,
    publicPath: `/${value}`,
    sourcePath: `public/${value}`,
  };
}
