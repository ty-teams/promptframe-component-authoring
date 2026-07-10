import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROMPTFRAME_SCHEMA_EVALUATOR_VERSION,
  evaluatePromptFrameSchemaSource,
} from '../dist/schema-evaluator.js';

test('schema evaluator resolves named schemas through a proven transparent resource wrapper', () => {
  const facts = evaluatePromptFrameSchemaSource(`
    import { z } from 'zod';

    const imageResourceSlot = {
      kinds: ['image'],
      accept: ['image/*'],
      maxFileBytes: 10 * 1024 * 1024,
    } as const;

    function withImageResourceSlot<T extends z.ZodTypeAny>(schema: T): T {
      const def = (schema as { _def?: Record<string, unknown> })._def;
      if (def) {
        def.promptFrameResource = imageResourceSlot;
      }
      return schema;
    }

    const heroImageField = withImageResourceSlot(
      z.string().describe('Hero background image path under public/.'),
    );
    const logoImageField = withImageResourceSlot(
      z.string().describe('Brand mark image path under public/.'),
    );

    export const propsSchema = z.object({
      heroImage: heroImageField.default('/aurora-hero.svg'),
      logoImage: logoImageField.default('/aurora-logo.svg'),
      title: z.string().describe('Visible title.'),
    });
  `);

  assert.equal(facts.evaluatorVersion, PROMPTFRAME_SCHEMA_EVALUATOR_VERSION);
  assert.equal(facts.status, 'resolved');
  assert.deepEqual(facts.propKeys, ['heroImage', 'logoImage', 'title']);
  assert.deepEqual(facts.requiredPropKeys, ['title']);
  assert.equal(facts.properties.heroImage.description, 'Hero background image path under public/.');
  assert.equal(facts.properties.heroImage.default, '/aurora-hero.svg');
  assert.equal(facts.properties.logoImage.description, 'Brand mark image path under public/.');
  assert.deepEqual(facts.diagnostics, []);
});

test('schema evaluator fails visibly for an unknown wrapper', () => {
  const facts = evaluatePromptFrameSchemaSource(`
    import { z } from 'zod';
    import { wrapSchema } from 'third-party';
    export const propsSchema = z.object({
      title: wrapSchema(z.string().describe('Visible title.')),
    });
  `);

  assert.equal(facts.status, 'partial');
  assert.deepEqual(facts.propKeys, ['title']);
  assert.equal(facts.properties.title.description, undefined);
  assert.equal(facts.diagnostics[0]?.code, 'schema.wrapper_unresolved');
  assert.equal(facts.diagnostics[0]?.propPath, 'title');
  assert.equal(facts.diagnostics[0]?.wrapperName, 'wrapSchema');
});

test('schema evaluator does not trust a transparent-looking wrapper name with alternate returns', () => {
  const facts = evaluatePromptFrameSchemaSource(`
    import { z } from 'zod';
    function withImageResourceSlot(schema: z.ZodTypeAny) {
      if (Math.random() > 0.5) return schema;
      return z.number();
    }
    export const propsSchema = z.object({
      image: withImageResourceSlot(z.string().describe('Image path.')),
    });
  `);

  assert.equal(facts.status, 'partial');
  assert.equal(facts.diagnostics[0]?.code, 'schema.wrapper_unresolved');
  assert.equal(facts.diagnostics[0]?.wrapperName, 'withImageResourceSlot');
});

test('schema evaluator rejects wrappers without an unconditional top-level identity return', () => {
  const facts = evaluatePromptFrameSchemaSource(`
    import { z } from 'zod';
    function withImageResourceSlot(schema: z.ZodTypeAny) {
      if (schema) return schema;
    }
    export const propsSchema = z.object({
      image: withImageResourceSlot(z.string().describe('Image path.')),
    });
  `);

  assert.equal(facts.status, 'partial');
  assert.equal(facts.diagnostics[0]?.code, 'schema.wrapper_unresolved');
  assert.equal(facts.diagnostics[0]?.wrapperName, 'withImageResourceSlot');
});

test('schema evaluator rejects destructive and update side effects in wrappers', () => {
  for (const sideEffect of [
    'delete schema._def;',
    'schema._def.promptFrameResource++;',
    'schema._def.promptFrameResource += imageResourceSlot;',
  ]) {
    const facts = evaluatePromptFrameSchemaSource(`
      import { z } from 'zod';
      const imageResourceSlot = { kinds: ['image'] };
      function withImageResourceSlot(schema: z.ZodTypeAny) {
        ${sideEffect}
        return schema;
      }
      export const propsSchema = z.object({
        image: withImageResourceSlot(z.string().describe('Image path.')),
      });
    `);

    assert.equal(facts.status, 'partial', sideEffect);
    assert.equal(facts.diagnostics[0]?.code, 'schema.wrapper_unresolved', sideEffect);
  }
});

test('schema evaluator does not trust a helper import until that exact public export exists', () => {
  const facts = evaluatePromptFrameSchemaSource(`
    import { z } from 'zod';
    import { withPromptFrameResourceSlot as withSlot } from '@promptframe/component-kit/schema';
    export const propsSchema = z.object({
      image: withSlot(z.string().describe('Image path.')).optional(),
    });
  `);

  assert.equal(facts.status, 'partial');
  assert.equal(facts.diagnostics[0]?.code, 'schema.wrapper_unresolved');
  assert.equal(facts.diagnostics[0]?.wrapperName, 'withSlot');
});

test('schema evaluator reports non-static propsSchema without executing source', () => {
  const facts = evaluatePromptFrameSchemaSource(`
    import { z } from 'zod';
    export function buildSchema() { return z.object({ title: z.string() }); }
  `);

  assert.equal(facts.status, 'schema_not_static');
  assert.equal(facts.diagnostics[0]?.code, 'schema.props_schema_not_static');
});
