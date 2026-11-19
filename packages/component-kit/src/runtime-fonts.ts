/** Fixed rendering inputs shared by the local preview, Studio and workers. */
export const PROMPTFRAME_RUNTIME_FONTS = [
  {
    id: 'inter', family: 'Inter', version: '4.1', format: 'woff2',
    license: 'OFL-1.1', style: 'normal', weight: '100 900',
    sizeBytes: 352240,
    sha256: '693b77d4f32ee9b8bfc995589b5fad5e99adf2832738661f5402f9978429a8e3',
  },
  {
    id: 'notoSansSC', family: 'Noto Sans SC', version: '2.004', format: 'woff2',
    license: 'OFL-1.1', style: 'normal', weight: '100 900',
    sizeBytes: 7779480,
    sha256: 'a5822f9d6ef83d113dd94741221c16ba7a321f63033a02bd164968188995d547',
    sourceSha256: 'd68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964',
  },
  {
    id: 'notoColorEmoji', family: 'Noto Color Emoji', version: '2.057', format: 'woff2',
    license: 'OFL-1.1', style: 'normal', weight: '400',
    sizeBytes: 1996756,
    sha256: '188b2b5de8d1216e807b6222a0a467832fc790a82522600b6f10853252e7cebb',
    sourceSha256: 'b8e25ea68db82f9e4d0aee921f4420be2be39887bd5c893a2ad98710531f9d0c',
  },
] as const;

const GENERIC = /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong)$/i;

/** Keep declared families, then fixed glyph fallbacks, before host generics. */
export function promptFrameFontStack(declared = 'Inter'): string {
  const families: string[] = [];
  let start = 0;
  let quote = '';
  let depth = 0;
  for (let index = 0; index < declared.length; index += 1) {
    const char = declared[index]!;
    if (char === '\\') { index += 1; continue; }
    if (quote) { if (char === quote) quote = ''; continue; }
    if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) { families.push(declared.slice(start, index).trim()); start = index + 1; }
  }
  families.push(declared.slice(start).trim());
  const named = families.filter(family => family && !GENERIC.test(family));
  const generics = families.filter(family => GENERIC.test(family));
  const includes = (family: string) => named.some(value => value.replace(/^(['"])(.*)\1$/, '$2').toLowerCase() === family.toLowerCase());
  for (const family of ['Noto Sans SC', 'Noto Color Emoji']) if (!includes(family)) named.push(`"${family}"`);
  return [...named, ...(generics.length ? generics : ['sans-serif'])].join(', ');
}
