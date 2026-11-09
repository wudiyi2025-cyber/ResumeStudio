export function splitParagraphs(input) {
  const text=String(input).replace(/\r\n?/g,'\n').trim();
  if(!text)return [];
  const marked=/^\s*(?:[•●▪◦·]|[-*]\s|\d+[.)]\s)/m.test(text);
  if(marked){
    const result=[];let current='';
    for(const line of text.split('\n')){
      if(/^\s*(?:[•●▪◦·]|[-*]\s|\d+[.)]\s)/.test(line)){
        if(current.trim())result.push(current.trim());
        current=line.replace(/^\s*(?:[•●▪◦·]|[-*]\s|\d+[.)]\s)\s*/, '');
      }else if(line.trim())current+=(current?' ':'')+line.trim();
    }
    if(current.trim())result.push(current.trim());
    return result;
  }
  return text.split(/\n\s*\n/).map(p=>p.replace(/\s*\n\s*/g,' ').trim()).filter(Boolean);
}
export function similarity(a,b){
  const normalize=s=>Array.from(s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu,''));
  const x=normalize(a),y=normalize(b);if(!x.length||!y.length)return 0;
  let prev=Array.from({length:y.length+1},(_,i)=>i);
  for(let i=1;i<=x.length;i++){
    const row=[i];for(let j=1;j<=y.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));prev=row;
  }
  return 1-prev[y.length]/Math.max(x.length,y.length);
}
