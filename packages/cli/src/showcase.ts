import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ComponentShowcaseError, collectPromptFrameResourceReferences, createComponentShowcasePropsValidator,
  resolveComponentShowcaseGroups, type ComponentShowcasePreview,
} from '@promptframe/contracts';
import type { PromptFrameSchemaFacts } from '@promptframe/contracts/schema-evaluator';

/** Optional source-only declaration; local preview drafts never enter the ZIP. */
export function validateSourceShowcase(input: {
  root: string;
  preview: ComponentShowcasePreview;
  facts: PromptFrameSchemaFacts;
  fail: (message: string, code: string) => never;
}) {
  const file = join(input.root, 'src/showcase.json');
  if (!existsSync(file)) return;
  let source: unknown;
  try { source = JSON.parse(readFileSync(file, 'utf8')); }
  catch { return input.fail('src/showcase.json must contain valid JSON.', 'component.showcase.json_invalid'); }
  const schema = { type: 'object', properties: input.facts.properties, required: input.facts.requiredPropKeys, additionalProperties: false };
  try {
    const validate = createComponentShowcasePropsValidator(schema);
    return resolveComponentShowcaseGroups({ preview: input.preview, showcase: source, validateProps: (props, path) => {
      const effective = validate(props, path);
      if (collectPromptFrameResourceReferences(schema, effective).some(reference => reference.source !== 'public'))
        throw new ComponentShowcaseError('component.showcase.private_resource_reference', path);
      return effective;
    } });
  } catch (error) {
    if (error instanceof ComponentShowcaseError)
      return input.fail(`src/showcase.json ${error.path.join('.')}: ${error.code}.`, error.code);
    throw error;
  }
}
