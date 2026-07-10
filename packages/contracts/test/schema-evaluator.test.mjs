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

test('schema evaluator recognizes exact trusted public helper imports', () => {
  const facts = evaluatePromptFrameSchemaSource(`
    import { z } from 'zod';
    import { withPromptFrameResourceSlot as withSlot } from '@promptframe/component-kit/schema';
    export const propsSchema = z.object({
      image: withSlot(z.string().describe('Image path.')).optional(),
    });
  `);

  assert.equal(facts.status, 'resolved');
  assert.equal(facts.properties.image.description, 'Image path.');
  assert.deepEqual(facts.requiredPropKeys, []);
});

test('schema evaluator reports non-static propsSchema without executing source', () => {
  const facts = evaluatePromptFrameSchemaSource(`
    import { z } from 'zod';
    export function buildSchema() { return z.object({ title: z.string() }); }
  `);

  assert.equal(facts.status, 'schema_not_static');
  assert.equal(facts.diagnostics[0]?.code, 'schema.props_schema_not_static');
});
