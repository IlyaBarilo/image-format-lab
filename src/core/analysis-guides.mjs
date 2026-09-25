import { analysisRegionBounds } from './analysis-region.mjs';
import { profilePoints } from './line-profile.mjs';

// Guides use the same integer bounds and sample endpoints as the analyses.
export function analysisGuideGeometry(width,height,{scope,region=null,viewport=null,type,line}={}){
  if(type==='tradeoff')return null;
  const showRegion=scope==='region'&&region!=null;
  const showLine=type==='profile';
  if(!showRegion&&!showLine)return null;
  if((scope==='region'&&!region)||(scope==='viewport'&&showLine&&!viewport))return null;
  const bounds=analysisRegionBounds(width,height,scope==='region'?region:scope==='viewport'?viewport:null);
  return {region:showRegion?bounds:null,line:showLine?profilePoints(bounds,line):null};
}
