// Full-line means are calculated from every sample, before grouping for the plot.
export function profileMeanSummary(data, channel = 'rgb') {
  const names = ['R', 'G', 'B', 'α', 'Y′'];
  const indices = {rgb:[0,1,2],r:[0],g:[1],b:[2],alpha:[3],y:[4]}[channel] || [0,1,2];
  if (!data.means) return '';
  const values = indices.map(i => `${names[i]} ${data.means[i].toLocaleString('ru-RU', {maximumFractionDigits:3})}`).join(' · ');
  return `Среднее по линии: ${values} (уровни 0–${data.scaleMax || 255}).`;
}
