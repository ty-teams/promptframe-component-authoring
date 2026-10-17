import { createHash } from 'node:crypto';
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import { preprocessCSS, resolveConfig } from 'vite';

/** The local Player accepts captured, module-scoped styles, with no CSS I/O. */
export async function compileDevelopmentCssModule(input: {
  path: string; text: string; sourceRevision: string;
}): Promise<{ css: string; classes: Record<string, string> }> {
  const reject = (): never => { throw new Error('development.build.unsupported_css'); };
  // Escaped identifiers/URLs, imports, composition and ambient selectors need
  // a captured dependency contract. Do not delegate their resolution to Vite.
  if (!input.path.endsWith('.module.css') || input.text.includes('\\')
    || /[#@]\s*sourceMappingURL\s*=/iu.test(input.text)) reject();
  const root = postcss.parse(input.text, { from: input.path });
  root.walkAtRules(rule => {
    if (!['media', 'supports', 'container'].includes(rule.name.toLowerCase())) reject();
  });
  root.walkRules(rule => {
    if (rule.parent?.type === 'rule') reject();
    selectorParser(selectors => {
      selectors.each(selector => {
        const first = selector.nodes.find(node => node.type !== 'comment');
        if (first?.type !== 'class') reject();
      });
      selectors.walkPseudos(pseudo => {
        if ([':global', ':local', ':root', ':host', ':host-context', '::slotted'].includes(pseudo.value.toLowerCase())) reject();
      });
      selectors.walkCombinators(combinator => {
        if (!['', '>'].includes(combinator.value.trim())) reject();
      });
    }).processSync(rule.selector);
  });
  root.walkDecls(declaration => {
    if (/^(?:composes|compose-with|behavior|-moz-binding|(?:-\w+-)?animation|(?:-\w+-)?transition)(?:-|$)/iu.test(declaration.prop)) reject();
  });
  // These functions are pure layout/color expressions. In particular url(),
  // image-set(), expression() and file/font loaders cannot acquire resources.
  const functions = new Set(['var', 'calc', 'clamp', 'min', 'max', 'rgb', 'rgba', 'hsl', 'hsla',
    'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'linear-gradient',
    'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient',
    'translate', 'translatex', 'translatey', 'translatez', 'translate3d', 'scale', 'scalex', 'scaley',
    'scalez', 'scale3d', 'rotate', 'rotatex', 'rotatey', 'rotatez', 'rotate3d', 'skew', 'skewx',
    'skewy', 'matrix', 'matrix3d', 'perspective', 'blur', 'brightness', 'contrast', 'grayscale',
    'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia', 'drop-shadow', 'repeat', 'minmax', 'fit-content',
    'selector', 'style']);
  for (const match of input.text.matchAll(/([a-z_-][\w-]*)\s*\(/giu)) {
    if (!functions.has(match[1]!.toLowerCase())) reject();
  }
  const namespace = createHash('sha256').update(input.sourceRevision).update('\0').update(input.path).digest('hex').slice(0, 20);
  const config = await resolveConfig({
    root: process.cwd(), configFile: false, envFile: false, publicDir: false, logLevel: 'silent',
    css: { postcss: { plugins: [], map: false }, modules: { generateScopedName: name => `pf_${namespace}_${name}` } },
  }, 'build');
  const result = await preprocessCSS(input.text, `/promptframe-captured/${input.path}`, config);
  if (!result.modules || result.deps?.size) reject();
  return { css: result.code, classes: result.modules! };
}
