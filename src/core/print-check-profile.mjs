// Own teaching rules for numerical CMYK checks. This is not an ICC profile.
export const DEFAULT_PRINT_CHECK_PROFILE = Object.freeze({
  schema:'image-format-lab.print-check',version:1,name:'Тестовый профиль · 300%',
  tacLimit:300,preserveKOnly:true
});

export function normalizePrintCheckProfile(value) {
  if(!value || typeof value!=='object' || Array.isArray(value) ||
     value.schema!==DEFAULT_PRINT_CHECK_PROFILE.schema || value.version!==1)
    throw new Error('Это не тестовый профиль проверки Image Format Lab.');
  const name=typeof value.name==='string'?value.name.trim():'';
  if(!name || name.length>80 || /[\x00-\x1f\x7f]/.test(name))
    throw new Error('Название тестового профиля должно содержать от 1 до 80 символов.');
  if(!Number.isInteger(value.tacLimit) || value.tacLimit<0 || value.tacLimit>400)
    throw new Error('Порог суммы красок должен быть целым числом от 0 до 400%.');
  if(typeof value.preserveKOnly!=='boolean')
    throw new Error('Укажите, требуется ли сохранять пиксели только с K.');
  return {schema:DEFAULT_PRINT_CHECK_PROFILE.schema,version:1,name,
    tacLimit:value.tacLimit,preserveKOnly:value.preserveKOnly};
}

export function parsePrintCheckProfile(text) {
  if(typeof text!=='string' || text.length>4096)throw new Error('Файл тестового профиля слишком велик.');
  let value;
  try { value=JSON.parse(text); }
  catch { throw new Error('Файл тестового профиля не содержит корректный JSON.'); }
  return normalizePrintCheckProfile(value);
}

export function printCheckProfileText(value) {
  return JSON.stringify(normalizePrintCheckProfile(value),null,2)+'\n';
}

export function evaluatePrintCheck(stats,profile) {
  const rules=normalizePrintCheckProfile(profile);
  const tacExceeded=stats.tacOverPixels>0;
  const kOnlyLost=rules.preserveKOnly&&stats.kOnly.lostPixels>0;
  return {passed:!tacExceeded&&!kOnlyLost,tacExceeded,kOnlyLost};
}
