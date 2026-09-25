// Own versioned user preferences. Only explicit settings cross the storage boundary.
import { DEFAULT_VARIANTS } from './config.mjs';
import { validateComparison } from './settings.mjs';
import { DEFAULT_ANALYSIS_LINE } from './line-profile.mjs';

export const PREFERENCES_KEY = 'image-format-viewer.preferences.v1';
export const ANALYSIS_PREFERENCE_FIELDS = Object.freeze({
  type: ['analysisType', 'histogram', ['histogram','errorHistogram','waveform','parade','difference','vectorscope','profile','tradeoff']],
  channel: ['analysisChannel', 'rgb', ['rgb','r','g','b','alpha']],
  matte: ['analysisMatte', 'white', ['white','black']],
  level: ['analysisLevel', 128, [0,255]],
  differenceChannel: ['analysisDifferenceChannel', 'rgb', ['rgb','alpha']],
  gain: ['analysisGain', 4, [1,4,16,64]],
  profileChannel: ['analysisProfileChannel', 'rgb', ['rgb','r','g','b','alpha','y']],
  position: ['analysisPosition', 500, [0,1000]]
});
export function defaultPreferences() {
  return { version:1,
    comparison:{layout:2,background:'checker',autoApply:true,metadataPolicy:'panorama',variants:DEFAULT_VARIANTS.map(v=>({...v}))},
    filesVisible:true,
    pixelGrid:false,
    panels:{size:'compact',previous:'compact',ratio:null,collapsed:false,lastManual:null},
    analysis:{...Object.fromEntries(Object.entries(ANALYSIS_PREFERENCE_FIELDS).map(([key,[,value]])=>[key,value])),
       displays:{histogram:'overlay',errorHistogram:'overlay',waveform:'separate',parade:'separate',vectorscope:'separate',profile:'overlay'},
      pair:[1,2],metric:'psnrRGB',scope:'viewport',region:null,line:{...DEFAULT_ANALYSIS_LINE}}
  };
}
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const ratio = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
function geometry(value, area) {
  if(!record(value)||!['x0','y0','x1','y1'].every(k=>Number.isInteger(value[k])&&value[k]>=0&&value[k]<=1000))return null;
  if(area&&(value.x0>=value.x1||value.y0>=value.y1))return null;
  return Object.fromEntries(['x0','y0','x1','y1'].map(k=>[k,value[k]]));
}
export function normalizePreferences(value) {
  const result=defaultPreferences();
  if(!record(value)||value.version!==1)return result;
  try { result.comparison=validateComparison(value.comparison); } catch { /* Keep the default comparison. */ }
  if(typeof value.filesVisible==='boolean')result.filesVisible=value.filesVisible;
  if(typeof value.pixelGrid==='boolean')result.pixelGrid=value.pixelGrid;
  const p=value.panels;
  if(record(p)){
    if(['compact','balance','max'].includes(p.size))result.panels.size=p.size;
    if(['compact','balance'].includes(p.previous))result.panels.previous=p.previous;
    if(ratio(p.ratio))result.panels.ratio=p.ratio;
    if(typeof p.collapsed==='boolean')result.panels.collapsed=p.collapsed;
    if(record(p.lastManual)&&['compact','balance'].includes(p.lastManual.size)&&ratio(p.lastManual.ratio))result.panels.lastManual={size:p.lastManual.size,ratio:p.lastManual.ratio};
  }
  const a=value.analysis;
  if(record(a)){
    for(const [key,[,fallback,allowed]] of Object.entries(ANALYSIS_PREFERENCE_FIELDS)){
      if((key==='level'||key==='position')?Number.isInteger(a[key])&&a[key]>=allowed[0]&&a[key]<=allowed[1]:typeof a[key]===typeof fallback&&allowed.includes(a[key]))result.analysis[key]=a[key];
    }
    for(const type of Object.keys(result.analysis.displays)){
       const modes=['vectorscope','errorHistogram'].includes(type)?['separate','overlay']:['separate','overlay','delta'];
      if(record(a.displays)&&modes.includes(a.displays[type]))result.analysis.displays[type]=a.displays[type];
    }
    if(Array.isArray(a.pair)&&a.pair.length===2&&a.pair.every(n=>Number.isInteger(n)&&n>=1&&n<=result.comparison.layout)&&a.pair[0]<a.pair[1])result.analysis.pair=[...a.pair];
    if(['psnrRGB','alphaErrorPercent','processingMs'].includes(a.metric))result.analysis.metric=a.metric;
    result.analysis.region=geometry(a.region,true);
    result.analysis.line=geometry(a.line,false)||result.analysis.line;
    if(['full','viewport'].includes(a.scope)||(a.scope==='region'&&result.analysis.region))result.analysis.scope=a.scope;
  }
  return result;
}
