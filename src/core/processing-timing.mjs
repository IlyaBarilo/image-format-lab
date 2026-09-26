// Boundaries are measured with the same monotonic clock in the comparison flow.
export function processingStages({started,encodeStart,encodeEnd,decodeStart,decodeEnd,metricsStart,metricsEnd,finished}) {
  const points=[started,encodeStart,encodeEnd,decodeStart,decodeEnd,metricsStart,metricsEnd,finished];
  if(points.some(value=>!Number.isFinite(value))||points.some((value,index)=>index&&value<points[index-1]))
    throw new TypeError('Некорректные границы времени обработки.');
  const round=value=>Math.round(value*100)/100;
  return {
    totalMs:round(finished-started),
    beforeEncodeMs:round(encodeStart-started),
    encodeMs:round(encodeEnd-encodeStart),
    decodeMs:round(decodeEnd-decodeStart),
    metricsMs:round(metricsEnd-metricsStart),
    otherMs:round(decodeStart-encodeEnd+metricsStart-decodeEnd+finished-metricsEnd)
  };
}
