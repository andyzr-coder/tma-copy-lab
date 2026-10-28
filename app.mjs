import {build,defaults,presets,normalize,exportPlan,COMMIT} from './engine.mjs';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n).toLocaleString('en-US');
const tuple=a=>`(${a.join(', ')})`;
const hex=n=>`0x${n.toString(16).toUpperCase().padStart(4,'0')}`;
const ROWS_PER_PAGE=6;
const params=new URLSearchParams(location.search);
let kind=['concat','slice','im2col'].includes(params.get('op'))?params.get('op'):'concat';
const configs=structuredClone(defaults);
for(const k of Object.keys(configs[kind]))if(params.has(k))configs[kind][k]=params.get(k);
let model,step=0,lane=0,page=0,playing=false,timer=null,selection=null;
let currentPreset=-1;
const currentEvent=()=>model.events[Math.min(step,model.events.length-1)];
const currentCommand=()=>model.commands[currentEvent()?.command??0];
const config=()=>configs[kind];
const selectField=(key,label,values,help='')=>`<label class="field" for="cfg-${key}"><span>${label}</span><select id="cfg-${key}" data-param="${key}">${values.map(v=>{const [value,text]=Array.isArray(v)?v:[v,v];return `<option value="${value}" ${String(config()[key])===String(value)?'selected':''}>${text}</option>`}).join('')}</select>${help?`<small class="field-help">${help}</small>`:''}</label>`;
const numberField=(key,label,min,max,help='')=>`<label class="field" for="cfg-${key}"><span>${label}<small>${min}–${max}</small></span><input id="cfg-${key}" data-param="${key}" type="number" min="${min}" max="${max}" step="1" value="${config()[key]}">${help?`<small class="field-help">${help}</small>`:''}</label>`;
const pair=(a,b)=>`<div class="field-pair">${a}${b}</div>`;
function renderConfig(){
  const c=config();
  $('preset').innerHTML=(currentPreset<0?'<option value="-1">自定义参数</option>':'')+presets[kind].map(([name],i)=>`<option value="${i}" ${i===currentPreset?'selected':''}>${name}</option>`).join('');
  $('config-title').textContent={concat:'拼接参数',slice:'切片参数',im2col:'窗口参数'}[kind];
  if(kind==='concat'){
    $('config-fields').innerHTML=selectField('axis','沿哪个方向拼接？',[['col','左右拼接 · dim0'],['row','上下拼接 · dim1']])+numberField('common',c.axis==='col'?'两边共同的行数':'两边共同的列数',1,6)+pair(numberField('a',c.axis==='col'?'A 的列数':'A 的行数',1,6),numberField('b',c.axis==='col'?'B 的列数':'B 的行数',1,6));
    $('parameter-note').textContent='未拼接的方向必须一样长。这里共用一个参数，避免生成无法拼接的形状。所有坐标从 0 开始。';
  }else if(kind==='slice'){
    $('config-fields').innerHTML=pair(numberField('h','输入行数',2,7),numberField('w','输入列数',2,7))+pair(numberField('y','从第几行开始',0,c.h-1),numberField('x','从第几列开始',0,c.w-1))+pair(numberField('oh','输出行数',1,Math.floor((c.h-1-c.y)/c.sy)+1),numberField('ow','输出列数',1,Math.floor((c.w-1-c.x)/c.sx)+1))+pair(numberField('sy','取行步长',1,3),numberField('sx','取列步长',1,3));
    $('parameter-note').textContent='起点从 0 计数。步长 1 连续取，步长 2 隔一个取一个。起点或步长改变时，输出尺寸自动限制在有效范围内。';
  }else{
    $('config-fields').innerHTML=pair(numberField('h','输入高 H',2,7),numberField('w','输入宽 W',2,7))+pair(numberField('r','核高 R',1,3),numberField('s','核宽 S',1,3))+pair(numberField('sh','纵向 stride',1,3),numberField('sw','横向 stride',1,3))+pair(numberField('dh','纵向 dilation',1,3),numberField('dw','横向 dilation',1,3))+pair(numberField('ph','上下各 pad',0,2),numberField('pw','左右各 pad',0,2))+selectField('n','Batch N',[1,2]);
    $('parameter-note').textContent='先保持 stride=1、dilation=1、pad=0。dilation=1 表示没有空洞。每格是一个像素；C 个通道一起收在这一格。';
  }
  $('storage-fields').innerHTML=selectField('vec',kind==='im2col'?'每像素通道数 C':'每格连续元素数',[1,2,4,8,16,32,64,128])+selectField('bytes','元素宽度',[[1,'8bit · 1B'],[2,'16bit · 2B'],[4,'32bit · 4B']]);
  for(const input of document.querySelectorAll('[data-param]')) input.addEventListener('change',()=>{
    stop();const k=input.dataset.param;c[k]=input.tagName==='SELECT'&&k==='axis'?input.value:Number(input.value);currentPreset=-1;rebuild();
  });
}
function updateURL(){
  const url=new URL(location.href);url.search='';url.searchParams.set('op',kind);
  for(const [k,v] of Object.entries(config()))url.searchParams.set(k,v);
  history.replaceState(null,'',url);
}
function rebuild(){
  stop();configs[kind]=normalize(kind,configs[kind]);model=build(kind,configs[kind]);step=0;page=0;lane=0;selection=null;
  for(const tab of document.querySelectorAll('[data-mode]')){
    const active=tab.dataset.mode===kind;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',active);
  }
  $('experiment').setAttribute('aria-labelledby',`tab-${kind}`);
  renderConfig();renderIntro();renderFrame();updateURL();
}
function renderIntro(){
  const titles={concat:['CONCAT / 拼接','两个输入，分别写进一个输出','concat 的意思是拼接。A、B 各保持原来的顺序，写到输出中相邻的位置。输入数据不会做加法。'],slice:['SLICE / 切片','只取需要的部分，放到新矩阵里','slice 的意思是选取一部分。调整源起点、输出大小和取样步长，看看哪些数据被保留、哪些没有搬。'],im2col:['IM2COL / 窗口展开','一个窗口，成为输出的一行','在输入上滑动小窗口，把窗口中的数据按“核行 → 核列 → 通道”排成一行。只搬数据，还没有做卷积计算。']};
  const [k,title,description]=titles[kind];$('operation-kicker').textContent=k;$('operation-title').textContent=title;$('operation-description').textContent=description;
  $('strategy-control').hidden=kind!=='im2col';
  for(const button of document.querySelectorAll('[data-strategy]'))button.setAttribute('aria-pressed',button.dataset.strategy===config().strategy);
  $('empty-state').hidden=!model.error;$('empty-state').textContent=model.error||'';$('visual-workspace').hidden=!!model.error;
  const output=kind==='im2col'?`${model.rows} × ${model.k??0}`:`${model.rows} × ${model.cols*model.vector}`;
  $('shape-strip').innerHTML=`<span class="shape-item">copy 指令<b class="green">${model.commands.length}</b><small>条</small></span><span class="shape-item">输出形状<b>${output}</b><small>元素</small></span><span class="shape-item">有效搬运<b>${fmt((model.payloadElements||0)*model.bytes)}</b><small>B</small></span>`+(model.zeroCount?`<span class="shape-item">补零位置<b>${fmt(model.zeroCount*model.vector)}</b><small>元素</small></span>`:'');
  $('input-shape').textContent=kind==='im2col'?`N${config().n} · H${config().h} W${config().w} C${model.vector}`:`每格 ${model.vector} 个元素`;
  $('output-shape').textContent=kind==='im2col'?`${model.rows} 窗口 × ${model.cols} 核位置`:`${model.rows} 行 × ${model.cols} 格`;
  $('zero-legend').hidden=!model.prezero;
  $('window-legend').hidden=kind!=='im2col';
  $('lane-control').hidden=model.vector===1;$('lane').max=model.vector-1;$('lane').value=0;
  $('lane-caption').textContent=`实际每次搬整个 ${model.vector} 元素段，而非只搬显示的通道。`;
  const other=kind==='im2col'&&!model.error?build(kind,{...config(),strategy:config().strategy==='kernel'?'window':'kernel'}):null;
  $('learning-note').innerHTML=model.error?'':`<strong>观察重点：</strong>${model.explain}${other?`<br><strong>两种拆法对照：</strong>当前 ${model.commands.length} 条 copy；${config().strategy==='kernel'?'按窗口':'按核位置'}拆法 ${other.commands.length} 条。两者都搬 ${fmt(model.payloadElements*model.bytes)}B 有效数据；这里没有估算实际耗时。`:''}${model.prezero?'<br><strong>补零是前置步骤：</strong>假设输出已由外部清零，橙色格不会发起越界读取。清零工作量不包含在“有效搬运”中。':''}`;
}
function getSourceByte(src){return (kind==='im2col'?src.value-1:src.element)*model.bytes;}
function valueOf(src){return src.value+lane;}
function renderSources(activeKeys,commandKeys){
  const event=currentEvent(),c=config();
  $('source-grids').innerHTML=model.sources.map(grid=>{
    const colHeads=`<span class="matrix-axis">行\列</span>`+Array.from({length:grid.cols},(_,c)=>`<span class="matrix-axis">${c}</span>`).join('');
    const cells=Array.from({length:grid.rows},(_,r)=>`<span class="matrix-axis">${r}</span>`+grid.cells.slice(r*grid.cols,(r+1)*grid.cols).map(cell=>{
      const selected=selection?.type==='src'&&selection.key===cell.key;
      const h0=kind==='im2col'&&event?event.p*c.sh-c.ph:0,w0=kind==='im2col'&&event?event.q*c.sw-c.pw:0;
      const inWindow=kind==='im2col'&&event&&grid.id===`X${event.n}`&&cell.row>=h0&&cell.row<=h0+(c.r-1)*c.dh&&cell.col>=w0&&cell.col<=w0+(c.s-1)*c.dw;
      const gap=inWindow&&((cell.row-h0)%c.dh!==0||(cell.col-w0)%c.dw!==0);
      const cls=['data-cell',grid.id==='B'?'source-b':'',commandKeys.has(cell.key)?'command':'',inWindow?'window-cell':'',gap?'window-gap':'',activeKeys.has(cell.key)?'current':'',selected?'chosen':''].filter(Boolean).join(' ');
      return `<button type="button" class="${cls}" data-source="${cell.key}" aria-label="${grid.title} 第${r}行第${cell.col}列，通道${lane}，值${valueOf(cell)}" title="${grid.id}[${r},${cell.col}] · 值 ${valueOf(cell)} · 首元素 ${hex(getSourceByte(cell))}">${valueOf(cell)}</button>`;
    }).join('')).join('');
    return `<div class="source-grid-block"><div class="grid-caption"><span>${grid.title}</span><span>${grid.rows}×${grid.cols}${model.vector>1?` · 每格 ${model.vector} 元素`:''}</span></div><div class="matrix-scroll"><div class="data-matrix" style="--cols:${grid.cols}">${colHeads}${cells}</div></div></div>`;
  }).join('');
  $('source-grids').querySelectorAll('[data-source]').forEach(button=>button.onclick=()=>{stop();selection={type:'src',key:button.dataset.source};renderFrame(false);});
}
function renderOutput(activeDests,commandDests){
  const totalPages=Math.max(1,Math.ceil(model.rows/ROWS_PER_PAGE));page=Math.max(0,Math.min(totalPages-1,page));
  const first=page*ROWS_PER_PAGE,last=Math.min(model.rows,first+ROWS_PER_PAGE),preview=$('preview-result').checked;
  const head=`<span class="matrix-axis">${kind==='im2col'?'窗口':'行\\列'}</span>`+Array.from({length:model.cols},(_,col)=>`<span class="matrix-axis">${kind==='im2col'?`${Math.floor(col/config().s)},${col%config().s}`:col}</span>`).join('');
  let html=head;
  for(let row=first;row<last;row++){
    html+=`<span class="matrix-axis" title="输出第 ${row} 行">${row}</span>`;
    for(let col=0;col<model.cols;col++){
      const idx=row*model.cols+col,out=model.output[idx],done=out.from&&out.event<step,zero=!out.from&&model.prezero;
      const cls=['data-cell',done?'done':zero?'zero':'pending',preview?'preview':'',commandDests.has(idx)&&!done?'command':'',activeDests.has(idx)?'current':'',selection?.type==='dst'&&selection.index===idx?'chosen':''].filter(Boolean).join(' ');
      const val=zero?'0':done||preview?valueOf(out.from):model.prezero?'0':'·';
      const status=zero?'外部预置零':done?'已搬入':preview?'最终结果预览':'尚未搬入';
      html+=`<button type="button" class="${cls}" data-destination="${idx}" aria-label="输出第${row}行第${col}段，${status}，${val}" title="Y[${row},${col}] · ${status}">${val}</button>`;
    }
  }
  $('output-grid').innerHTML=`<div class="grid-caption"><span>${kind==='im2col'?'列标题 = 核位置 (r,s)；一格 = C 个通道':'输出 Y · 未搬入的格先留空'}</span></div><div class="matrix-scroll"><div class="data-matrix" style="--cols:${model.cols}">${html}</div></div>`;
  $('matrix-pages').innerHTML=`<button type="button" id="page-prev" aria-label="上一页输出" ${page===0?'disabled':''}>‹</button><span>第 ${first}–${last-1} 行 / 共 ${model.rows} 行</span><button type="button" id="page-next" aria-label="下一页输出" ${page===totalPages-1?'disabled':''}>›</button>`;
  $('page-prev').onclick=()=>{stop();$('follow-page').checked=false;page--;renderFrame(false);};
  $('page-next').onclick=()=>{stop();$('follow-page').checked=false;page++;renderFrame(false);};
  $('output-grid').querySelectorAll('[data-destination]').forEach(button=>button.onclick=()=>{stop();selection={type:'dst',index:+button.dataset.destination};renderFrame(false);});
}
function renderReadout(){
  const event=currentEvent(),cmd=currentCommand();
  if(!event){$('readout').innerHTML='<div><strong>没有有效输入段需要读取。</strong><small>若输出全部属于 padding，结果由外部预置零准备，无需 copy 输入数据。</small></div>';return;}
  if(selection){
    if(selection.type==='src'){
      const src=model.sources.flatMap(s=>s.cells).find(c=>c.key===selection.key);
      const reuse=model.output.filter(o=>o.from?.key===src.key).length;
      $('readout').innerHTML=`<div><strong>选中 ${src.source}[${src.row}, ${src.col}]</strong> · 通道 ${lane} 的值是 <code>${valueOf(src)}</code><small>这一整段的首元素字节偏移 ${hex(getSourceByte(src))}；出现在 ${reuse} 个输出位置。</small></div><span class="readout-byte">${model.vector*model.bytes} B / 格</span>`;
    }else{
      const out=model.output[selection.index];
      $('readout').innerHTML=`<div><strong>选中 Y 第 ${out.row} 行、第 ${out.col} 段</strong><small>${out.from?`来自 ${out.from.source}[${out.from.row}, ${out.from.col}]；由 COPY ${out.event!==undefined?model.events[out.event].command+1:'?'} 写入。`:'这里越界，保持外部预置的 0，不读取输入。'}</small></div><span class="readout-byte">${out.from&&out.event>=step?'待搬入':out.from?valueOf(out.from):'0'}</span>`;
    }
  }else if(step===model.events.length){
    $('readout').innerHTML=`<div><strong>搬运完成。所有有效输出位置都已写入。</strong><small>${model.commands.length} 条 copy · ${model.events.length} 个连续段${model.prezero?' · 越界部分保持预置零':''}。点击任意格查看它的来源。</small></div><span class="readout-byte">${fmt(model.payloadElements*model.bytes)} B</span>`;
  }else{
    const first=event.pairs[0],last=event.pairs.at(-1),out=model.output[first.dst];
    const srcStart=getSourceByte(first.src),dstStart=first.dst*model.vector*model.bytes;
    $('readout').innerHTML=`<div><strong>COPY ${cmd.id+1} / ${model.commands.length}</strong> · ${esc(event.label)}<small><code>${first.src.source}[${first.src.row},${first.src.col}${last.src.col!==first.src.col?'…'+last.src.col:''}] → Y[${out.row},${out.col}${event.pairs.length>1?'…'+model.output[last.dst].col:''}]</code><br>首元素偏移：源 ${hex(srcStart)} → 目的 ${hex(dstStart)}；${model.vector>1?'整段通道一起搬':'数值原样复制'}。</small></div><span class="readout-byte">${fmt(event.pairs.length*model.vector*model.bytes)} B</span>`;
  }
}
function renderCommands(){
  const cmd=currentCommand();
  if(!cmd){$('command-list').innerHTML='<p class="section-intro">没有有效 copy。</p>';$('command-detail').innerHTML='<p>调整参数后，这里会显示拆分指令。</p>';return;}
  if($('command-list').dataset.modelKey!==JSON.stringify(config())){
    $('command-list').innerHTML=model.commands.map(c=>`<button type="button" class="command-button" data-command="${c.id}" aria-pressed="${c.id===cmd.id}"><span>COPY ${String(c.id+1).padStart(2,'0')} <small>${c.count} 段</small></span>${esc(c.title)}</button>`).join('');
    $('command-list').dataset.modelKey=JSON.stringify(config());
    $('command-list').querySelectorAll('[data-command]').forEach(button=>button.onclick=()=>{stop();selection=null;step=model.commands[+button.dataset.command].first;renderFrame();});
  }
  for(const b of $('command-list').querySelectorAll('[data-command]'))b.setAttribute('aria-pressed',+b.dataset.command===cmd.id);
  const activeButton=$('command-list').querySelector(`[data-command="${cmd.id}"]`);
  if(playing&&activeButton){const box=activeButton.getBoundingClientRect(),list=$('command-list').getBoundingClientRect();if(box.top<list.top||box.bottom>list.bottom)$('command-list').scrollTop+=box.top-list.top-10;}
  const d=cmd.desc,E=model.bytes;
  const rows=[['base 偏移',`${hex(d.srcBase)} B`,`${hex(d.dstBase)} B`],['global',tuple(d.srcGlb),tuple(d.dstGlb)],['start',tuple(d.srcStart),tuple(d.dstStart)],['box',tuple(d.box),tuple(d.box)]];
  $('command-detail').innerHTML=`<h3>COPY ${cmd.id+1} · ${esc(cmd.title)}</h3><p>${esc(cmd.why)}</p><table class="descriptor-table"><thead><tr><th>字段</th><th>源 ${cmd.source}</th><th>目的 Y</th></tr></thead><tbody>${rows.map(([name,a,b])=>`<tr><td class="field-name">${name}</td><td><code>${a}</code></td><td><code>${b}</code></td></tr>`).join('')}</tbody></table><div class="command-pitches"><span>每行搬 <b>${fmt(d.box[0]*E)}B</b></span><span>源行距 <b>${fmt(d.srcGlb[0]*E)}B</b></span><span>目的行距 <b>${fmt(d.dstGlb[0]*E)}B</b></span>${d.box[2]>1?`<span>源面距 <b>${fmt(d.srcGlb[0]*d.srcGlb[1]*E)}B</b></span><span>目的面距 <b>${fmt(d.dstGlb[0]*d.dstGlb[1]*E)}B</b></span>`:''}</div><p class="descriptor-footnote">模式 CONV · 两侧 LINEAR · E=${E}B。global / start / box 按 (dim0,dim1,dim2) 书写，单位是元素。base 是相对缓冲区的字节偏移，需要叠加实际物理基地址。</p>`;
}
function renderRTL(){
  const box=$('rtl-result');box.classList.toggle('pass',!!model.rtlOK);
  if(model.error){box.innerHTML='<span class="rtl-icon">!</span><div><strong>当前没有可拆分的输出</strong><p>请先调整输入和卷积核尺寸。</p></div>';return;}
  const cmd=currentCommand();
  if(!cmd){box.innerHTML='<span class="rtl-icon">○</span><div><strong>没有有效输入段需要搬运</strong><p>输出中的零仍需由外部清零步骤准备。</p></div>';return;}
  if(model.rtlOK){
    box.innerHTML=`<span class="rtl-icon">✓</span><div><strong>当前 ${model.commands.length} 条描述符通过所列对齐与几何检查</strong><p>参考版本 ${COMMIT.slice(0,8)}。这不是 RTL 仿真或整机验证；还需有效物理地址、非重叠缓冲区与实际通道映射。${model.prezero?'输出清零依然是外部前置步骤。':''}</p></div>`;
  }else{
    const issues=cmd.rtl.issues.length?cmd.rtl.issues.map(i=>i.text):model.rtlIssues;
    box.innerHTML=`<span class="rtl-icon">!</span><div><strong>数学拆分成立，但当前参数不能原样下发这版 RTL</strong><p>${cmd.rtl.ok?'当前这条通过检查，但其他指令仍有以下问题：':`当前 COPY ${cmd.id+1} 的问题：`}</p><ul>${issues.map(t=>`<li>${esc(t)}</li>`).join('')}</ul><p>可选择“满足对齐的例子 / 对齐后，4 条 copy”进行对照。增加通道数改变了示例数据形状，并非自动修复任意真实输入。</p></div>`;
  }
}
function renderFrame(follow=true){
  const event=currentEvent(),cmd=currentCommand();
  if(follow&&$('follow-page').checked&&event)page=Math.floor(model.output[event.pairs[0].dst].row/ROWS_PER_PAGE);
  const activePairs=step<model.events.length?event?.pairs??[]:[];
  const cmdEvents=cmd?model.events.slice(cmd.first,cmd.first+cmd.count):[];
  renderSources(new Set(activePairs.map(p=>p.src.key)),new Set(cmdEvents.flatMap(e=>e.pairs.map(p=>p.src.key))));
  if(!model.error)renderOutput(new Set(activePairs.map(p=>p.dst)),new Set(cmdEvents.flatMap(e=>e.pairs.map(p=>p.dst))));
  renderReadout();renderCommands();renderRTL();
  $('progress').max=model.events.length||1;$('progress').value=step;
  $('progress-label').textContent=`已搬 ${step} / ${model.events.length} 段`;
  $('previous').disabled=step===0;$('next').disabled=step>=model.events.length;
  $('play').disabled=!model.events.length;$('play').textContent=playing?'Ⅱ 暂停':step===model.events.length?'↺ 重新播放':'▶ 播放搬运';
  $('lane-value').textContent=lane;$('download-plan').disabled=!!model.error;
}
function stop(){playing=false;clearTimeout(timer);timer=null;$('flight').classList.remove('flying');if(model)$('play').textContent=step===model.events.length?'↺ 重新播放':'▶ 播放搬运';}
function animate(){
  if(!playing)return;
  if(step>=model.events.length){stop();renderFrame();return;}
  selection=null;renderFrame();
  const event=currentEvent(),first=event.pairs[0],src=document.querySelector(`[data-source="${first.src.key}"]`),dst=document.querySelector(`[data-destination="${first.dst}"]`),flight=$('flight');
  const duration=+$('speed').value;
  flight.classList.remove('flying');
  if(src&&dst&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    const a=src.getBoundingClientRect(),b=dst.getBoundingClientRect(),area=$('visual-area').getBoundingClientRect();
    flight.textContent=event.pairs.length>1?`${event.pairs.length} 段 × ${model.vector}`:`${valueOf(first.src)}${model.vector>1?' …':''}`;
    flight.style.left=`${a.left+a.width/2-area.left-18}px`;flight.style.top=`${a.top+a.height/2-area.top-14}px`;
    flight.style.setProperty('--dx',`${b.left+b.width/2-a.left-a.width/2}px`);flight.style.setProperty('--dy',`${b.top+b.height/2-a.top-a.height/2}px`);flight.style.setProperty('--flight-duration',`${duration}ms`);
    void flight.offsetWidth;flight.classList.add('flying');
  }
  timer=setTimeout(()=>{step++;animate();},duration);
}
function chooseMode(next){kind=next;currentPreset=-1;rebuild();}
for(const button of document.querySelectorAll('[data-mode]'))button.onclick=()=>chooseMode(button.dataset.mode);
for(const button of document.querySelectorAll('[data-jump]'))button.onclick=()=>{chooseMode(button.dataset.jump);$('experiment').scrollIntoView({behavior:'smooth',block:'start'});};
for(const button of document.querySelectorAll('[data-strategy]'))button.onclick=()=>{config().strategy=button.dataset.strategy;currentPreset=-1;rebuild();};
$('preset').onchange=()=>{if(+$('preset').value<0)return;currentPreset=+$('preset').value;configs[kind]=structuredClone(presets[kind][currentPreset][1]);rebuild();};
$('reset-params').onclick=()=>{configs[kind]=structuredClone(defaults[kind]);currentPreset=0;rebuild();};
$('play').onclick=()=>{if(playing){stop();return;}if(step>=model.events.length)step=0;playing=true;animate();};
$('previous').onclick=()=>{stop();selection=null;step=Math.max(0,step-1);renderFrame();};
$('next').onclick=()=>{stop();selection=null;step=Math.min(model.events.length,step+1);renderFrame();};
$('restart').onclick=()=>{stop();selection=null;step=0;page=0;renderFrame();};
$('progress').oninput=()=>{stop();selection=null;step=+$('progress').value;renderFrame();};
$('speed').onchange=()=>{if(playing){clearTimeout(timer);animate();}};
$('preview-result').onchange=()=>renderFrame(false);
$('follow-page').onchange=()=>renderFrame();
$('lane').oninput=()=>{lane=+$('lane').value;renderFrame(false);};
$('download-plan').onclick=()=>{
  const blob=new Blob([JSON.stringify(exportPlan(model),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`${kind}-copy-plan.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
};
$('share').onclick=async()=>{
  try{await navigator.clipboard.writeText(location.href);$('share-status').textContent='已复制：链接包含当前算子和参数。';}
  catch{$('share-status').innerHTML=`可复制浏览器地址栏，或<a href="${esc(location.href)}">打开当前参数链接</a>。`;}
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
window.addEventListener('pagehide',stop);
rebuild();
// Public read-only state for reproducible browser checks, not a hardware interface.
window.copyLab={getState:()=>({kind,config:{...config()},step,playing,commands:model.commands.length,events:model.events.length,rtlOK:model.rtlOK,zeroCount:model.zeroCount,output:model.output.map(o=>({from:o.from?.value??0,event:o.event}))})};
