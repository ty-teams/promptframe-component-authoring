import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePromptFrameDependencyPolicy } from '../dist/dependency-policy-evaluator.js';

const check = (source, extra = {}) => evaluatePromptFrameDependencyPolicy({
  packageJson: { dependencies: {react:'^19.0.0'}, devDependencies: {vite:'^7.0.0', '@types/react':'^19.0.0', 'dev-only-tool':'1.0.0'} },
  lockfilePresent:true, runtimeEntryPaths:['src/index.tsx'], files:[{path:'src/index.tsx',sourceText:source}], ...extra,
});
const codes = report => report.diagnostics.map(item => item.code);

test('pure dev tools and erased type imports do not become runtime catalog requests', () => {
  const result = check('import React from "react";import type {X} from "dev-only-tool";export type {Y} from "dev-only-tool";export default ()=> <div/>;');
  assert.equal(result.status, 'allow');
  assert.deepEqual(result.dependencies.map(item=>item.name), ['react']);
});
test('dev labels cannot exempt runtime imports or runtime-reachable test files', () => {
  assert(codes(check('import x from "dev-only-tool";export default x;')).includes('dependency.runtime.dev_only_import'));
  const result = check('', {runtimeEntryPaths:['src/index.ts'], files:[
    {path:'src/index.ts',sourceText:'export {default} from "./implementation.test.js";'},
    {path:'src/implementation.test.ts',sourceText:'import x from "dev-only-tool/subpath";export default x;'},
  ]});
  assert(codes(result).includes('dependency.runtime.dev_only_import'));
});
test('type-only paths are erased but mixed type and value imports retain runtime checks', () => {
  assert.equal(check('import {type X} from "dev-only-tool";export type {Y} from "./missing";').status, 'allow');
  assert(codes(check('import {type X, value} from "dev-only-tool";')).includes('dependency.runtime.dev_only_import'));
});
test('cycles resolve once and unused dev entries do not contaminate the runtime closure', () => {
  const result = check('', { runtimeEntryPaths:['src/index.ts'], files:[
    {path:'src/index.ts',sourceText:'export * from "./part.js";'},
    {path:'src/part.ts',sourceText:'export * from "./index.js";import React from "react";'},
    {path:'vite.config.ts',sourceText:'import vite from "vite";'},
  ]});
  assert.equal(result.status, 'allow');
});
test('missing, escaped, dynamic and invalid source closures cannot pass', () => {
  for (const source of ['import x from "./missing";', 'export * from "../../outside";', 'require(name)', 'export const =']) {
    assert.equal(check(source).status, 'reject', source);
  }
  assert(codes(check('import x from "unlisted"')).includes('dependency.runtime.undeclared_import'));
});
test('declared runtime catalog, frozen locks, native and lifecycle protections remain', () => {
  assert.equal(check('', {packageJson:{dependencies:{'unknown-package':'1.0.0'}}}).status, 'manual_review');
  assert.equal(check('', {lockfilePresent:false}).status, 'reject');
  assert.equal(check('', {packageJson:{dependencies:{'prebuild-install':'7.0.0'}}}).status, 'reject');
  assert.equal(check('', {packageJson:{scripts:{postinstall:'do something'}}}).status, 'reject');
});
