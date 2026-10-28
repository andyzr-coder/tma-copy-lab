import {build,exactAddress} from './engine.mjs';

export const strategyNames={kernel:'按核位置',window:'按窗口',row:'核行分组'};
export const performanceDefaults={ports:'l1-mif',fabric:'shared',bandwidth:32,requestNs:2,commandNs:50,srcPage:0,dstPage:0,tileP:2,tileQ:2,sramKiB:32};
const clamp=(value,min,max,fallback)=>Number.isFinite(+value)?Math.max(min,Math.min(max,+value)):fallback;
export function normalizePerformance(input={}){
  const a={...performanceDefaults,...input};
  a.ports=['l1-mif','mif-l1','l1-l1','mif-mif'].includes(a.ports)?a.ports:'l1-mif';
  a.fabric=a.fabric==='independent'?'independent':'shared';
  a.bandwidth=clamp(a.bandwidth,1,2048,32);
  a.requestNs=clamp(a.requestNs,0,1000,2);a.commandNs=clamp(a.commandNs,0,10000,50);
  for(const k of ['srcPage','dstPage'])a[k]=Math.floor(clamp(a[k],0,3968,0)/128)*128;
  for(const k of ['tileP','tileQ'])a[k]=Math.round(clamp(a[k],1,7,2));
  a.sramKiB=clamp(a.sramKiB,1,4096,32);
  return a;
}

// Reflect the ordinary walker: each endpoint merges rows/faces independently.
// Do not merge across commands, or across an incomplete declared face.
export function endpointSegments(desc,side,bytes){
  const g=side==='src'?desc.srcGlb:desc.dstGlb,[x,y,z]=desc.box;
  if(x===g[0]&&y===g[1])return [{address:exactAddress(desc,side,0,0,0,bytes),bytes:x*y*z*bytes}];
  if(x===g[0])return Array.from({length:z},(_,k)=>({address:exactAddress(desc,side,0,0,k,bytes),bytes:x*y*bytes}));
  const out=[];
  for(let k=0;k<z;k++)for(let j=0;j<y;j++)out.push({address:exactAddress(desc,side,0,j,k,bytes),bytes:x*bytes});
  return out;
}

// 128B beats. L1 issues one beat/request. MIF has at most 32 beats/request
// and does not cross a 4KB boundary. No cache or cross-command reuse assumed.
export function countTransfers(segments,port,pageOffset=0){
  let beats=0,requests=0,payload=0;
  for(const segment of segments){
    payload+=segment.bytes;
    let address=segment.address+pageOffset;
    let remaining=Math.ceil(((address%128)+segment.bytes)/128);
    address=Math.floor(address/128)*128;
    beats+=remaining;
    while(remaining>0){
      const count=Math.min(remaining,port==='l1'?1:32,(4096-address%4096)/128);
      requests++;remaining-=count;address+=count*128;
    }
  }
  return {segments:segments.length,payload,beats,requests,capacity:beats*128};
}

