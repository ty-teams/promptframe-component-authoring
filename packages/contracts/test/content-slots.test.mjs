import { test } from 'node:test';
import assert from 'node:assert/strict';
import { componentContentSlotsSchema, partitionComponentContentChildren, promptFrameContentSlot } from '../dist/content-slots.js';

const declarations = [{ name: 'description', description: 'Explanatory content', maxChildren: 2 }];
test('content slots preserve child order and keep unassigned children at the original entry', () => {
  const result = partitionComponentContentChildren({ declarations, children: ['a', 'b', 'c'],
    slotByChildId: { c: 'description', a: 'description' }, hasNode: () => true });
  assert.deepEqual(result.children, ['b']);
  assert.deepEqual(result.slots.description, ['a', 'c']);
  assert.deepEqual(partitionComponentContentChildren({ declarations, children: ['a'], slotByChildId: {} }).children, ['a']);
});
test('content assignments reject unknown, indirect, missing and over-capacity children', () => {
  for (const [code, input] of [
    ['unknown_slot', { children: ['a'], slotByChildId: { a: 'other' } }],
    ['not_direct_child', { children: [], slotByChildId: { a: 'description' } }],
    ['missing_child', { children: ['a'], slotByChildId: { a: 'description' }, hasNode: () => false }],
    ['too_many_children', { children: ['a', 'b', 'c'], slotByChildId: { a: 'description', b: 'description', c: 'description' } }],
  ]) assert.throws(() => partitionComponentContentChildren({ declarations, ...input }),
    (error) => error.code === code);
});
test('slot declarations are optional, unique, bounded and do not borrow resource slots', () => {
  assert.deepEqual(componentContentSlotsSchema.parse(declarations), declarations);
  assert.equal(componentContentSlotsSchema.safeParse([...declarations, ...declarations]).success, false);
  assert.equal(componentContentSlotsSchema.safeParse([{ ...declarations[0], name: '../description' }]).success, false);
  assert.equal(componentContentSlotsSchema.safeParse([{ ...declarations[0], maxChildren: 0 }]).success, false);
});
test('the host getter preserves an assigned empty representation and ordinary fallback', () => {
  assert.equal(promptFrameContentSlot({}, 'description', 'default'), 'default');
  assert.equal(promptFrameContentSlot({ promptFrameContentSlots: { get: () => '' } }, 'description', 'default'), '');
  assert.equal(promptFrameContentSlot({ promptFrameContentSlots: { get: () => 'child' } }, 'description', 'default'), 'child');
});

test('an older host cannot silently turn actual content assignments into fallback text', () => {
  assert.throws(() => promptFrameContentSlot({ spec: { nodes: {
    parent: { slotByChildId: { note: 'description' } },
  } } }, 'description', 'default'), error => error.code === 'host_unavailable');
});
