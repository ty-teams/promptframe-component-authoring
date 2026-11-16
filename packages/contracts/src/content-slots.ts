import { z } from 'zod';

export const componentContentSlotNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
export const componentContentSlotSchema = z.object({
  name: componentContentSlotNameSchema,
  description: z.string().trim().min(1).max(240),
  maxChildren: z.number().int().min(1).max(64),
}).strict();
export const componentContentSlotsSchema = z.array(componentContentSlotSchema).max(16).superRefine((slots, ctx) => {
  const names = new Set<string>();
  slots.forEach((slot, index) => {
    if (names.has(slot.name)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'name'], message: 'Duplicate content slot name' });
    names.add(slot.name);
  });
});
export type ComponentContentSlot = z.infer<typeof componentContentSlotSchema>;

/** Supplied by the host, independently of the component's serializable props.
 * A missing assignment returns undefined; an assigned but inactive child does
 * not become fallback text. Components place each slot once in their JSX. */
export interface PromptFrameContentSlots<T = unknown> {
  get(name: string): T | undefined;
}

export function promptFrameContentSlot<T>(
  props: { promptFrameContentSlots?: PromptFrameContentSlots<T> }, name: string, fallback: T,
): T {
  return props.promptFrameContentSlots?.get(name) ?? fallback;
}

export class ComponentContentSlotError extends Error {
  constructor(readonly code: 'unknown_slot' | 'not_direct_child' | 'missing_child' | 'too_many_children',
    readonly childId: string, readonly slot: string) {
    super(`component.content_slot.${code}`);
    this.name = 'ComponentContentSlotError';
  }
}

/** Partition the existing ordered children, without creating another graph. */
export function partitionComponentContentChildren(input: {
  children?: readonly string[];
  slotByChildId?: Readonly<Record<string, string>>;
  declarations?: readonly ComponentContentSlot[];
  hasNode?: (id: string) => boolean;
}) {
  const children = [...(input.children ?? [])];
  const direct = new Set(children);
  const declared = new Map((input.declarations ?? []).map(slot => [slot.name, slot]));
  const slots: Record<string, string[]> = Object.create(null);
  for (const [childId, slot] of Object.entries(input.slotByChildId ?? {})) {
    if (!direct.has(childId)) throw new ComponentContentSlotError('not_direct_child', childId, slot);
    if (input.hasNode && !input.hasNode(childId)) throw new ComponentContentSlotError('missing_child', childId, slot);
    if (!declared.has(slot)) throw new ComponentContentSlotError('unknown_slot', childId, slot);
  }
  const unassigned: string[] = [];
  for (const childId of children) {
    const slot = Object.hasOwn(input.slotByChildId ?? {}, childId) ? input.slotByChildId![childId] : undefined;
    if (slot === undefined) { unassigned.push(childId); continue; }
    const group = slots[slot] ?? (slots[slot] = []);
    group.push(childId);
    if (group.length > declared.get(slot)!.maxChildren) throw new ComponentContentSlotError('too_many_children', childId, slot);
  }
  return { children: unassigned, slots };
}
