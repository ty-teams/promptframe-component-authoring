import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { loadPromptFrameRuntimeFonts, PROMPTFRAME_RUNTIME_FONTS, promptFrameFontStack, promptFrameRuntimeFontSupport } from '../src/fonts.js';

test('fixed font bytes match the manifest and preserve Inter 4.1', async () => {
  const modules = await Promise.all([
    import('../src/fonts/inter.generated.js'),
    import('../src/fonts/notoSansSC.generated.js'),
    import('../src/fonts/notoColorEmoji.generated.js'),
  ]);
  for (const [index, module] of modules.entries()) {
    const bytes = Buffer.from(module.FONT_DATA_URL.split(',')[1]!, 'base64');
    assert.equal(bytes.subarray(0, 4).toString(), 'wOF2');
    assert.equal(bytes.length, PROMPTFRAME_RUNTIME_FONTS[index]!.sizeBytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), PROMPTFRAME_RUNTIME_FONTS[index]!.sha256);
  }
});

test('all document consumers share pending decode and install the complete set once', async () => {
  let release!: () => void;
  let started!: () => void;
  const decoding = new Promise<void>(resolve => { release = resolve; });
  const made = new Promise<void>(resolve => { started = resolve; });
  const families: string[] = [];
  const installed: unknown[] = [];
  class Face {
    constructor(family: string, source: string) {
      families.push(family);
      assert.ok(source.startsWith('url("data:font/woff2;base64,'));
      if (families.length === 3) started();
    }
    async load() { await decoding; return this; }
  }
  const fonts = {add(face: unknown) { installed.push(face); }} as FontFaceSet;
  const first = loadPromptFrameRuntimeFonts(fonts, Face as unknown as typeof FontFace);
  assert.equal(loadPromptFrameRuntimeFonts(fonts, Face as unknown as typeof FontFace), first);
  await made;
  assert.deepEqual(families, ['Inter', 'Noto Sans SC', 'Noto Color Emoji']);
  assert.equal(installed.length, 0);
  release();
  await first;
  assert.equal(installed.length, 3);
  assert.equal(loadPromptFrameRuntimeFonts(fonts, Face as unknown as typeof FontFace), first);
});

test('one failed face rejects the whole document without fallback adoption or hidden retry', async () => {
  const original = new Error('invalid CJK decode');
  let count = 0;
  class Face {
    constructor(private family: string) { count += 1; }
    async load() { if (this.family === 'Noto Sans SC') throw original; return this; }
  }
  const fonts = {add() { assert.fail('no partial set'); }} as unknown as FontFaceSet;
  const first = loadPromptFrameRuntimeFonts(fonts, Face as unknown as typeof FontFace);
  await assert.rejects(first, error => error === original);
  assert.equal(loadPromptFrameRuntimeFonts(fonts, Face as unknown as typeof FontFace), first);
  assert.equal(count, 3);
});

test('decode timeout remains failed when the original decoder finishes late', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let finish!: () => void;
  let started!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const made = new Promise<void>(resolve => { started = resolve; });
  let count = 0;
  class Face {
    constructor() { if (++count === 3) started(); }
    async load() { await gate; return this; }
  }
  const fonts = {add() { assert.fail('late decode cannot adopt after timeout'); }} as unknown as FontFaceSet;
  const pending = loadPromptFrameRuntimeFonts(fonts, Face as unknown as typeof FontFace);
  const rejected = assert.rejects(pending, /font.runtime_load_timed_out/);
  await made;
  t.mock.timers.tick(30_000);
  await rejected;
  finish();
  await Promise.resolve();
  assert.equal(loadPromptFrameRuntimeFonts(fonts, Face as unknown as typeof FontFace), pending);
});

test('fixed fallbacks precede host generics and keep custom names, variables and quoted commas', () => {
  assert.equal(promptFrameFontStack('Inter, system-ui, sans-serif'), 'Inter, "Noto Sans SC", "Noto Color Emoji", system-ui, sans-serif');
  assert.equal(promptFrameFontStack('"Custom, Display", var(--heading, "Other"), serif'), '"Custom, Display", var(--heading, "Other"), "Noto Sans SC", "Noto Color Emoji", serif');
  assert.equal(promptFrameFontStack('"Noto Sans SC", "Noto Color Emoji", sans-serif'), '"Noto Sans SC", "Noto Color Emoji", sans-serif');
  assert.equal(promptFrameFontStack('monospace'), '"Noto Sans SC", "Noto Color Emoji", monospace');
});

test('a browser that explicitly lacks COLRv1 keeps fixed CJK without installing an empty emoji face', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
  Object.defineProperty(globalThis, 'CSS', {configurable: true, value: {supports: () => false}});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'CSS', previous);
    else Reflect.deleteProperty(globalThis, 'CSS');
  });
  const families: string[] = [];
  const installed: string[] = [];
  class Face {
    constructor(readonly family: string) { families.push(family); }
    async load() { return this; }
  }
  await loadPromptFrameRuntimeFonts({add(face: Face) { installed.push(face.family); }} as unknown as FontFaceSet,
    Face as unknown as typeof FontFace);
  assert.deepEqual(promptFrameRuntimeFontSupport(), {colorEmoji: 'unsupported', reasonCode: 'font.color_emoji_format_unsupported'});
  assert.deepEqual(families, ['Inter', 'Noto Sans SC']);
  assert.deepEqual(installed, families);
});

test('unknown format support still decodes every fixed font and preserves a real emoji failure', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
  Object.defineProperty(globalThis, 'CSS', {configurable: true, value: {supports: () => { throw new Error('query unavailable'); }}});
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'CSS', previous);
    else Reflect.deleteProperty(globalThis, 'CSS');
  });
  assert.deepEqual(promptFrameRuntimeFontSupport(), {colorEmoji: 'unknown'});
  const families: string[] = [];
  class Face {
    constructor(readonly family: string) { families.push(family); }
    async load() { if (this.family === 'Noto Color Emoji') throw new Error('real emoji failure'); return this; }
  }
  await assert.rejects(loadPromptFrameRuntimeFonts({add() { assert.fail('no partial set'); }} as unknown as FontFaceSet,
    Face as unknown as typeof FontFace), /real emoji failure/);
  assert.deepEqual(families, ['Inter', 'Noto Sans SC', 'Noto Color Emoji']);
});
