import {selectedAddresses,coordinateCalculation} from './addresses.mjs';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hex=n=>`0x${n.toString(16).toUpperCase().padStart(8,'0')}`;
const interval=r=>`${hex(r.start)} → ${hex(r.end)}`;
const signed=n=>`${n>=0?'+':'−'}${Math.abs(n)}B`;
const commandRange=r=>`${hex(r.first)}<br>→ ${hex(r.last)}<small>${r.contiguous?'连续访问':'分段访问，中间有跳转'} · 有效 ${r.payload}B</small>`;

export function renderAddressView({model,trace,step,selection,lane,onJump}){
  if(!trace)return;
  const key=JSON.stringify([model.kind,model.c,trace.bases]);
  if($('address-overview').dataset.key!==key){
    $('address-overview').dataset.key=key;
    $('address-buffers').innerHTML=trace.buffers.map(b=>`<div><b>${b.id} 缓冲区</b><code>${hex(b.base)}</code><span>${b.bytes}B 空间${b.end===null?'，没有数据':`，最后一字节 ${hex(b.end)}`}</span></div>`).join('');
    $('address-overview').innerHTML=trace.commands.length?`<div class="matrix-scroll address-table-wrap"><table class="address-table"><caption>本功能的全部 COPY：分别列出源和目的的首段起点、末段末字节。分段访问不代表中间每个地址都被搬运。</caption><thead><tr><th>COPY</th><th>源缓冲区</th><th>读取：从哪里开始，到哪里结束</th><th>写入 Y：从哪里开始，到哪里结束</th><th>段数</th></tr></thead><tbody>${trace.commands.map(c=>`<tr data-address-command="${c.id}"><th><button type="button" data-address-jump="${c.first}">COPY ${c.id+1} ↗</button></th><td>${c.sourceBuffer}</td><td>${commandRange(c.src)}</td><td>${commandRange(c.dst)}</td><td>${c.count}</td></tr>`).join('')}</tbody></table></div>`:'<p class="address-muted">当前没有 COPY 地址序列。</p>';
    bindJumps($('address-overview'),onJump);
  }
  $('address-validity').textContent=model.error?'当前没有输出窗口，因此没有数据搬运地址。':model.rtlOK?'以下是有效数据的示例字节地址，末地址包含在范围内；不包括总线拍取整后的额外访问范围。':'以下仍显示目标数据的数学地址。当前没有通过全部静态检查的 COPY 序列，不能把这些范围当作 RTL 实际总线访问范围。';
  $('address-prezero').hidden=!trace.prezero;
  if(trace.prezero)$('address-prezero').innerHTML=`<strong>外部预清零：</strong>输出 Y 的 ${interval(trace.prezero)}，共 ${trace.prezero.length}B。padding 格没有源地址；它们依靠这个独立清零步骤准备，不发起越界读取。`;

  const index=Math.min(step,trace.segments.length-1),segment=trace.segments[index],event=model.events[index],cmd=segment?model.commands[segment.command]:null;
  const complete=step>=trace.segments.length;
  $('address-current-title').textContent=segment?`${complete?'最后一段（已完成）':'当前段'} · COPY ${segment.command+1} · 段 ${index+1}/${trace.segments.length}`:'当前没有有效数据段';
  if(segment){
    const next=trace.segments[index+1];
    const endpoint=(label,side,buffer)=>{
      const r=segment[side],nextRange=next?.[side],sameBuffer=side==='dst'||!next||next.sourceBuffer===buffer;
      const advance=!next?'已经是整个序列的最后一段。':!sameBuffer?`下一段切换到 ${next.sourceBuffer}：${hex(nextRange.start)}。两个缓冲区不连续。`:`下一段起点 ${hex(nextRange.start)}；相对本段起点 ${signed(nextRange.start-r.start)}。${nextRange.start===r.end+1?'紧接本段末尾。':nextRange.start>r.end+1?`中间跳过 ${nextRange.start-r.end-1}B。`:(nextRange.start<r.start?'回到较早的地址。':'与本段的地址范围重叠。')+(side==='src'?'重复读取不代表自动缓存复用。':'写入顺序不一定按地址递增。')}`;
      return `<article class="address-endpoint"><span>${label} · ${buffer}</span><dl><div><dt>开始字节</dt><dd>${hex(r.start)}</dd></div><div><dt>结束字节（含）</dt><dd>${hex(r.end)}</dd></div></dl><p>缓冲区内偏移 <code>${r.offset} → ${r.offset+r.length-1}</code> B，共 <strong>${r.length}B</strong>。</p><small>${advance}</small></article>`;
    };
    $('address-current').innerHTML=endpoint('从这里读','src',segment.sourceBuffer)+endpoint('写到这里','dst','Y');
    const calc=coordinateCalculation(model,index);
    $('address-coordinate-note').textContent=calc.meaning;
    const formula=(label,text,offset,base)=>`<article><h4>${label}：先算偏移，再加基址</h4><pre>${esc(text)}\n= ${offset} B（缓冲区内偏移）\n${hex(base)} + ${offset} = ${hex(base+offset)}</pre></article>`;
    $('address-formulas').innerHTML=formula('源',calc.source,calc.sourceOffset,trace.bases[segment.sourceBuffer])+formula('目的',calc.destination,calc.destinationOffset,trace.bases.Y);
    const d=cmd.desc,E=model.bytes;
    const descriptor=(side,base)=>{
      const g=side==='src'?d.srcGlb:d.dstGlb,s=side==='src'?d.srcStart:d.dstStart,b=side==='src'?d.srcBase:d.dstBase;
      return `${side==='src'?'源':'目的'} = 缓冲区基址 + 描述符 base 偏移 + E × [ start0 + (start1+y)×glb0 + (start2+z)×glb0×glb1 ]\n= ${hex(base)} + ${b} + ${E} × [ ${s[0]} + (${s[1]}+${segment.y})×${g[0]} + (${s[2]}+${segment.z})×${g[0]}×${g[1]} ]\n= ${hex(side==='src'?segment.src.start:segment.dst.start)}`;
    };
    $('address-descriptor-formula').textContent=`本段对应描述符局部坐标 x=0, y=${segment.y}, z=${segment.z}。\n\n${descriptor('src',trace.bases[segment.sourceBuffer])}\n\n${descriptor('dst',trace.bases.Y)}\n\n每段字节数 = box0 × E = ${d.box[0]} × ${E} = ${segment.bytes}B\n末字节地址 = 本段起点 + ${segment.bytes} − 1`;
    const segmentKey=key+':'+cmd.id;
    if($('address-segments').dataset.key!==segmentKey){
      $('address-segments').dataset.key=segmentKey;
      const rows=trace.segments.slice(cmd.first,cmd.first+cmd.count);
      $('address-segments').innerHTML=`<div class="matrix-scroll address-table-wrap address-segment-scroll"><table class="address-table"><caption>COPY ${cmd.id+1} 的每一个逻辑连续段，按动画顺序列出。点击段号可跳转。</caption><thead><tr><th>段</th><th>源 ${segment.sourceBuffer}：首字节 → 末字节</th><th>目的 Y：首字节 → 末字节</th><th>长度</th></tr></thead><tbody>${rows.map(r=>`<tr data-address-segment="${r.index}"><th><button type="button" data-address-jump="${r.index}">${r.index+1} ↗</button></th><td>${interval(r.src)}</td><td>${interval(r.dst)}</td><td>${r.bytes}B</td></tr>`).join('')}</tbody></table></div>`;
      bindJumps($('address-segments'),onJump);
    }
  }else{
    $('address-current').innerHTML='<p class="address-muted">没有读取输入或 COPY 写入的地址。若存在 padding，请看独立的外部预清零范围。</p>';
    $('address-coordinate-note').textContent='';$('address-formulas').innerHTML='';$('address-descriptor-formula').textContent='当前没有 COPY 描述符。';$('address-segments').innerHTML='';delete $('address-segments').dataset.key;
  }
  for(const row of document.querySelectorAll('[data-address-command]'))row.classList.toggle('address-active',!!segment&&+row.dataset.addressCommand===segment.command);
  for(const row of document.querySelectorAll('[data-address-segment]'))row.classList.toggle('address-active',!!segment&&+row.dataset.addressSegment===segment.index);
  const picked=selectedAddresses(model,trace,selection,lane);
  $('address-selection').hidden=!picked;
  if(picked){
    const note=picked.kind==='padding'?'这里是 padding，没有源地址；由外部预清零准备。':picked.kind==='untouched'?'这里不属于搬运范围，不写入，原值保持不变。':picked.kind==='source'?'这是输入数据本身的地址；同一源格可能被多个输出位置重复使用。':`该元素来自 ${picked.sourceBuffer} 的 ${interval(picked.sourceElement)}。`;
    $('address-selection').innerHTML=`<strong>选中 ${esc(picked.label)} · 通道 ${picked.lane}</strong><p>当前显示元素：<code>${interval(picked.element)}</code>，${picked.element.length}B。<br>整格连续数据：<code>${interval(picked.cell)}</code>，${picked.cell.length}B。</p><p>${note}</p>`;
  }
}
function bindJumps(container,onJump){for(const button of container.querySelectorAll('[data-address-jump]'))button.onclick=()=>onJump(+button.dataset.addressJump);}
