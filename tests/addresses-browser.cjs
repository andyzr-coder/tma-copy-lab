const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const base=process.env.TEST_URL||'http://127.0.0.1:8766';
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--disable-gpu']});
  try{
    const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
    page.on('pageerror',e=>errors.push(String(e)));await fs.mkdir('.qa',{recursive:true});
    const state=()=>page.evaluate(()=>window.copyLab.getState());
    await page.goto(base+'/?op=copy',{waitUntil:'networkidle'});
    assert.equal((await state()).addresses.current.src.start,0x10000000);
    assert.equal((await state()).addresses.current.src.end,0x10000007);
    await page.locator('#next').click();assert.equal((await state()).addresses.current.src.start,0x10000008);
    assert.match(await page.locator('#readout').textContent(),/10000008/);
    await page.locator('#address-segments').locator('..').locator('summary').click();
    await page.locator('#address-segments [data-address-jump="2"]').click();assert.equal((await state()).step,2);
    await page.locator('#preset').selectOption('1');
    await page.locator('[data-destination="0"]').click();
    assert.match(await page.locator('#address-selection').textContent(),/不写入/);
    await page.locator('#addresses').screenshot({path:'.qa/addresses-copy-desktop.png'});
    await page.locator('#tab-concat').click();
    await page.locator('[data-address-command="1"] button').click();
    assert.equal((await state()).addresses.current.src.start,0x20000000);
    assert.equal((await state()).addresses.current.dst.start,0x30000006);
    assert.match(await page.locator('#address-coordinate-note').textContent(),/目的列额外加/);
    await page.locator('#tab-slice').click();
    assert.equal((await state()).addresses.current.src.start,0x10000000);
    assert.equal((await state()).addresses.current.src.end,0x10000003);
    assert.match(await page.locator('#address-current').textContent(),/跳过 12B/);
    await page.locator('#tab-im2col').click();
    await page.locator('#next').click();
    assert.equal((await state()).addresses.current.src.start,0x10000008);
    assert.equal((await state()).addresses.current.dst.start,0x30000004);
    assert.match(await page.locator('#address-coordinate-note').textContent(),/窗口/);
    await page.locator('#addresses').screenshot({path:'.qa/addresses-im2col-desktop.png'});
    await page.goto(base+'/?op=im2col&n=2&vec=128&perf_srcPage=3968&perf_dstPage=128',{waitUntil:'networkidle'});
    await page.locator('#lane').fill('127');await page.locator('#lane').dispatchEvent('input');
    await page.locator('[data-source="X1:0:0"]').click();
    assert.equal((await state()).addresses.selected.element.start,0x10000000+3968+4096+254);
    const downloadEvent=page.waitForEvent('download');await page.locator('#download-plan').click();
    await (await downloadEvent).saveAs('.qa/address-report.json');
    const report=JSON.parse(await fs.readFile('.qa/address-report.json','utf8'));
    assert.equal(report.addresses.bases.X,0x10000f80);assert.equal(report.addresses.segments.length,36);
    await page.reload({waitUntil:'networkidle'});assert.equal((await state()).addresses.buffers[0].base,0x10000f80);
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});
      for(const op of ['copy','concat','slice','im2col']){
        await page.locator('#tab-'+op).click();
        const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
        assert(size.scroll<=size.width+1,`${op} address page overflows at ${width}`);
        const overflow=await page.locator('.address-endpoint dd,.address-formulas pre').evaluateAll(ns=>ns.filter(n=>n.scrollWidth>n.clientWidth+1).map(n=>n.textContent));
        assert.deepEqual(overflow,[]);
      }
      await page.locator('#addresses').screenshot({path:`.qa/addresses-mobile-${width}.png`});
    }
    await page.goto(base+'/?op=im2col&r=3&s=3&ph=1&pw=1',{waitUntil:'networkidle'});
    await page.locator('[data-destination="0"]').click();
    assert.equal((await state()).addresses.selected.kind,'padding');
    assert.match(await page.locator('#address-selection').textContent(),/没有源地址/);
    assert.equal(await page.locator('#address-prezero').isVisible(),true);
    await page.goto(base+'/?op=im2col&h=2&w=2&r=2&s=2&dh=3&dw=3&ph=1&pw=1',{waitUntil:'networkidle'});
    assert.equal((await state()).addresses.current,null);
    assert.match(await page.locator('#address-prezero').textContent(),/30000007/);
    await page.goto(base+'/?op=im2col&h=2&w=2&r=3&s=3&dh=3&dw=3',{waitUntil:'networkidle'});
    assert.equal((await state()).addresses.current,null);
    assert.deepEqual(errors,[]);
    console.log('PASS: four operation address ranges, segment jumps, formulas, buffer switch, batch/channel offsets, export, padding and mobile layouts.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
