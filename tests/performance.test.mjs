import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from '../engine.mjs';
import {analyze,compare,countTransfers,endpointSegments,tileScenario} from '../performance.mjs';

test('Narrow unsupported descriptors have no fabricated bus counts or time',()=>{
  for(const kind of ['copy','concat','slice','im2col']){
    const comparison=compare(kind,{});
    assert.equal(comparison.best,null);
    for(const {metrics} of comparison.candidates){assert.equal(metrics.eligible,false);assert.equal(metrics.estimate,null);assert.equal(metrics.read,null);}
  }
  const m=analyze(build('im2col'));
  assert.equal(m.logicalRead,72);assert.equal(m.logicalWrite,72);assert.equal(m.uniqueInputBytes,32);assert.equal(m.reuse,2.25);
});
test('Read and write merge independently, and endpoints count requests differently',()=>{
  const model=build('im2col',{vec:128,strategy:'kernel'});
  const a=analyze(model,{ports:'mif-mif'}),b=analyze(model,{ports:'l1-mif'});
  assert.equal(a.read.segments,12);assert.equal(a.write.segments,36);
  assert.equal(a.read.beats,72);assert.equal(a.write.beats,72);
  // Three 768B read rows per kernel; a read crosses 4096 only for large inputs.
  assert.equal(a.read.requests,12);assert.equal(a.write.requests,36);
  assert.equal(b.read.requests,72);assert.equal(b.write.requests,36);
  assert.equal(a.estimate.capacity,18432);
  const concat=analyze(build('concat',{axis:'row',vec:128}),{ports:'mif-mif'});
  assert.equal(concat.read.segments,2);assert.equal(concat.write.segments,2);
});
test('128B beats, L1 single beats, and MIF 32-beat/4KB splitting',()=>{
  assert.deepEqual(countTransfers([{address:0,bytes:64}],'mif'),{segments:1,payload:64,beats:1,requests:1,capacity:128});
  assert.equal(countTransfers([{address:0,bytes:8192}],'mif').requests,2);
  assert.equal(countTransfers([{address:3968,bytes:256}],'mif').requests,2);
  assert.equal(countTransfers([{address:0,bytes:256}],'mif',3968).requests,2);
  assert.equal(countTransfers([{address:0,bytes:8192}],'l1').requests,64);
  const d={srcBase:0,srcGlb:[128,3,2],srcStart:[0,0,0],box:[128,3,2]};
  assert.deepEqual(endpointSegments(d,'src',2),[{address:0,bytes:1536}]);
  assert.deepEqual(endpointSegments({...d,srcGlb:[128,4,2]},'src',2),[{address:0,bytes:768},{address:1024,bytes:768}]);
});
test('Recommendation changes with user assumptions rather than command count alone',()=>{
  const config={vec:128};
  const commandsMatter=compare('im2col',config,{ports:'mif-mif',requestNs:0,commandNs:50});
  assert.equal(commandsMatter.best.strategy,'kernel');
  const requestsMatter=compare('im2col',config,{ports:'mif-mif',requestNs:100,commandNs:0});
  assert.equal(requestsMatter.best.strategy,'row');
  const c=compare('im2col',{h:4,w:7,r:1,s:3,sw:3,vec:128});
  assert.equal(c.best.strategy,'row');
  for(const candidate of c.candidates)assert.equal(candidate.metrics.logicalRead,6144);
  const half=compare('im2col',{vec:64});
  assert.equal(half.candidates.find(c=>c.strategy==='kernel').metrics.eligible,false);
  assert.equal(half.best.strategy,'row');
  assert.equal(half.best.metrics.eligible,true);
});
test('Prezero is whole-output traffic before copies, included even on independent ports',()=>{
  const model=build('im2col',{vec:128,r:3,s:3,ph:1,pw:1});
  const m=analyze(model,{fabric:'independent',bandwidth:32,commandNs:0,requestNs:0});
  assert.equal(m.zeroBytes,model.outputElements*2);
  assert(m.zeroBytes>model.zeroCount*model.vector*model.bytes);
  assert.equal(m.estimate.dataNs,(m.zero.capacity+Math.max(m.read.capacity,m.write.capacity))/32);
  assert.equal(m.estimate.capacity,m.read.capacity+m.write.capacity+m.zero.capacity);
  const zero=build('im2col',{h:2,w:2,r:2,s:2,dh:3,dw:3,ph:1,pw:1});
  assert.equal(analyze(zero).logicalRead,0);assert.equal(analyze(zero).zeroBytes,8);
  assert.equal(compare('im2col',zero.c).best,null);
});
test('Tile scenario counts rectangles, halo duplication, output storage and capacity',()=>{
  const m=build('im2col');
  const small=tileScenario(m,{tileP:1,tileQ:1});
  assert.equal(small.readBytes,72);assert.equal(small.peakBytes,16);assert.equal(small.tiles,9);
  const large=tileScenario(m,{tileP:3,tileQ:3});
  assert.equal(large.readBytes,32);assert.equal(large.peakBytes,104);assert.equal(large.baselineBytes,216);
  const tooLarge=tileScenario(build('im2col',{vec:128}),{tileP:3,tileQ:3,sramKiB:1});
  assert.equal(tooLarge.peakBytes,13312);assert.equal(tooLarge.fits,false);
  const dilation=tileScenario(build('im2col',{h:5,w:5,dh:2,dw:2}),{tileP:1,tileQ:1});
  assert.equal(dilation.readBytes,162); // Nine 3x3 rectangles, 2B each.
  assert(dilation.readBytes>72);
  const zero=tileScenario(build('im2col',{h:2,w:2,r:2,s:2,dh:3,dw:3,ph:1,pw:1}));
  assert.equal(zero.readBytes,0);
});
