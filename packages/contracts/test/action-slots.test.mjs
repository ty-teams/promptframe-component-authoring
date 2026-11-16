import test from 'node:test';
import assert from 'node:assert/strict';
import {componentActionSlotsSchema,resolveComponentActionSlotSchema,validateComponentActionSlotSchemas} from '../dist/index.js';
const slot=(propPath=['sparkFrame'])=>({name:'spark',description:'开始强调的局部帧',propPath,unit:'frame',timeBase:'node'});
test('action slots explicitly select numeric props in the node frame coordinate',()=>{
 const slots=componentActionSlotsSchema.parse([slot()]),schema={type:'object',properties:{sparkFrame:{type:'integer',minimum:0}}};
 assert.deepEqual(validateComponentActionSlotSchemas(schema,slots),[]);
 assert.deepEqual(resolveComponentActionSlotSchema(schema,slots[0]),schema.properties.sparkFrame);
 assert.equal(componentActionSlotsSchema.safeParse([{...slot(),timeBase:'seconds'}]).success,false);
 assert.equal(componentActionSlotsSchema.safeParse([slot(),slot()]).success,false);
 assert.equal(componentActionSlotsSchema.safeParse([slot(),{...slot(),name:'other'}]).success,false);
});
test('nested props, array positions and local refs remain bounded and do not execute code',()=>{
 const schema={type:'object',properties:{actions:{type:'array',items:{$ref:'#/$defs/action'}}},$defs:{action:{type:'object',properties:{at:{type:'number'}}}}};
 const declaration=componentActionSlotsSchema.parse([slot(['actions',0,'at'])])[0];
 assert.equal(resolveComponentActionSlotSchema(schema,declaration)?.type,'number');
 const recursive={type:'object',properties:{actions:{type:'array',items:{$ref:'#/$defs/action'}}},$defs:{action:{type:'object',properties:{at:{type:'number'},next:{$ref:'#/$defs/action'}}}}};
 assert.equal(resolveComponentActionSlotSchema(recursive,slot(['actions',0,'next','at']))?.type,'number');
 assert.equal(resolveComponentActionSlotSchema({type:'object',properties:{sparkFrame:{$ref:'https://untrusted.invalid/schema'}}},slot()),undefined);
 assert.equal(resolveComponentActionSlotSchema({type:'object',properties:{sparkFrame:{$ref:'#/properties/sparkFrame'}}},slot()),undefined);
 for(const key of ['__proto__','prototype','constructor'])assert.equal(componentActionSlotsSchema.safeParse([slot([key])]).success,false);
 let called=0;const hostile={type:'object',properties:{}};Object.defineProperty(hostile.properties,'sparkFrame',{get(){called++;return{type:'integer'};}});
 assert.equal(resolveComponentActionSlotSchema(hostile,slot()),undefined);assert.equal(called,0);
 const getter={};Object.defineProperty(getter,'$ref',{get(){called++;return'https://untrusted.invalid';}});
 assert.equal(resolveComponentActionSlotSchema(getter,slot()),undefined);assert.equal(called,0);
});
test('undeclared, string and arbitrary schema targets cannot become timing controls',()=>{
 for(const target of [undefined,{type:'string'},{type:'object'},true,{$ref:'#/missing'}]){
  const errors=validateComponentActionSlotSchemas({type:'object',properties:{sparkFrame:target}},[slot()]);
  assert.deepEqual(errors,[{code:'component.action_slot.numeric_property_required',name:'spark',propPath:['sparkFrame']}]);
 }
});
