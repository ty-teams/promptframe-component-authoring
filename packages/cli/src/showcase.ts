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
  schemaPath?:string;
  fail: (message: string, code: string) => never;
}) {
  const file = join(input.root, 'src/showcase.json');
  return validateShowcasePreview({ ...input, declaration: existsSync(file) ? readFileSync(file, 'utf8') : undefined });
}

export function validateShowcasePreview(input: {
  declaration?: string;
  preview: ComponentShowcasePreview;
  facts: PromptFrameSchemaFacts;
  schemaPath?:string;
  fail: (message: string, code: string) => never;
}) {
  // Old zero-prop sources may not declare a statically readable schema.
  if(input.facts.status!=='resolved'){
    const diagnostic=input.facts.diagnostics.find(row=>row.code!=='schema.props_schema_not_static');
    if(input.declaration===undefined&&!diagnostic)return;
    return input.fail(`${input.schemaPath??'src/schema.ts'} ${diagnostic?.propPath??'propsSchema'}: ${diagnostic?.message??'Schema is not statically resolved'}.`,
      'component_standard.props.schema_unresolved');
  }
  let source: unknown;
  if (input.declaration !== undefined) {
    try { source = JSON.parse(input.declaration); }
    catch { return input.fail('src/showcase.json must contain valid JSON.', 'component.showcase.json_invalid'); }
  }
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
    if (!(error instanceof ComponentShowcaseError)) throw error;
    const isDefault = error.path[0] === 'props';
    const file = error.source==='schema'?(input.schemaPath??'src/schema.ts'):isDefault ? 'src/preview-props.json' : 'src/showcase.json';
    let message = error.code;
    if (isDefault && error.code === 'component.showcase.props_invalid') {
      const key = error.path[1];
      const field = typeof key === 'string' ? input.facts.properties[key] : undefined;
      message = 'Value does not match the declared parameter constraints';
      if (typeof key === 'string' && field && error.path.length === 2) {
        if (!Object.hasOwn(input.preview.props, key) && input.facts.requiredPropKeys.includes(key)) {
          message = 'Required value is missing';
        } else if (field.type) {
          message = `Expected a value matching the declared ${field.type} parameter`;
        }
      }
    }
    return input.fail(`${file} ${error.path.join('.')}: ${message}.`, error.code);
  }
}