export function analyze(model,input={}){
  const a=normalizePerformance(input),[srcPort,dstPort]=a.ports.split('-');
  const payload=(model.payloadElements||0)*model.bytes,output=(model.outputElements||0)*model.bytes;
  // Match the existing executable plan: entire output prezero, then valid copies.
  const zeroBytes=model.prezero?output:0;
  const unique=new Set(model.output.filter(o=>o.from).map(o=>o.from.key)).size*model.vector*model.bytes;
  const eligible=!model.error&&model.commands.length>0&&model.rtlOK;
  const commands=model.commands.map(cmd=>{
    const src=endpointSegments(cmd.desc,'src',model.bytes),dst=endpointSegments(cmd.desc,'dst',model.bytes);
    return {id:cmd.id,readSegments:src.length,writeSegments:dst.length,
      read:cmd.rtl.ok?countTransfers(src,srcPort,a.srcPage):null,
      write:cmd.rtl.ok?countTransfers(dst,dstPort,a.dstPage):null};
  });
  const sum=side=>({segments:commands.reduce((n,c)=>n+c[side+'Segments'],0),
    beats:commands.reduce((n,c)=>n+(c[side]?.beats||0),0),
    requests:commands.reduce((n,c)=>n+(c[side]?.requests||0),0),
    capacity:commands.reduce((n,c)=>n+(c[side]?.capacity||0),0)});
  const zero=countTransfers(zeroBytes?[{address:0,bytes:zeroBytes}]:[],dstPort,a.dstPage);
  const read=eligible?sum('read'):null,write=eligible?sum('write'):null;
  let estimate=null;
  if(eligible){
    const writeCapacity=write.capacity+zero.capacity,writeRequests=write.requests+zero.requests;
    const dataNs=(a.fabric==='shared'?read.capacity+writeCapacity:zero.capacity+Math.max(read.capacity,write.capacity))/a.bandwidth;
    const requestCost=(read.requests+writeRequests)*a.requestNs;
    const commandCost=(model.commands.length+(zeroBytes?1:0))*a.commandNs;
    estimate={dataNs,requestCost,commandCost,totalNs:dataNs+requestCost+commandCost,
      capacity:read.capacity+writeCapacity,requests:read.requests+writeRequests,
      efficiency:(2*payload+zeroBytes)/(read.capacity+writeCapacity)};
  }
  return {eligible,assumptions:a,logicalRead:payload,logicalWrite:payload,outputBytes:output,zeroBytes,
    zero,uniqueInputBytes:unique,reuse:unique?payload/unique:0,commands,read,write,estimate,
    segmentWidths:[...new Set(model.commands.map(c=>c.desc.box[0]*model.bytes))].sort((x,y)=>x-y)};
}

export function compare(kind,config,input={}){
  const strategies=kind==='im2col'?['kernel','window','row']:[null];
  const candidates=strategies.map(strategy=>{
    const model=build(kind,strategy?{...config,strategy}:config);
    return {strategy:strategy||kind,name:strategyNames[strategy]||'当前二维 COPY',model,metrics:analyze(model,input)};
  });
  const legal=candidates.filter(c=>c.metrics.eligible).sort((a,b)=>a.metrics.estimate.totalNs-b.metrics.estimate.totalNs||a.model.commands.length-b.model.commands.length);
  return {candidates,best:legal[0]||null};
}

// Architecture what-if only: one rectangular input tile + one expanded output
// tile resident in SRAM. No halo reuse between tiles, double buffer, weights,
// convolution outputs, bus rounding, or executable gathering kernel included.
export function tileScenario(model,input={}){
  if(model.kind!=='im2col'||model.error)return null;
  const a=normalizePerformance(input),c=model.c,E=model.vector*model.bytes,K=c.r*c.s;
  let readBytes=0,peakBytes=0,tiles=0;
  const footprints=[];
  for(let n=0;n<c.n;n++)for(let p=0;p<model.p;p+=a.tileP)for(let q=0;q<model.q;q+=a.tileQ){
    const height=Math.min(a.tileP,model.p-p),width=Math.min(a.tileQ,model.q-q);
    const h0=Math.max(0,p*c.sh-c.ph),h1=Math.min(c.h,(p+height-1)*c.sh-c.ph+(c.r-1)*c.dh+1);
    const w0=Math.max(0,q*c.sw-c.pw),w1=Math.min(c.w,(q+width-1)*c.sw-c.pw+(c.s-1)*c.dw+1);
    const tileOutput=model.output.slice((n*model.p+p)*model.q*K,((n*model.p+p+height)*model.q)*K);
    // An all-padding tile needs no input. Dilation holes inside a nonempty
    // rectangle are still loaded; the footprint is deliberately not unique-only.
    const hasInput=tileOutput.some(o=>o.row%model.q>=q&&o.row%model.q<q+width&&o.from);
    const tileRead=hasInput?Math.max(0,h1-h0)*Math.max(0,w1-w0)*E:0;
    const tileWrite=height*width*K*E;
    readBytes+=tileRead;peakBytes=Math.max(peakBytes,tileRead+tileWrite);tiles++;
    footprints.push({n,p,q,height,width,inputBytes:tileRead,outputBytes:tileWrite});
  }
  const m=analyze(model,a);
  return {tiles,readBytes,peakBytes,capacityBytes:a.sramKiB*1024,fits:peakBytes<=a.sramKiB*1024,
    baselineBytes:m.logicalRead+m.logicalWrite+m.zeroBytes+m.outputBytes,
    uniqueInputBytes:m.uniqueInputBytes,footprints};
}
