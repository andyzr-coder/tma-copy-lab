// Exact educational address model. No hardware or machine-code execution.
export const COMMIT = '64cda54608278fc973be7132cc7f338b699adaeb';
export const defaults = {
  copy: {rows:3,cols:4,srcCols:4,dstCols:4,srcX:0,dstX:0,vec:1,bytes:2},
  concat: {axis:'col',common:3,a:3,b:2,vec:1,bytes:2},
  slice: {h:5,w:6,y:1,x:1,oh:3,ow:3,sy:1,sx:1,vec:1,bytes:2},
  im2col: {n:1,h:4,w:4,vec:1,r:2,s:2,sh:1,sw:1,dh:1,dw:1,ph:0,pw:0,bytes:2,strategy:'kernel'}
};
export const presets = {
  copy: [
    ['一条 COPY，原样搬三行',{...defaults.copy}],
    ['每行只搬一段，两边行距不同',{...defaults.copy,cols:3,srcCols:6,dstCols:5,srcX:1,dstX:1}],
    ['满足对齐的例子',{...defaults.copy,cols:3,srcCols:6,dstCols:5,srcX:1,dstX:1,vec:128}],
    ['先看最简单的一行',{...defaults.copy,rows:1}]
  ],
  concat: [
    ['左右拼起来',{...defaults.concat}],
    ['上下拼起来',{...defaults.concat,axis:'row',common:4,a:2,b:3}],
    ['满足对齐的例子',{...defaults.concat,vec:128}]
  ],
  slice: [
    ['切出中间一块',{...defaults.slice}],
    ['每隔一行取数据',{...defaults.slice,h:6,w:5,y:0,x:1,oh:3,ow:3,sy:2}],
    ['每隔一列取数据',{...defaults.slice,h:4,w:6,y:0,x:0,oh:3,ow:3,sx:2}],
    ['满足对齐的例子',{...defaults.slice,vec:128}]
  ],
  im2col: [
    ['2×2 核，从这里开始',{...defaults.im2col}],
    ['边界补零',{...defaults.im2col,r:3,s:3,ph:1,pw:1}],
    ['步长 stride=2',{...defaults.im2col,h:5,w:5,r:3,s:3,sh:2,sw:2,ph:1,pw:1}],
    ['空洞 dilation=2',{...defaults.im2col,h:5,w:5,dh:2,dw:2}],
    ['对齐后，4 条 copy',{...defaults.im2col,vec:128}],
    ['长核行 + stride=3，比较带宽',{...defaults.im2col,h:4,w:7,r:1,s:3,sw:3,vec:128,strategy:'row'}],
    ['C=64：比较哪些拆法通过检查',{...defaults.im2col,vec:64}]
  ]
};
const int=(v,min,max,f)=>Math.max(min,Math.min(max,Number.isFinite(+v)?Math.round(+v):f));
export function normalize(kind, input={}) {
  const c={...defaults[kind],...input};
  c.vec=[1,2,4,8,16,32,64,128].includes(+c.vec)?+c.vec:1;
  c.bytes=[1,2,4].includes(+c.bytes)?+c.bytes:2;
  if(kind==='copy'){
    c.rows=int(c.rows,1,6,3);c.cols=int(c.cols,1,6,4);
    c.srcCols=int(c.srcCols,c.cols,8,c.cols);c.dstCols=int(c.dstCols,c.cols,8,c.cols);
    c.srcX=int(c.srcX,0,c.srcCols-c.cols,0);c.dstX=int(c.dstX,0,c.dstCols-c.cols,0);
  } else if(kind==='concat'){
    c.axis=c.axis==='row'?'row':'col';
    for(const k of ['common','a','b']) c[k]=int(c[k],1,6,3);
  } else if(kind==='slice'){
    c.h=int(c.h,2,7,5); c.w=int(c.w,2,7,6);
    c.y=int(c.y,0,c.h-1,0); c.x=int(c.x,0,c.w-1,0);
    c.sy=int(c.sy,1,3,1); c.sx=int(c.sx,1,3,1);
    c.oh=int(c.oh,1,Math.floor((c.h-1-c.y)/c.sy)+1,2);
    c.ow=int(c.ow,1,Math.floor((c.w-1-c.x)/c.sx)+1,2);
  } else {
    c.n=int(c.n,1,2,1); c.h=int(c.h,2,7,4); c.w=int(c.w,2,7,4);
    for(const k of ['r','s','sh','sw']) c[k]=int(c[k],1,3,1);
    for(const k of ['dh','dw']) c[k]=int(c[k],1,3,1);
    for(const k of ['ph','pw']) c[k]=int(c[k],0,2,0);
    c.strategy=['window','row','kernel'].includes(c.strategy)?c.strategy:'kernel';
  }
  return c;
}
export function outputShape(c){
  return {p:Math.max(0,Math.floor((c.h+2*c.ph-c.dh*(c.r-1)-1)/c.sh)+1),
          q:Math.max(0,Math.floor((c.w+2*c.pw-c.dw*(c.s-1)-1)/c.sw)+1)};
}
function cell(source,row,col,cols,vec,offset=0){
  return {source,row,col,key:`${source}:${row}:${col}`,element:(row*cols+col)*vec,
    value:offset+(row*cols+col)*vec+1};
}
function descriptor(srcBase,dstBase,srcGlb,dstGlb,box,srcStart=[0,0,0],dstStart=[0,0,0]){
  return {srcBase,dstBase,srcGlb,dstGlb,box,srcStart,dstStart};
}
export function inspectRTL(d, bytes, mode='CONV') {
  const issues=[]; const width=d.box[0]*bytes;
  const quantum=mode==='CONV'&&width<=64?64:256;
  const actualBytes=Math.ceil(width/quantum)*quantum;
  if(d.srcBase%128||d.dstBase%128) issues.push({code:'base',text:'源或目的基地址不是 128B 的整数倍。'});
  if(d.srcGlb[0]*bytes%256||d.dstGlb[0]*bytes%256) issues.push({code:'pitch',text:'普通线性 copy 的两侧行距必须是 256B 的整数倍。'});
  if(d.srcStart[0]*bytes%128||d.dstStart[0]*bytes%128) issues.push({code:'origin',text:'dim0 起点的字节偏移必须是 128B 的整数倍。'});
  if(actualBytes!==width) issues.push({code:'round',text:`希望每行搬 ${width}B；译码实际会扩大为 ${actualBytes}B。`});
  for(const [label,g,s] of [['源',d.srcGlb,d.srcStart],['目的',d.dstGlb,d.dstStart]]){
    if(g.some((v,i)=>s[i]<0||d.box[i]<1||s[i]+(i===0?actualBytes/bytes:d.box[i])>v))
      issues.push({code:'bounds',text:`${label}坐标加上实际搬运尺寸会超过声明的 global 范围。`});
  }
  return {ok:issues.length===0,issues,width,actualBytes,quantum};
}
export function build(kind, input={}){
  const c=normalize(kind,input), e=c.bytes, V=c.vec;
  const result={kind,c,sources:[],output:[],commands:[],events:[],rows:0,cols:0,
    vector:V,bytes:e,prezero:false,zeroCount:0,explain:'',error:null};
  const source=(id,title,rows,cols,offset=0)=>{
    const grid={id,title,rows,cols,cells:Array.from({length:rows*cols},(_,i)=>cell(id,Math.floor(i/cols),i%cols,cols,V,offset))};
    result.sources.push(grid); return grid;
  };
  const init=(rows,cols)=>{
    result.rows=rows;result.cols=cols;
    result.output=Array.from({length:rows*cols},(_,i)=>({row:Math.floor(i/cols),col:i%cols,key:`Y:${Math.floor(i/cols)}:${i%cols}`,from:null}));
  };
  const addCommand=(title,why,desc,segments,extra={})=>{
    if(!segments.length)return;
    const id=result.commands.length;
    const cmd={id,title,why,desc,first:result.events.length,count:segments.length,...extra};
    cmd.rtl=inspectRTL(desc,e,'CONV');
    for(const seg of segments){
      const event={...seg,command:id,index:result.events.length};
      result.events.push(event);
      for(const pair of event.pairs){
        const output=result.output[pair.dst];
        if(output.from) throw Error('Duplicate destination write');
        output.from=pair.src; output.event=event.index;
      }
    }
    result.commands.push(cmd);
  };
  if(kind==='copy'){
    const A=source('A','源缓冲区 A',c.rows,c.srcCols);init(c.rows,c.dstCols);
    const segments=Array.from({length:c.rows},(_,row)=>({label:`源第 ${row} 行的 ${c.cols} 格 → 目的第 ${row} 行`,
      pairs:Array.from({length:c.cols},(_,col)=>({src:A.cells[row*c.srcCols+c.srcX+col],dst:row*c.dstCols+c.dstX+col}))}));
    addCommand('A → Y · 一条二维 COPY','从两边各自的起点出发，每行原样搬 box0 个元素，再按各自 global0 给出的行距换行。没有搬到的位置保持原值。',
      descriptor(0,0,[c.srcCols*V,c.rows,1],[c.dstCols*V,c.rows,1],[c.cols*V,c.rows,1],[c.srcX*V,0,0],[c.dstX*V,0,0]),segments,{source:'A'});
    for(const out of result.output)out.untouched=!out.from;
    result.explain=`一条 COPY 搬 ${c.rows} 行，每行 ${c.cols} 格，共 ${c.rows*c.cols*V*e}B。源行距 ${c.srcCols*V*e}B，目的行距 ${c.dstCols*V*e}B；行距包含不搬的部分。“—”表示此位置不被写入，不代表填零。`;
  } else if(kind==='concat'){
    const horizontal=c.axis==='col';
    const A=source('A','输入 A',horizontal?c.common:c.a,horizontal?c.a:c.common);
    const B=source('B','输入 B',horizontal?c.common:c.b,horizontal?c.b:c.common,10000);
    init(horizontal?c.common:c.a+c.b,horizontal?c.a+c.b:c.common);
    for(const grid of [A,B]){
      const dy=grid.id==='B'&&!horizontal?c.a:0,dx=grid.id==='B'&&horizontal?c.a:0;
      const segments=Array.from({length:grid.rows},(_,row)=>({
        label:`${grid.id} 第 ${row} 行 → Y 第 ${row+dy} 行`,
        pairs:Array.from({length:grid.cols},(_,col)=>({src:grid.cells[row*grid.cols+col],dst:(row+dy)*result.cols+col+dx}))
      }));
      addCommand(`${grid.id} → Y`,grid.id==='A'?'把 A 放到输出起点。':horizontal?'把 B 放到每行 A 的右边；目的行距包含 A 和 B。':'把 B 放到 A 的下方；从下一行开始写。',
        descriptor(0,0,[grid.cols*V,grid.rows,1],[result.cols*V,result.rows,1],[grid.cols*V,grid.rows,1],[0,0,0],[dx*V,dy,0]),segments,{source:grid.id});
    }
    result.explain=horizontal?'每个输入一条二维 copy。读端按自己的行距前进，写端按拼接后整行的行距前进。':'每个输入一条 copy。B 的目的行坐标从 A 的高度开始，A 和 B 的列数保持相同。';
  } else if(kind==='slice'){
    const A=source('A','原始矩阵 A',c.h,c.w); init(c.oh,c.ow);
    const makeSegment=(row,cols)=>({label:`源第 ${c.y+row*c.sy} 行 → 输出第 ${row} 行`,pairs:cols.map(col=>({src:A.cells[(c.y+row*c.sy)*c.w+c.x+col*c.sx],dst:row*c.ow+col}))});
    if(c.sx===1){
      const desc=c.sy===1?descriptor(0,0,[c.w*V,c.h,1],[c.ow*V,c.oh,1],[c.ow*V,c.oh,1],[c.x*V,c.y,0]):
        descriptor((c.y*c.w+c.x)*V*e,0,[c.sy*c.w*V,c.oh,1],[c.ow*V,c.oh,1],[c.ow*V,c.oh,1]);
      addCommand('A 的子块 → Y',c.sy===1?'修改源起点，保留原矩阵行距；输出紧密排列。':'源行距乘以取行步长，每次跳过不需要的行。这里重建了用于搬运的二维地址视图。',desc,
        Array.from({length:c.oh},(_,r)=>makeSegment(r,Array.from({length:c.ow},(_,i)=>i))),{source:'A'});
    }else{
      for(let col=0;col<c.ow;col++)addCommand(`取第 ${col} 个输出列段`,'列间有间隔，不能把中间不要的数据也搬走。固定一列，跨多行执行窄 copy。',
        descriptor((c.y*c.w+c.x+col*c.sx)*V*e,col*V*e,[c.sy*c.w*V,c.oh,1],[c.ow*V,c.oh,1],[V,c.oh,1]),
        Array.from({length:c.oh},(_,r)=>makeSegment(r,[col])),{source:'A'});
    }
    result.explain=c.sx===1?'这个子块可用一条二维 copy 表达。若要切出多个子块，就为每个输出重复生成描述符。':'隔列取数产生多个不连续的段。本方案每个输出列段一条 copy，不使用 gather/scatter。';
  } else {
    const {p:P,q:Q}=outputShape(c), K=c.r*c.s*V;
    result.p=P;result.q=Q;result.k=K;
    for(let n=0;n<c.n;n++)source(`X${n}`,`输入 X · batch ${n}`,c.h,c.w,n*c.h*c.w*V);
    if(!P||!Q){result.error='当前有效卷积核比含 padding 的输入还大，没有输出窗口。请缩小卷积核 / dilation，或增大输入 / padding。';return result;}
    init(c.n*P*Q,c.r*c.s);result.prezero=c.ph>0||c.pw>0;
    const at=(n,h,w)=>result.sources[n].cells[h*c.w+w];
    const pair=(n,p,q,r,s)=>{
      const h=p*c.sh-c.ph+r*c.dh,w=q*c.sw-c.pw+s*c.dw;
      if(h<0||h>=c.h||w<0||w>=c.w)return null;
      return {src:at(n,h,w),dst:((n*P+p)*Q+q)*c.r*c.s+r*c.s+s};
    };
    if(c.strategy==='kernel'){
      for(let n=0;n<c.n;n++)for(let r=0;r<c.r;r++)for(let s=0;s<c.s;s++){
        if(c.sh===1&&c.sw===1){
          const p0=Math.max(0,c.ph-r*c.dh),p1=Math.min(P,c.h+c.ph-r*c.dh);
          const q0=Math.max(0,c.pw-s*c.dw),q1=Math.min(Q,c.w+c.pw-s*c.dw);
          if(p1<=p0||q1<=q0)continue;
          const segments=[];
          for(let p=p0;p<p1;p++)for(let q=q0;q<q1;q++)segments.push({label:`窗口 (${p},${q}) 的核位置 (${r},${s})`,pairs:[pair(n,p,q,r,s)],n,p,q,r,s});
          addCommand(`核 (${r},${s})${c.n>1?' · N'+n:''}`,'固定核位置，把所有有效窗口的这一段通道成批写入输出。目的按 (K,Q,P) 看成三维，存储仍是二维展开矩阵。',
            descriptor(n*c.h*c.w*V*e,n*P*Q*K*e,[V,c.w,c.h],[K,Q,P],[V,q1-q0,p1-p0],[0,q0-c.pw+s*c.dw,p0-c.ph+r*c.dh],[(r*c.s+s)*V,q0,p0]),segments,{source:`X${n}`,r,s,n,method:'3D'});
        }else{
          for(let p=0;p<P;p++){
            const h=p*c.sh-c.ph+r*c.dh;
            if(h<0||h>=c.h)continue;
            const q0=Math.max(0,Math.ceil((c.pw-s*c.dw)/c.sw)),q1=Math.min(Q,Math.floor((c.w-1+c.pw-s*c.dw)/c.sw)+1);
            if(q1<=q0)continue;
            const w=q0*c.sw-c.pw+s*c.dw;
            const segments=[];
            for(let q=q0;q<q1;q++)segments.push({label:`窗口 (${p},${q}) 的核位置 (${r},${s})`,pairs:[pair(n,p,q,r,s)],n,p,q,r,s});
            addCommand(`核 (${r},${s}) · 输出行 ${p}${c.n>1?' · N'+n:''}`,'固定 n、p、r、s，让 q 连续变化。源行距=横向 stride×C；目的行距=K。跨输出行另发指令。',
              descriptor(((n*c.h+h)*c.w+w)*V*e,(((n*P+p)*Q+q0)*K+(r*c.s+s)*V)*e,[c.sw*V,q1-q0,1],[K,q1-q0,1],[V,q1-q0,1]),segments,{source:`X${n}`,r,s,n,method:'2D'});
          }
        }
      }
    } else if(c.strategy==='row') {
      // Group non-overlapping window-row segments into a strided 2D copy.
      // q residues ensure source pitch >= box0; padding/dilation split groups.
      for(let n=0;n<c.n;n++)for(let p=0;p<P;p++)for(let r=0;r<c.r;r++){
        const groups=new Map();
        for(let q=0;q<Q;q++){
          const valid=[];
          for(let s=0;s<c.s;s++){const v=pair(n,p,q,r,s);if(v)valid.push({s,pair:v});}
          if(!valid.length)continue;
          for(const chunk of c.dw===1?[valid]:valid.map(v=>[v])){
            const s=chunk[0].s,length=chunk.length,gap=Math.ceil(length/c.sw);
            const key=`${s}:${length}:${q%gap}`;
            if(!groups.has(key))groups.set(key,[]);
            groups.get(key).push({n,p,q,r,s,gap,pairs:chunk.map(v=>v.pair),label:`窗口 (${p},${q}) · 核行 ${r} 的连续 ${length} 格`});
          }
        }
        for(const group of groups.values()){
          const runs=[];
          for(const event of group){
            const last=runs.at(-1);
            if(last&&event.q-last.at(-1).q===event.gap)last.push(event);else runs.push([event]);
          }
          for(const segments of runs){
            const first=segments[0],length=first.pairs.length,src=first.pairs[0].src;
            const width=length*V,srcPitch=first.gap*c.sw*V,dstPitch=first.gap*K;
            addCommand(`核行 ${r} · 输出行 ${p} · q=${first.q}${segments.length>1?` 每隔 ${first.gap}`:''}${c.n>1?' · N'+n:''}`,
              `每段一起搬 ${length} 个相邻核位置。窗口按 q 的余数组合，源行距至少容纳整段；减少窄段，不承诺指令数最少。`,
              descriptor((src.value-1)*e,first.pairs[0].dst*V*e,[srcPitch,segments.length,1],[dstPitch,segments.length,1],[width,segments.length,1]),
              segments,{source:`X${n}`,n,p,r,s:first.s,method:'核行分组'});
          }
        }
      }
    } else {
      for(let n=0;n<c.n;n++)for(let p=0;p<P;p++)for(let q=0;q<Q;q++)for(let r=0;r<c.r;r++){
        const valid=[];
        for(let s=0;s<c.s;s++){const v=pair(n,p,q,r,s);if(v)valid.push({s,pair:v});}
        if(!valid.length)continue;
        const groups=c.dw===1?[valid]:valid.map(v=>[v]);
        for(const group of groups){
          const s=group[0].s,h=p*c.sh-c.ph+r*c.dh,w=q*c.sw-c.pw+s*c.dw,m=(n*P+p)*Q+q;
          addCommand(`窗口 ${m} · 核行 ${r}${c.dw!==1?' · 列'+s:''}`,'先装满一个输出窗口。核行内连续时一起搬；遇到 dilation 的列间空洞则再拆开。',
            descriptor(0,0,[c.w*V,c.n*c.h,1],[K,c.n*P*Q,1],[group.length*V,1,1],[w*V,n*c.h+h,0],[(r*c.s+s)*V,m,0]),
            [{label:`窗口 (${p},${q}) · 核行 ${r}`,pairs:group.map(v=>v.pair),n,p,q,r,s}],{source:`X${n}`,n,p,q,r,s,method:'窗口'});
        }
      }
    }
    result.zeroCount=result.output.filter(o=>!o.from).length;
    result.explain=c.strategy==='row'?'把相邻核位置合成较宽的段，再把互不重叠的窗口行组合成二维 copy。padding 边缘单独分组，横向 dilation 有空洞时拆成单格；逻辑搬运量保持不变。':c.strategy==='window'?'按窗口逐行搬，最贴近“截取一个窗口、排成一行”的直觉。同一源像素可被重复读取。':
      c.sh===1&&c.sw===1?'按核位置成批搬。步长为 1 时，有效窗口形成矩形，可以用三维 copy；padding 部分保持预置的零。':'步长大于 1：本方案降为二维 copy，并在输出行边界拆开，不假设硬件有独立的任意面距。';
  }
  result.payloadElements=result.events.reduce((n,event)=>n+event.pairs.length*V,0);
  result.outputElements=result.output.length*V;
  result.inputElements=result.sources.reduce((n,g)=>n+g.cells.length*V,0);
  result.rtlOK=result.commands.length>0&&result.commands.every(cmd=>cmd.rtl.ok);
  const uniqueIssues=new Map();
  for(const cmd of result.commands)for(const issue of cmd.rtl.issues)if(!uniqueIssues.has(issue.code))uniqueIssues.set(issue.code,issue.text);
  result.rtlIssues=[...uniqueIssues.values()];
  return result;
}
export function exactAddress(desc,side,x,y,z,bytes){
  const base=side==='src'?desc.srcBase:desc.dstBase;
  const g=side==='src'?desc.srcGlb:desc.dstGlb,s=side==='src'?desc.srcStart:desc.dstStart;
  return base+((z+s[2])*g[0]*g[1]+(y+s[1])*g[0]+x+s[0])*bytes;
}
export function materializeDescriptor(desc,bytes){
  const map=[];
  for(let z=0;z<desc.box[2];z++)for(let y=0;y<desc.box[1];y++)for(let x=0;x<desc.box[0];x++)
    map.push([exactAddress(desc,'src',x,y,z,bytes),exactAddress(desc,'dst',x,y,z,bytes)]);
  return map;
}
export function exportPlan(model){
  return {title:'TMA Copy Lab 教学描述符',referenceCommit:COMMIT,
    warning:'地址模型，不是机器码或 RTL 仿真；基地址为相应缓冲区内的字节偏移，需叠加实际且满足对齐的物理基地址。源目的不重叠。',
    units:'dim/start/box: elements, dim0 first; base offsets: bytes',
    kind:model.kind,parameters:model.c,mode:'CONV',srcLayout:'LINEAR',dstLayout:'LINEAR',
    precondition:model.prezero?'需要先由外部将输出清零。清零未计入下面的 copy 序列。':'无补零步骤',
    alignmentChecksPassed:model.rtlOK,
    commands:model.commands.map(({id,title,desc,rtl,source})=>({id,title,sourceBuffer:model.kind==='im2col'?'X':source,destinationBuffer:'Y',sourceView:source,...desc,rtl}))};
}
