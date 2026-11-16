import {z} from 'zod';

const part=z.union([z.string().min(1).max(120).refine(value=>!['__proto__','prototype','constructor'].includes(value),'Unsafe property path'),
 z.number().int().min(0).max(4095)]);
/** Explicit frame-valued props. They receive the component node's local
 * timeline coordinate, without changing its duration or internal phase map. */
export const componentActionSlotSchema=z.object({
 name:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u),
 description:z.string().trim().min(1).max(240),
 propPath:z.array(part).min(1).max(8),
 unit:z.literal('frame'),timeBase:z.literal('node'),
}).strict();
export const componentActionSlotsSchema=z.array(componentActionSlotSchema).max(32).superRefine((slots,ctx)=>{
 const names=new Set<string>(),paths=new Set<string>();
 slots.forEach((slot,index)=>{
  const path=JSON.stringify(slot.propPath);
  if(names.has(slot.name))ctx.addIssue({code:'custom',path:[index,'name'],message:'Duplicate action slot name'});
  if(paths.has(path))ctx.addIssue({code:'custom',path:[index,'propPath'],message:'Duplicate action slot property'});
  names.add(slot.name);paths.add(path);
 });
});
export type ComponentActionSlot=z.infer<typeof componentActionSlotSchema>;
type ObjectValue=Record<string,unknown>;
const object=(value:unknown):value is ObjectValue=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const own=(value:unknown,key:string|number):unknown=>object(value)||Array.isArray(value)
 ?Object.getOwnPropertyDescriptor(value,String(key))?.value:undefined;

/** Only local JSON Schema references are followed. No imports or IO occur. */
export function resolveComponentActionSlotSchema(root:unknown,slot:ComponentActionSlot):ObjectValue|undefined{
 let refCount=0;
 const dereference=(value:unknown):ObjectValue|undefined=>{
  let current=value;const refs=new Set<string>();
  while(object(current)&&typeof own(current,'$ref')==='string'){
   const ref=own(current,'$ref') as string;
   if(!ref.startsWith('#/')||refs.has(ref)||++refCount>16)return;
   refs.add(ref);current=root;
   for(const raw of ref.slice(2).split('/')){
    if(/~(?![01])/u.test(raw))return;
    const key=raw.replace(/~1/gu,'/').replace(/~0/gu,'~');
    if(!part.safeParse(key).success)return;
    current=own(current,key);
   }
  }
  return object(current)?current:undefined;
 };
 let current=dereference(root);
 for(const key of slot.propPath){
  if(!current)return;
  if(typeof key==='number'){
   if(own(current,'type')!=='array')return;
   const items=own(current,'items'),tuple=own(current,'prefixItems')??(Array.isArray(items)?items:undefined);
   current=dereference(Array.isArray(tuple)?own(tuple,key):items);
  }else current=dereference(own(own(current,'properties'),key));
 }
 return current&&(own(current,'type')==='integer'||own(current,'type')==='number')?current:undefined;
}

export function validateComponentActionSlotSchemas(schema:unknown,slots:readonly ComponentActionSlot[]):Array<{code:'component.action_slot.numeric_property_required';name:string;propPath:Array<string|number>}>{
 return slots.flatMap(slot=>resolveComponentActionSlotSchema(schema,slot)?[]:[{
  code:'component.action_slot.numeric_property_required' as const,name:slot.name,propPath:[...slot.propPath],
 }]);
}
