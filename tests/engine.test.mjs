import test from 'node:test';
import assert from 'node:assert/strict';
import {build,defaults,normalize,materializeDescriptor,inspectRTL} from '../engine.mjs';

function checkDescriptors(m){
  for(const cmd of m.commands){
    const expected=[];
    for(const event of m.events.slice(cmd.first,cmd.first+cmd.count))for(const p of event.pairs)for(let ch=0;ch<m.vector;ch++){
      const source=(m.kind==='im2col'?p.src.value-1:p.src.element)+ch;
      expected.push([source*m.bytes,(p.dst*m.vector+ch)*m.bytes]);
    }
    assert.deepEqual(materializeDescriptor(cmd.desc,m.bytes),expected,`${m.kind} ${JSON.stringify(m.c)} command ${cmd.id}`);
  }
  const writes=m.events.flatMap(e=>e.pairs.map(p=>p.dst));
  assert.equal(new Set(writes).size,writes.length,'No destination written twice');
  assert.equal(m.payloadElements,writes.length*m.vector);
}

function checkReference(m){
  const c=m.c;
  if(m.error){assert.equal(m.commands.length,0);return;}
  const expected=[];
  if(m.kind==='concat'){
    for(let r=0;r<m.rows;r++)for(let col=0;col<m.cols;col++){
      if(c.axis==='col') expected.push(col<c.a?`A:${r}:${col}`:`B:${r}:${col-c.a}`);
      else expected.push(r<c.a?`A:${r}:${col}`:`B:${r-c.a}:${col}`);
    }
  }else if(m.kind==='slice'){
    for(let r=0;r<c.oh;r++)for(let col=0;col<c.ow;col++)expected.push(`A:${c.y+r*c.sy}:${c.x+col*c.sx}`);
  }else{
    const P=Math.max(0,Math.floor((c.h+2*c.ph-(c.r-1)*c.dh-1)/c.sh)+1);
    const Q=Math.max(0,Math.floor((c.w+2*c.pw-(c.s-1)*c.dw-1)/c.sw)+1);
    assert.equal(m.rows,c.n*P*Q);
    for(let n=0;n<c.n;n++)for(let p=0;p<P;p++)for(let q=0;q<Q;q++)for(let r=0;r<c.r;r++)for(let s=0;s<c.s;s++){
      const h=p*c.sh-c.ph+r*c.dh,w=q*c.sw-c.pw+s*c.dw;
      expected.push(h>=0&&h<c.h&&w>=0&&w<c.w?`X${n}:${h}:${w}`:null);
    }
  }
  assert.deepEqual(m.output.map(o=>o.from?.key??null),expected);
  if(expected.some(x=>x===null))assert.equal(m.prezero,true,'Padding requires prezero');
  checkDescriptors(m);
}

test('The introductory examples produce two, one and four copies',()=>{
  assert.equal(build('concat').commands.length,2);
  assert.equal(build('slice').commands.length,1);
  assert.equal(build('im2col').commands.length,4);
  assert.equal(build('im2col',{strategy:'window'}).commands.length,18);
  for(const kind of Object.keys(defaults))checkReference(build(kind));
});
test('Every displayed vector expands to exactly the descriptor addresses',()=>{
  for(const vec of [1,4,32,128])for(const bytes of [1,2,4]){
    for(const axis of ['row','col'])checkReference(build('concat',{axis,vec,bytes}));
    for(const sx of [1,2,3])for(const sy of [1,2])checkReference(build('slice',{sx,sy,vec,bytes}));
    for(const strategy of ['kernel','window','row'])checkReference(build('im2col',{vec,bytes,strategy,n:2,ph:1,pw:1,r:3,s:3}));
  }
});
test('Independent im2col oracle covers stride, dilation, padding and batch',()=>{
  let seed=284;
  const rnd=(a,b)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return a+seed%(b-a+1);};
  for(let i=0;i<240;i++){
    const cfg={n:rnd(1,2),h:rnd(2,7),w:rnd(2,7),r:rnd(1,3),s:rnd(1,3),sh:rnd(1,3),sw:rnd(1,3),dh:rnd(1,3),dw:rnd(1,3),ph:rnd(0,2),pw:rnd(0,2),vec:i%12===0?128:1,bytes:2};
    const kernel=build('im2col',{...cfg,strategy:'kernel'}),window=build('im2col',{...cfg,strategy:'window'}),row=build('im2col',{...cfg,strategy:'row'});
    checkReference(kernel);checkReference(window);checkReference(row);
    assert.deepEqual(kernel.output.map(o=>o.from?.key??null),window.output.map(o=>o.from?.key??null));
    assert.equal(kernel.payloadElements,window.payloadElements);
    assert.deepEqual(kernel.output.map(o=>o.from?.key??null),row.output.map(o=>o.from?.key??null));
    assert.equal(kernel.payloadElements,row.payloadElements);
  }
});
test('Grouped window rows retain overlap while allowing wider legal copies',()=>{
  const overlap=build('im2col',{vec:128,strategy:'row'});
  checkReference(overlap);assert.equal(overlap.rtlOK,true);
  assert.equal(overlap.commands.length,12);assert.equal(overlap.events.length,18);
  for(const cmd of overlap.commands)assert(cmd.desc.srcGlb[0]>=cmd.desc.box[0]);
  const wide=build('im2col',{h:4,w:7,r:1,s:3,sw:3,vec:128,strategy:'row'});
  checkReference(wide);assert.equal(wide.rtlOK,true);assert.equal(wide.commands.length,4);
  assert(wide.commands.every(c=>c.desc.box[0]*wide.bytes===768));
});
test('RTL screen distinguishes exact teaching lengths from rounded transfer widths',()=>{
  for(const kind of Object.keys(defaults)){
    assert.equal(build(kind).rtlOK,false);
    assert.equal(build(kind,{vec:128,bytes:2}).rtlOK,true);
  }
  const d={srcBase:0,dstBase:0,srcGlb:[128,3,1],dstGlb:[512,3,1],srcStart:[0,0,0],dstStart:[0,0,0],box:[1,3,1]};
  assert.equal(inspectRTL(d,2).actualBytes,64);
  assert.equal(inspectRTL(d,2,'MATMUL').actualBytes,256);
  assert.equal(inspectRTL({...d,box:[33,3,1]},2).actualBytes,256);
  assert(inspectRTL({...d,srcGlb:[64,3,1]},2).issues.some(x=>x.code==='pitch'));
  assert(inspectRTL({...d,srcBase:2},2).issues.some(x=>x.code==='base'));
  assert(inspectRTL({...d,srcStart:[1,0,0]},2).issues.some(x=>x.code==='origin'));
});
test('Empty and all-padding outputs do not read invalid memory',()=>{
  assert.equal(build('im2col',{h:2,w:2,r:3,s:3,dh:3,dw:3}).commands.length,0);
  const allZero=build('im2col',{h:2,w:2,r:2,s:2,dh:3,dw:3,ph:1,pw:1});
  assert.equal(allZero.commands.length,0);assert.equal(allZero.zeroCount,4);assert.equal(allZero.prezero,true);
  checkReference(allZero);
});
test('Slice parameters are clamped to the available sampled extent',()=>{
  const c=normalize('slice',{h:5,w:6,y:4,x:5,oh:7,ow:7,sy:3,sx:3});
  assert.equal(c.oh,1);assert.equal(c.ow,1);checkReference(build('slice',c));
});
