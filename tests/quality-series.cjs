const assert=require('node:assert/strict');
(async()=>{
  const {SERIES_QUALITIES,SERIES_FORMATS,seriesBudgetBytes,summarizeQualitySeries,runSeriesProbes,qualitySeriesReport}=await import('../src/core/quality-series.mjs');
  assert.deepEqual(SERIES_QUALITIES,[30,45,60,75,90]);
  assert.equal(SERIES_FORMATS.length,5);
  assert.equal(seriesBudgetBytes('12,5'),12500);
  for(const value of ['','0','1.234','-2','100001','Infinity','2e4'])assert.throws(()=>seriesBudgetBytes(value),/бюджет/);
  const points=[
    {id:'a',order:0,status:'ready',bytes:8000,psnrRGB:28},
    {id:'b',order:1,status:'ready',bytes:9000,psnrRGB:27},
    {id:'c',order:2,status:'ready',bytes:10000,psnrRGB:30},
    {id:'d',order:3,status:'ready',bytes:12000,psnrRGB:30},
    {id:'e',order:4,status:'ready',bytes:11000,psnrRGB:Infinity},
    {id:'f',order:5,status:'error',bytes:1000,psnrRGB:50}
  ];
  const summary=summarizeQualitySeries(points,10500);
  assert.deepEqual([...summary.frontier],['a','c','e']);
  assert.equal(summary.best.id,'c');
  assert.equal(summarizeQualitySeries(points,11500).best.id,'e');
  assert.equal(summarizeQualitySeries(points,7000).best,null);
  assert.equal(summary.readyCount,5);
  const ties=[{id:'x',order:0,status:'ready',bytes:120,psnrRGB:30},{id:'y',order:1,status:'ready',bytes:100,psnrRGB:30}];
  assert.equal(summarizeQualitySeries(ties,200).best.id,'y');
  assert.deepEqual([...summarizeQualitySeries(ties,200).frontier],['y']);
  assert.throws(()=>summarizeQualitySeries(points,0),/бюджет/);
  const calls=[],published=[];
  const complete=await runSeriesProbes(['jpeg','webp'],async(format,quality)=>{calls.push(`${format}:${quality}`);return {bytes:quality*100,psnrRGB:quality/2};},()=>true,point=>published.push(point.id));
  assert.equal(complete.points.length,10);assert.equal(published.length,10);
  assert.deepEqual(calls.slice(0,3),['jpeg:30','jpeg:45','jpeg:60']);
  let current=true,release;
  const waiting=runSeriesProbes(['jpeg','webp'],async()=>{await new Promise(resolve=>{release=resolve;});return {bytes:10,psnrRGB:20};},()=>current,()=>assert.fail('cancelled result must not publish'));
  await Promise.resolve();current=false;release();
  assert.deepEqual(await waiting,{points:[],cancelled:true});
  const partial=await runSeriesProbes(['jpeg','webp'],async(format,quality)=>{if(quality===45)throw new Error('кодек недоступен');return {bytes:quality,psnrRGB:quality};},()=>true,()=>{});
  assert.equal(partial.points.length,10);assert.equal(partial.points[1].status,'error');
  assert.equal(partial.points[2].status,'ready');
  await assert.rejects(runSeriesProbes(['jpeg','jpeg'],()=>{},()=>true,()=>{}),/два разных/);
  const sha='a'.repeat(64),run={formats:['jpeg','webp'],points:complete.points,createdAt:new Date(0).toISOString(),
    input:{name:'source.png',bytes:123,mimeType:'image/png',bitDepth:8},width:10,height:10,running:false,stopReason:''};
  const report=qualitySeriesReport(run,10000,sha,'test browser');
  assert.equal(report.progress.state,'complete');assert.equal(report.progress.partial,false);
  assert.equal(report.points.length,10);assert.equal(report.points.filter(p=>p.bestUnderBudget).length,1);
  assert.equal(report.input.sha256,sha);assert.equal(report.conditions.budgetBytes,10000);
  assert.equal(JSON.parse(JSON.stringify(report)).points.length,10);
  const stopped=qualitySeriesReport({...run,points:partial.points.slice(0,3),stopReason:'Остановлено'},1,sha);
  assert.equal(stopped.progress.state,'stopped');assert.equal(stopped.progress.partial,true);
  assert.equal(stopped.progress.attempted,3);assert.equal(stopped.progress.errors,1);
  assert.equal(stopped.points[1].error,'кодек недоступен');
  assert.equal(stopped.result.bestUnderBudget,null);
  const exact=qualitySeriesReport({...run,points:[{id:'exact',order:0,format:'jpeg',quality:90,status:'ready',bytes:100,bpp:8,psnrRGB:Infinity,alphaErrorPercent:0}]},1000,sha);
  assert.equal(exact.points[0].psnrRGB,'Infinity');
  assert.throws(()=>qualitySeriesReport(run,10000,'invalid'),/Недостаточно/);
  console.log('PASS quality-series budget, measured winner, Pareto frontier, ties and invalid points');
})().catch(error=>{console.error(error);process.exitCode=1;});
