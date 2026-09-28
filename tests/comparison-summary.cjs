const assert=require('node:assert/strict');

(async()=>{
  const {buildComparisonSummary,summaryMatrix,summaryTsv,summaryCsv,SUMMARY_HEADERS}=
    await import('../src/core/comparison-summary.mjs');
  const source={name:'=lecture,"photo.png',width:960,height:640,bitDepth:16,colorSpace:'unknown'};
  const measured=(bytes,extra={})=>({bytes,width:960,height:640,bitDepth:8,
    psnrRGB:31.245,alphaErrorPercent:0.5,precisionNote:'',...extra});
  const report={source,variants:[
    {cell:1,status:'ready',config:{format:'original',quality:100},metrics:measured(614400,{bitDepth:16,psnrRGB:'Infinity'})},
    {cell:2,status:'ready',config:{format:'jpeg',quality:85,jpegSubsampling:'420'},metrics:measured(48000)},
    {cell:3,status:'stale',config:{format:'png',quality:100},metrics:measured(1000)},
    {cell:4,status:'ready',config:{format:'png',formatMode:'palette',gifColors:16,gifDither:true,quality:100},
      metrics:measured(4096,{width:480,height:320,bitDepth:8,psnrRGB:null,alphaErrorPercent:null,
        precisionNote:'Палитра ограничена.'})}
  ]};
  const model=buildComparisonSummary(report);
  assert.deepEqual(model.rows.map(row=>row.cell),[1,2,4],'stale rows are absent');
  assert.equal(model.rows[0].quality,null,'original Q is not a codec quality');
  assert.equal(model.rows[1].quality,85);
  assert.equal(model.rows[2].quality,null,'palette PNG does not expose unrelated Q');
  assert.equal(model.rows[1].bpp,48000*8/(960*640));
  assert.equal(model.rows[2].bpp,4096*8/(480*320),'bpp uses result dimensions');
  assert.equal(model.rows[0].psnr,Infinity);
  assert.match(model.rows[2].note,/PSNR RGB недоступен/);
  assert.match(model.source.colorNote,/кодовые значения/);
  const matrix=summaryMatrix(model);
  assert.deepEqual(matrix[0],SUMMARY_HEADERS);
  assert.equal(matrix.length,4);
  assert.equal(matrix[1][11],'∞');
  assert.equal(matrix[3][7],'480×320');
  assert.match(summaryTsv(model),/^Исходник\t/);
  assert.match(summaryTsv(model),/'=lecture/,'spreadsheet formulas are escaped in copied rows');
  assert.match(summaryCsv(model),/^\ufeff"Исходник"/);
  assert.match(summaryCsv(model),/"'=lecture,""photo.png"/);
  assert.equal(buildComparisonSummary({...report,variants:report.variants.slice(0,2)}).rows.length,2);
  assert.equal(buildComparisonSummary(report,{iccProfile:true,nativePixelBuffer:{bitDepth:16}}).source.colorNote.includes('ICC'),true);
  assert.match(buildComparisonSummary({...report,source:{...source,colorSpace:'display-p3'}}).source.colorNote,/не подтверждено как sRGB/);
  assert.equal(buildComparisonSummary(report,{nativePixelBuffer:{sampleType:'float32'}}).source.depth,'float32');
  assert.throws(()=>buildComparisonSummary({source:{width:0,height:2}}),/исходника/);

  const getMap=new Map(),element=id=>{
    if(!getMap.has(id))getMap.set(id,{id,open:id==='studyDialog',textContent:'',disabled:false,
      children:[],replaceChildren(...nodes){this.children=nodes;},append(...nodes){this.children.push(...nodes);},
      setAttribute(){},focus(){},remove(){},style:{}});
    return getMap.get(id);
  };
  global.document={getElementById:element,createElement:tag=>({tag,children:[],
    append(...nodes){this.children.push(...nodes);},set textContent(value){this.text=value;},get textContent(){return this.text;}})};
  const writes=[],savedNavigator=Object.getOwnPropertyDescriptor(global,'navigator');
  Object.defineProperty(global,'navigator',{value:{clipboard:{writeText:async value=>writes.push(value)}},configurable:true});
  const app={source:{iccProfile:null,nativePixelBuffer:null},profiles:[]};
  let current=report,downloads=0;
  const {createStudy}=await import('../src/ui/study.mjs');
  const ui=createStudy({app,els:{}},{comparisonReport:()=>current,
    formatBytes:bytes=>`${bytes} B`,downloadBlob:(blob,name)=>{downloads++;assert.equal(name,'comparison-summary.csv');}});
  ui.updateStudySummary();
  assert.equal(element('comparisonSummaryRows').children.length,3);
  assert.equal(element('comparisonSummaryCopy').disabled,false);
  current={...report,variants:report.variants.map(v=>({...v,status:'stale'}))};
  ui.updateStudySummary();
  assert.equal(element('comparisonSummaryRows').children.length,0);
  assert.equal(element('comparisonSummaryCSV').disabled,true);
  await assert.rejects(ui.copyStudySummary(),/Нет готовых/);
  assert.throws(()=>ui.saveStudySummary(),/Нет готовых/);
  current=report;
  await ui.copyStudySummary();
  assert.equal(writes.length,1);
  ui.saveStudySummary();assert.equal(downloads,1);
  assert.equal(element('comparisonSummaryRows').children.length,0,'copy/export do not encode or mutate the displayed rows');
  current={...report,variants:report.variants.slice(0,2)};
  ui.updateStudySummary();assert.equal(element('comparisonSummaryRows').children.length,2,'2-cell layout uses only current report rows');
  app.source=null;
  current=null;
  ui.updateStudySummary();
  assert.equal(element('comparisonSummaryCSV').disabled,true);
  delete global.document;
  if(savedNavigator)Object.defineProperty(global,'navigator',savedNavigator);else delete global.navigator;
  console.log('PASS ready-only summary, bpp, modes, quality, precision, safe CSV/TSV, UI refresh and no encoding');
})().catch(error=>{console.error(error);process.exitCode=1;});
