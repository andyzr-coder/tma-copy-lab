// Byte addresses for the requested logical copy, not rounded AXI accesses.
// Separate example allocations; page phases follow the performance controls.
import {exactAddress} from './engine.mjs';

export const EXAMPLE_BASES={A:0x10000000,X:0x10000000,B:0x20000000,Y:0x30000000};
export const sourceBuffer=(model,source)=>model.kind==='im2col'?'X':source;
export const sourceOffset=(model,cell)=>(model.kind==='im2col'?cell.value-1:cell.element)*model.bytes;
const range=(base,offset,length)=>({offset,start:base+offset,end:base+offset+length-1,length});
const phase=value=>Number.isFinite(+value)?Math.floor(Math.max(0,Math.min(3968,+value))/128)*128:0;

export function addressTrace(model,options={}){
  const srcPage=phase(options.srcPage),dstPage=phase(options.dstPage),unit=model.vector*model.bytes;
  const buffers=[];
  if(model.kind==='im2col')buffers.push({id:'X',base:EXAMPLE_BASES.X+srcPage,bytes:model.sources.reduce((n,s)=>n+s.cells.length*unit,0)});
  else for(const s of model.sources)buffers.push({id:s.id,base:EXAMPLE_BASES[s.id]+srcPage,bytes:s.cells.length*unit});
  buffers.push({id:'Y',base:EXAMPLE_BASES.Y+dstPage,bytes:model.output.length*unit});
  for(const b of buffers)b.end=b.bytes?b.base+b.bytes-1:null;
  const bases=Object.fromEntries(buffers.map(b=>[b.id,b.base]));
  const segments=model.events.map((event,index)=>{
    const cmd=model.commands[event.command],local=index-cmd.first;
    const y=local%cmd.desc.box[1],z=Math.floor(local/cmd.desc.box[1]);
    const buffer=sourceBuffer(model,event.pairs[0].src.source),length=event.pairs.length*unit;
    const src=range(bases[buffer],sourceOffset(model,event.pairs[0].src),length);
    const dst=range(bases.Y,event.pairs[0].dst*unit,length);
    return {index,command:event.command,sourceBuffer:buffer,bytes:length,src,dst,y,z,
      descriptorSrcOffset:exactAddress(cmd.desc,'src',0,y,z,model.bytes),
      descriptorDstOffset:exactAddress(cmd.desc,'dst',0,y,z,model.bytes)};
  });
  const summarize=(rows,side)=>({first:rows[0][side].start,last:rows.at(-1)[side].end,
    contiguous:rows.every((r,i)=>i===0||r[side].start===rows[i-1][side].end+1),
    payload:rows.reduce((n,r)=>n+r.bytes,0)});
  const commands=model.commands.map(cmd=>{
    const rows=segments.slice(cmd.first,cmd.first+cmd.count);
    return {id:cmd.id,title:cmd.title,sourceBuffer:rows[0].sourceBuffer,first:cmd.first,count:cmd.count,
      src:summarize(rows,'src'),dst:summarize(rows,'dst')};
  });
  return {units:'bytes; inclusive end addresses',warning:'Example buffer addresses for logical payloads; not physical allocations or expanded bus access ranges.',
    buffers,bases,segments,commands,prezero:model.prezero&&model.output.length?range(bases.Y,0,model.output.length*unit):null};
}

