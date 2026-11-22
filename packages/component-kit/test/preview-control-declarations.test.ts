import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildPromptFramePreviewControlsFromSchema,PromptFramePreviewInspector} from '../src/preview-react.js';

test('a string field named background remains text when its current value resembles a color',()=>{
  const controls=buildPromptFramePreviewControlsFromSchema({propsSchema:{shape:{background:{_def:{typeName:'ZodString'}}}},defaultProps:{background:'#aabbcc'}});
  assert.equal(controls[0]?.type,'text');
});

test('nested strings follow their declared type while explicit colors and enums retain their editors',()=>{
  const html=renderToStaticMarkup(React.createElement(PromptFramePreviewInspector,{
    controls:[{key:'palette',label:'Palette',type:'object',schema:{type:'object',properties:{
      background:{type:'string'},accent:{type:'string',format:'color'},mode:{type:'string',enum:['#ffffff','#000000']},
    }}}],previewProps:{palette:{background:'#aabbcc',accent:'#112233',mode:'#ffffff'}},editable:true,locale:'en',
  }));
  const field=(path:string)=>[...html.matchAll(/<(input|select)\b[^>]*>/g)].map(match=>match[0]).find(tag=>tag.includes(`data-preview-props-field="${path}"`));
  assert.match(field('palette.background')??'',/type="text"/);
  assert.match(field('palette.accent')??'',/type="color"/);
  assert.match(field('palette.mode')??'',/^<select/);
});

test('a color presentation retains the original literal instead of inventing black for an unsupported value',()=>{
  for(const value of ['theme.accent','#abc']){
    const html=renderToStaticMarkup(React.createElement(PromptFramePreviewInspector,{
      controls:[{key:'accent',label:'Accent',type:'color',schema:{type:'string'}}],previewProps:{accent:value},editable:true,locale:'en',
    }));
    assert.match(html,new RegExp(`data-preview-props-color-text="accent"[^>]*value="${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"|value="${value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"[^>]*data-preview-props-color-text="accent"`));
    if(value==='theme.accent')assert.doesNotMatch(html,/type="color"/);
    else assert.match(html,/value="#aabbcc"/);
  }
});
