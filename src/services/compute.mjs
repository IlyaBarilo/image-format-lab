
import embeddedWorkerSource from "viewer:compute-worker";

// Dependencies are bound by application.mjs after all components are constructed.
export function createCompute({app}, deps) {
  let computeQueue = Promise.resolve();
  
  function workerCompute(kind,payload) {
    const task=computeQueue.catch(()=>{}).then(()=>new Promise((resolve,reject)=>{
      try {
        if(!app.computeWorker){const url=URL.createObjectURL(new Blob([embeddedWorkerSource],{type:"text/javascript"}));try{app.computeWorker=new Worker(url);}finally{URL.revokeObjectURL(url);}}
        const worker=app.computeWorker;
        const finish=(error,result)=>{clearTimeout(timer);worker.onmessage=worker.onerror=null;if(error){worker.terminate();app.computeWorker=null;reject(error);}else resolve(result);};
        const timer=setTimeout(()=>finish(new Error("Превышено время обработки изображения (120 секунд).")),120000);
        worker.onmessage=event=>finish(event.data.error?new Error(event.data.error):null,event.data.result);
        worker.onerror=()=>finish(new Error("Не удалось выполнить обработку в Worker. Перезагрузите страницу и повторите."));
        worker.postMessage({kind,payload});
      }catch(error){reject(error);}
    }));
    computeQueue=task.then(()=>undefined,()=>undefined);return task;
  }
  
  async function computeImage(format,config,source) {
    if(typeof Worker==="undefined") {
      deps.showStatus("Worker недоступен: обработка выполняется в основном потоке.");
      return format==="gif"?deps.encodeGif(config.gifColors,config.gifDither,source):deps.encodeBmp(format==="bmp32",config.matte,source);
    }
    return deps.workerCompute(format,{config,source:{width:source.width,height:source.height,hasAlpha:source.hasAlpha,imageData:source.imageData}});
  }
  
  async function measurePixels(a,b) {
    if(a.length>=4000000 && typeof Worker!=="undefined") return deps.workerCompute("metrics",{a,b});
    return {psnr:deps.computePsnr(a,b),alpha:deps.computeAlphaError(a,b)};
  }

  return { workerCompute, computeImage, measurePixels };
}
