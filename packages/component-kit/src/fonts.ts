import { PROMPTFRAME_RUNTIME_FONTS, promptFrameRuntimeFontSupport } from './runtime-fonts.js';
export { PROMPTFRAME_RUNTIME_FONTS, promptFrameFontStack, promptFrameRuntimeFontSupport } from './runtime-fonts.js';

const loads = new WeakMap<FontFaceSet, Promise<void>>();

/** No URL or font input is accepted. Payload chunks contain only fixed OFL fonts. */
export function loadPromptFrameRuntimeFonts(
  fonts: FontFaceSet,
  createFace: typeof FontFace = FontFace,
): Promise<void> {
  const existing = loads.get(fonts);
  if (existing) return existing;
  const useFixedEmoji = promptFrameRuntimeFontSupport().colorEmoji !== 'unsupported';
  const decode = (async () => {
    const modules = await Promise.all([
      import('./fonts/inter.generated.js'),
      import('./fonts/notoSansSC.generated.js'),
      ...(useFixedEmoji ? [import('./fonts/notoColorEmoji.generated.js')] : []),
    ]);
    return Promise.all(PROMPTFRAME_RUNTIME_FONTS.filter(font => useFixedEmoji || font.id !== 'notoColorEmoji').map(async (font, index) => {
      const face = new createFace(font.family, `url("${modules[index]!.FONT_DATA_URL}") format("${font.format}")`, {
        style: font.style, weight: font.weight, display: 'block',
      });
      return face.load();
    }));
  })();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('font.runtime_load_timed_out')), 30_000);
  });
  const pending = Promise.race([decode, timeout]).then(loaded => {
    // A timeout or any decode failure cannot be followed by late adoption.
    for (const face of loaded) fonts.add(face);
  }).finally(() => clearTimeout(timer));
  loads.set(fonts, pending);
  return pending;
}
