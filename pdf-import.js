import * as pdfjs from './vendor/pdfjs/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

export async function extractPdf(file, { language='en', onProgress=()=>{}, signal }={}) {
  const document = await pdfjs.getDocument({data:await file.arrayBuffer(),disableFontFace:true}).promise;
  let worker,usedOcr=false;
  try {
    if(document.numPages>20)throw new Error('Please upload a PDF of 20 pages or fewer.');
    const pages=[],projectHeaders=[];
    for(let i=1;i<=document.numPages;i++){
      const page=await document.getPage(i);
      const content=await page.getTextContent();
      const lines=[];
      for(const item of content.items){
        if(!('str' in item))continue;
        const y=item.transform[5];
        const line=lines.find(existing=>Math.abs(existing.y-y)<3);
        if(line)line.items.push({x:item.transform[4],text:item.str,font:item.fontName});
        else lines.push({y,items:[{x:item.transform[4],text:item.str,font:item.fontName}]});
      }
      const layout=lines.sort((a,b)=>b.y-a.y).map(line=>{line.items.sort((a,b)=>a.x-b.x);return {...line,text:line.items.map(item=>item.text).join(' ').replace(/\s+/g,' ').trim()};}).filter(line=>line.text);
      let projectLeft=null;
      for(let j=0;j<layout.length;j++){
        const line=layout[j],first=line.items.find(item=>item.text.trim());if(!first)continue;
        if(/^projects?(?:\s+experience)?\s*[:：]?$/i.test(line.text)){projectLeft=first.x;continue;}
        if(/^(?:education|(?:work|professional) experience|skills|certifications?|languages?|awards?|publications?)\s*[:：]?$/i.test(line.text)){projectLeft=null;continue;}
        if(projectLeft===null||/^\s*(?:[•●▪◦·‣⁃‧∙■◆►]|[-*–—])/.test(line.text)||Math.abs(first.x-projectLeft)>8||line.text.length>180)continue;
        const next=layout[j+1],bullet=next?.items.find(item=>/^[•●▪◦·‣⁃‧∙■◆►]$/.test(item.text.trim())),bulletText=next?.items.find(item=>item.text.trim()&&!/^[•●▪◦·‣⁃‧∙■◆►]$/.test(item.text.trim()));
        if(bullet&&bulletText&&first.font!==bulletText.font&&bullet.x>first.x+4)projectHeaders.push(line.text);
      }
      const text=layout.map(line=>line.text).join('\n');
      if(text.trim().length>=30){pages.push(text);continue;}
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      usedOcr=true;onProgress({stage:'loading',page:i,total:document.numPages});
      if(!worker){
        const {default:{createWorker}}=await import('./vendor/tesseract/tesseract.esm.min.js');
        worker=await createWorker(language==='zh'?'chi_sim+eng':'eng',1,{
          workerPath:new URL('./vendor/tesseract/worker.min.js',import.meta.url).href,
          corePath:new URL('./vendor/tesseract',import.meta.url).href,
          logger:message=>onProgress({stage:message.status,progress:message.progress,page:i,total:document.numPages})
        });
      }
      if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
      const viewport=page.getViewport({scale:2});
      const canvas=globalThis.document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      try {
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const result=await worker.recognize(canvas);
        if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
        if(!result.data.text.trim())throw new Error(`No text was recognized on page ${i}. Check the image quality.`);
        pages.push(result.data.text.trim());
      } finally {canvas.width=0;canvas.height=0;}
    }
    return {text:pages.join('\n'),usedOcr,projectHeaders};
  }finally{if(worker)await worker.terminate();await document.destroy();}
}
