import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateLocalReusability, reusabilityDiagnostics } from '../dist/reusability.js';
import { terminalDiagnostic } from '../dist/terminal-language.js';

const input = {
  manifest: { displayName: 'Reusable marker', description: 'A parameterized marker.', tags: [], capabilityHints: [] },
  componentSourceText: 'export function Component(props){return <div>{props.headline}</div>;}',
  schemaSourceText: "import {z} from 'zod';export const propsSchema=z.object({headline:z.string().default('Label'),count:z.number().int().default(2)});",
  previewProps: {props:{headline:'Label',count:2}},
  uploadTarget: 'project_private_generation',
  generatedAt: '2026-11-22T00:00:00.000Z',
};

test('CLI reuse advice is invariant under names, comments and equivalent prop-reading syntax', () => {
  const baseline = evaluateLocalReusability(input);
  for (const variant of [input,
    {...input,manifest:{...input.manifest,displayName:'Conference Q1 launch'}},
    {...input,componentSourceText:'// campaign conference promo\n'+input.componentSourceText},
    {...input,componentSourceText:'export function Component({headline}){return <div>{headline}</div>;}'},
  ]) assert.deepEqual(evaluateLocalReusability(variant), baseline);
});

test('CLI advisory does not become a publication or security denial when an example is missing', () => {
  const result = evaluateLocalReusability({...input,uploadTarget:'marketplace_authoring',previewProps:{props:{}}});
  assert.equal(result.recommendation,'warn');
  assert(reusabilityDiagnostics(result).every(diagnostic => diagnostic.severity!=='error'));
  assert.equal(reusabilityDiagnostics(result)[0].code,'component_market.reusability.schema_advisory');
  const diagnostic = reusabilityDiagnostics(result)[0];
  assert.match(terminalDiagnostic(diagnostic,'en').message,/Schema and preview/);
  assert.match(terminalDiagnostic(diagnostic,'zh').message,/复用证据不完整/);
  assert.equal(terminalDiagnostic(diagnostic,'zh').code,diagnostic.code);
});