export function selectedAddresses(model,trace,selection,lane=0){
  if(!selection)return null;
  const channel=Math.max(0,Math.min(model.vector-1,Math.floor(lane))),unit=model.vector*model.bytes;
  if(selection.type==='src'){
    const cell=model.sources.flatMap(s=>s.cells).find(c=>c.key===selection.key);
    if(!cell)return null;
    const buffer=sourceBuffer(model,cell.source),offset=sourceOffset(model,cell);
    return {kind:'source',label:`${cell.source}[${cell.row},${cell.col}]`,lane:channel,buffer,
      cell:range(trace.bases[buffer],offset,unit),element:range(trace.bases[buffer],offset+channel*model.bytes,model.bytes)};
  }
  const out=model.output[selection.index];if(!out)return null;
  const offset=selection.index*unit;
  const result={kind:out.untouched?'untouched':out.from?'destination':'padding',label:`Y[${out.row},${out.col}]`,lane:channel,
    buffer:'Y',cell:range(trace.bases.Y,offset,unit),element:range(trace.bases.Y,offset+channel*model.bytes,model.bytes)};
  if(out.from){const buffer=sourceBuffer(model,out.from.source);result.sourceBuffer=buffer;result.sourceElement=range(trace.bases[buffer],sourceOffset(model,out.from)+channel*model.bytes,model.bytes);}
  return result;
}

export function coordinateCalculation(model,eventIndex){
  const event=model.events[eventIndex];if(!event)return null;
  const c=model.c,pair=event.pairs[0],out=model.output[pair.dst],V=model.vector,E=model.bytes;
  let source,destination,meaning;
  if(model.kind==='im2col'){
    const m=out.row,n=Math.floor(m/(model.p*model.q)),p=Math.floor((m%(model.p*model.q))/model.q),q=m%model.q;
    const r=Math.floor(out.col/c.s),s=out.col%c.s,h=p*c.sh-c.ph+r*c.dh,w=q*c.sw-c.pw+s*c.dw;
    source=`(((n × H + h) × W + w) × C + c) × E\n= (((${n} × ${c.h} + ${h}) × ${c.w} + ${w}) × ${V} + 0) × ${E}`;
    destination=`(m × K + (r × S + s) × C + c) × E\n= (${m} × ${model.k} + (${r} × ${c.s} + ${s}) × ${V} + 0) × ${E}`;
    meaning=`当前窗口 (p,q)=(${p},${q})，核位置 (r,s)=(${r},${s})。h = ${p}×${c.sh} − ${c.ph} + ${r}×${c.dh} = ${h}；w = ${q}×${c.sw} − ${c.pw} + ${s}×${c.dw} = ${w}。m=${m}，K=R×S×C=${model.k}；c=0 表示本段第一个通道。`;
  }else if(model.kind==='slice'){
    source=`(((起始行 + 输出行 × 取行步长) × W + 起始列 + 输出列 × 取列步长) × V) × E\n= (((${c.y} + ${out.row} × ${c.sy}) × ${c.w} + ${c.x} + ${out.col} × ${c.sx}) × ${V}) × ${E}`;
    destination=`(输出行 × 输出宽 + 输出列) × V × E\n= (${out.row} × ${c.ow} + ${out.col}) × ${V} × ${E}`;
    meaning='源起点包含切片偏移；取行/取列步长决定跳过哪些位置。目的按切片后的行宽紧密排列。V 是每格连续元素数。';
  }else{
    const grid=model.sources.find(s=>s.id===pair.src.source);
    source=`(源行 × 源行总格数 + 源列) × V × E\n= (${pair.src.row} × ${grid.cols} + ${pair.src.col}) × ${V} × ${E}`;
    destination=`(目的行 × 目的行总格数 + 目的列) × V × E\n= (${out.row} × ${model.cols} + ${out.col}) × ${V} × ${E}`;
    meaning=model.kind==='copy'?'源、目的各用自己的行宽和起点。V 是每格连续元素数；A 与 Y 是独立缓冲区。':`每个输入使用自己的基址和行宽。${pair.src.source==='B'?(c.axis==='col'?`B 的目的列额外加 A 的宽度 ${c.a}。`:`B 的目的行额外加 A 的高度 ${c.a}。`):'当前搬输入 A。'}V 是每格连续元素数。`;
  }
  return {source,destination,meaning,sourceOffset:sourceOffset(model,pair.src),destinationOffset:pair.dst*V*E};
}
