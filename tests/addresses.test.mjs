import test from 'node:test';
import assert from 'node:assert/strict';
import {build,materializeDescriptor,presets} from '../engine.mjs';
import {addressTrace,selectedAddresses,coordinateCalculation,EXAMPLE_BASES} from '../addresses.mjs';

function verify(model){
  const trace=addressTrace(model,{srcPage:3968,dstPage:128});
  for(const cmd of model.commands){
    const rows=trace.segments.slice(cmd.first,cmd.first+cmd.count),expanded=[];
    for(const r of rows){
      assert.equal(r.src.offset,r.descriptorSrcOffset);assert.equal(r.dst.offset,r.descriptorDstOffset);
      assert.equal(r.src.end-r.src.start+1,r.bytes);assert.equal(r.dst.end-r.dst.start+1,r.bytes);
      const buffer=trace.buffers.find(b=>b.id===r.sourceBuffer),dest=trace.buffers.find(b=>b.id==='Y');
      assert(r.src.start>=buffer.base&&r.src.end<=buffer.end);assert(r.dst.start>=dest.base&&r.dst.end<=dest.end);
      for(let byte=0;byte<r.bytes;byte+=model.bytes)expanded.push([r.src.offset+byte,r.dst.offset+byte]);
      const calc=coordinateCalculation(model,r.index);
      assert.equal(calc.sourceOffset,r.src.offset);assert.equal(calc.destinationOffset,r.dst.offset);
    }
    assert.deepEqual(expanded,materializeDescriptor(cmd.desc,model.bytes));
    assert.equal(trace.commands[cmd.id].src.payload,rows.reduce((n,r)=>n+r.bytes,0));
  }
  return trace;
}
test('Addresses agree with every preset descriptor, including offsets and padding',()=>{
  for(const kind of Object.keys(presets))for(const [,config] of presets[kind])verify(build(kind,config));
  verify(build('slice',{sy:2,sx:2,vec:4,bytes:4}));
});
test('Three im2col strategies keep batch offsets, stride and dilation correct',()=>{
  let seed=57;const rnd=(min,max)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return min+seed%(max-min+1);};
  for(let i=0;i<80;i++){
    const c={n:2,h:rnd(2,7),w:rnd(2,7),r:rnd(1,3),s:rnd(1,3),sh:rnd(1,3),sw:rnd(1,3),dh:rnd(1,3),dw:rnd(1,3),ph:rnd(0,2),pw:rnd(0,2),vec:i%8?1:128,bytes:[1,2,4][i%3]};
    for(const strategy of ['kernel','window','row'])verify(build('im2col',{...c,strategy}));
  }
});
test('A and B have separate bases, destination strides create real gaps',()=>{
  const m=build('concat'),t=addressTrace(m);
  assert.equal(t.commands[0].src.first,EXAMPLE_BASES.A);
  assert.equal(t.commands[1].src.first,EXAMPLE_BASES.B);
  assert.equal(t.commands[1].dst.first,EXAMPLE_BASES.Y+6);
  assert.equal(t.commands[0].src.contiguous,true);assert.equal(t.commands[0].dst.contiguous,false);
  assert.equal(t.segments[0].dst.end,EXAMPLE_BASES.Y+5);
  assert.equal(t.segments[1].dst.start,EXAMPLE_BASES.Y+10);
});
test('Displayed channel addresses differ from the full vector, and padding has no source',()=>{
  const m=build('im2col',{n:2,vec:128}),t=addressTrace(m);
  const picked=selectedAddresses(m,t,{type:'src',key:'X1:0:0'},127);
  assert.equal(picked.element.start,EXAMPLE_BASES.X+4*4*128*2+254);
  assert.equal(picked.element.length,2);assert.equal(picked.cell.length,256);
  const p=build('im2col',{r:3,s:3,ph:1,pw:1}),pt=addressTrace(p);
  const zero=selectedAddresses(p,pt,{type:'dst',index:0});
  assert.equal(zero.kind,'padding');assert.equal(zero.sourceElement,undefined);
  assert.equal(pt.prezero.length,p.outputElements*p.bytes);
  const copy=build('copy',{cols:3,srcCols:6,dstCols:5,srcX:1,dstX:1});
  assert.equal(selectedAddresses(copy,addressTrace(copy),{type:'dst',index:0}).kind,'untouched');
});
test('No-output and all-padding cases do not create read addresses',()=>{
  const empty=addressTrace(build('im2col',{h:2,w:2,r:3,s:3,dh:3,dw:3}));
  assert.equal(empty.segments.length,0);assert.equal(empty.buffers.find(b=>b.id==='Y').end,null);
  const zero=addressTrace(build('im2col',{h:2,w:2,r:2,s:2,dh:3,dw:3,ph:1,pw:1}));
  assert.equal(zero.commands.length,0);assert.equal(zero.prezero.end,EXAMPLE_BASES.Y+7);
});
