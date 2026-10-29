const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const base=process.env.TEST_URL||'http://127.0.0.1:8766';
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--disable-gpu']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
    page.on('pageerror',e=>errors.push(String(e)));await fs.mkdir('.qa',{recursive:true});
    const state=()=>page.evaluate(()=>window.copyLab.getState());
    await page.goto(base+'/?op=slice&sx=2&sy=2',{waitUntil:'networkidle'});
    let s=await state();assert.equal(s.commands,8);assert.equal(s.events,16);
    assert.equal(await page.locator('.slice-card').count(),4);
    assert.match(await page.locator('#slice-facts').textContent(),/源 16B；目的 4B/);
    assert.equal(s.addresses.buffers.length,2);
    await page.locator('#next').click();await page.locator('#next').click();
    s=await state();assert.deepEqual(s.output.filter(o=>o.event<s.step).map(o=>o.from),[1,2,9,10]);
    assert.equal(s.addresses.current.src.start,0x10000004);assert.equal(s.addresses.current.dst.start,0x30000008);
    await page.locator('#cfg-order').selectOption('210');
    assert.deepEqual((await state()).sliceTiles[1].origin,[0,0,2]);
    await page.locator('#preview-result').check();
    await page.locator('#visual-area').screenshot({path:'.qa/corrected-slice-2d.png'});
    await page.locator('#preset').selectOption('2');
    assert.equal((await state()).commands,16);
    await page.locator('#visual-area').screenshot({path:'.qa/corrected-slice-3d.png'});
    const permalink=page.url();await page.reload({waitUntil:'networkidle'});
    assert.equal(page.url(),permalink);assert.equal((await state()).config.depth,4);
    await page.locator('[data-command="15"]').click();
    assert.match(await page.locator('#matrix-pages').textContent(),/13–16/);
    await page.setViewportSize({width:320,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.locator('#visual-area').screenshot({path:'.qa/corrected-slice-320.png'});
    await page.setViewportSize({width:1440,height:1100});
    // Even the user's old kernel URL now opens with row-complete writes.
    await page.goto(base+'/?op=im2col&strategy=kernel&n=1&h=4&w=4&vec=1&r=2&s=2',{waitUntil:'networkidle'});
    s=await state();assert.equal(s.config.strategy,'window');assert.equal(s.commands,18);
    await page.locator('#next').click();await page.locator('#next').click();
    s=await state();assert.deepEqual(s.output.filter(o=>o.event<s.step).map(o=>o.from),[1,2,5,6]);
    assert(s.output.slice(4).every(o=>o.event>=s.step));
    await page.locator('#visual-area').screenshot({path:'.qa/corrected-im2col-row.png'});
    await page.locator('#speed').selectOption('350');await page.locator('#play').click();
    await page.waitForTimeout(800);await page.locator('#play').click();assert((await state()).step>=3);
    await page.locator('[data-strategy="kernel"]').click();assert.match(await page.locator('#order-note').textContent(),/写入时间顺序改变/);
    await page.reload({waitUntil:'networkidle'});assert.equal((await state()).config.strategy,'kernel');
    assert.deepEqual(errors,[]);console.log('PASS: uniform multi-block slice, 3D, traversal, paging, row-complete im2col, legacy migration, animation and sharing.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
