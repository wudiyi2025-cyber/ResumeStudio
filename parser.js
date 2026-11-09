// Deterministic extraction for the role / dates / company / bullet layout in the supplied resumes.
// Nothing in an uploaded document is executed or treated as an instruction.
const month = '(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?)';
const dateAtom = `(?:${month}\\s*\\d{4}|\\d{4}[年./-]\\d{1,2}月?|(?:19|20)\\d{2}(?![\\d.\\p{L}]))`;
const datePattern = new RegExp(`\\b${dateAtom}(?:\\s*[-–—~至到]\\s*(?:${dateAtom}|Present|Now|Current|至今))?`, 'iu');
const bulletPattern = /^\s*(?:[•●▪◦·‣⁃‧∙■◆►]|[-*–—]|\d+[.)、]\s*)\s*/;
const workHeading = /^(?:work(?:ing)? experience|professional experience|employment(?: history)?|experience|工作经历|实习经历|项目经历)\s*$/i;
const endHeading = /^(?:certificate\w*\s*(?:&|and)?\s*(?:language|lauguage)?|certifications?(?:\s*(?:&|and)\s*languages?)?|skills(?:\s*&.*)?|languages?|education|教育(?:经历|背景)|证书.*|技能.*|语言.*)\s*$/i;
const rolePattern = /counsel|specialist|paralegal|intern|clerk|manager|director|engineer|analyst|assistant|associate|officer|lead|consultant|cleaning|cleaner|waitress|waiter|front\s*desk|part[ -]?time|法务|律师|实习|经理|专员|助理|工程师|分析师|兼职/i;
const companyPattern = /co\.,?|ltd\.?|inc\.?|firm|university|company|corp|公司|事务所|集团|大学/i;
const actionPattern = /^(?:independently\s+)?(?:draft(?:ed)?|review(?:ed)?|revis(?:e|ed)|negotiat(?:e|ed)|develop(?:ed)?|built|build|lead|led|research(?:ed)?|support(?:ed)?|coordinat(?:e|ed)|conduct(?:ed)?|provid(?:e|ed)|structur(?:e|ed)|prepar(?:e|ed)|manag(?:e|ed)|monitor(?:ed)?|evaluat(?:e|ed)|assist(?:ed)?|liais(?:e|ed)|contribut(?:e|ed)|assess(?:ed)?|implement(?:ed)?|advis(?:e|ed)|represent(?:ed)?|clean(?:ed)?|saniti[sz](?:e|ed)|restock(?:ed)?|welcom(?:e|ed)|work(?:ed)?|greet(?:ed)?|respond(?:ed)?|responsible\s+for|负责|参与|独立|开展|起草|审核|协助|组织|建立|推动|处理|完成|提供|管理|协调|研究|制定|分析|撰写)/i;
const educationHeading = /^(?:education(?:al background)?|教育(?:经历|背景)?)\s*[:：]?$/i;
const extraSectionHeading = /^(?:internship(?: experience)?|internships|实习经历|实习经验|project(?: experience|s)?|项目经历|volunteer(?: experience|ing)?|志愿(?:者)?经历|extracurricular(?: activities| experience)?|课外活动)\s*[:：]?$/i;
const schoolPattern = /university|college|institute|school|academy|大学|学院|学校/i;
const degreePattern = /master|bachelor|doctor|ph\.?d|ll\.?m|ll\.?b|degree|diploma|硕士|本科|博士|学士|法学|专业/i;
const textSectionHeading = /^(?:extra[ -]?curricular(?: activities| experience)?|skills\s+(?:and|&)\s+awards|professional summary|summary|profile|objective|career objective|publications?|research|awards?(?:\s+(?:and|&)\s+honou?rs?)?|honou?rs?(?:\s+(?:and|&)\s+awards?)?|achievements?|interests?|activities|leadership|community involvement|professional affiliations?|memberships?|references?|technical skills|core competencies)\s*[:：]?$/i;
const skillsHeading = /^skills(?:\s*(?:and|&)\s*(?:technologies|tools|competencies|awards))?\s*[:：]?$/i;
function isTextSectionHeading(line){return skillsHeading.test(line)||textSectionHeading.test(line)||(/^[A-Z][A-Z &/\-]{2,48}$/.test(line)&&!workHeading.test(line)&&!educationHeading.test(line)&&!endHeading.test(line));}

function parseEducation(lines){
  const start=lines.findIndex(line=>educationHeading.test(line));
  if(start<0)return [];
  const result=[];let current=null;
  for(const line of lines.slice(start+1)){
    if(workHeading.test(line)||extraSectionHeading.test(line)||(isTextSectionHeading(line)&&!schoolPattern.test(line)&&!degreePattern.test(line))||(!educationHeading.test(line)&&endHeading.test(line)))break;
    const dates=line.match(datePattern)?.[0] || '';
    const remaining=line.replace(datePattern,'').replace(/^[\s|,;]+|[\s|,;]+$/g,'').trim();
    if(schoolPattern.test(remaining)){
      current={school:remaining,degree:'',dates};result.push(current);
    }else if(current && degreePattern.test(remaining)){
      current.degree=[current.degree,remaining].filter(Boolean).join(' ');
      if(dates&&!current.dates)current.dates=dates;
    }else if(current && dates && !current.dates){
      current.dates=dates;
      if(remaining)current.degree=[current.degree,remaining].filter(Boolean).join(' ');
    }else if(current && remaining && !current.degree){current.degree=remaining;}
  }
  return result;
}
function parseCertificateSections(lines){
  const heading=/^(?:certificates?(?:\s*(?:&|and)\s*(?:languages?)?)?|certifications?(?:\s*(?:&|and)\s*languages?)?|languages?|证书(?:与语言)?|语言(?:能力)?)\s*[:：]?$/i;
  const result=[];
  for(let i=0;i<lines.length;i++){
    if(!heading.test(lines[i]))continue;
    const title=lines[i],content=[];
    while(i+1<lines.length && !heading.test(lines[i+1]) && !workHeading.test(lines[i+1]) && !educationHeading.test(lines[i+1]) && !extraSectionHeading.test(lines[i+1]) && !isTextSectionHeading(lines[i+1]) && !/^(?:skills|技能)/i.test(lines[i+1]))content.push(lines[++i]);
    if(content.length)result.push({title,content:content.join('\n')});
  }
  return result;
}

export function parseResume(text, {projectHeaders=[]}={}) {
  const inputText=String(text).replace(/\r\n?/g, '\n').replace(/([.!?。])\s+(?=(?:waitress|waiter|cleaning|cleaner|front\s*desk\s*assistant|library\s*assistant)\s*(?:\(part[ -]?time\))?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/gi,'$1\n');
  const lines = inputText.split('\n').map(l => l.replace(/\u00a0/g, ' ').trim()).filter(Boolean);
  const email=String(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const phone=String(text).match(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/)?.[0]?.trim() || '';
  const first=lines.slice(0,5).find(l=>!workHeading.test(l)&&!endHeading.test(l)&&!datePattern.test(l)) || '';
  const name=first.split(/\s{2,}|\s*\|\s*|(?=\+\d)|(?=\b\d{5,})/)[0].replace(email,'').trim();
  const firstHeading=lines.findIndex(line=>workHeading.test(line)||educationHeading.test(line)||endHeading.test(line)||extraSectionHeading.test(line)||textSectionHeading.test(line));
  const personalLines=lines.slice(0,firstHeading<0?0:firstHeading);
  const other=personalLines.map(line=>{
    let rest=line===first?line.replace(name,''):line;
    if(email)rest=rest.replace(email,'');if(phone)rest=rest.replace(phone,'');
    return rest.replace(/^[\s|,;]+|[\s|,;]+$/g,'').replace(/\s*\|\s*\|\s*/g,' | ').trim();
  }).filter(Boolean).join('\n');
  const sectionOrder=[];
  const customSections=[];
  const contentSections=[];let contentSection=null,seenSection=false;
  for(const line of lines){
    // PROJECTS is often all caps, which also matches the fallback text-heading
    // rule. Prefer its explicit structured-section match to avoid importing it
    // a second time as an unformatted text block.
    const textHeading=!extraSectionHeading.test(line)&&(skillsHeading.test(line)||textSectionHeading.test(line)||(seenSection&&isTextSectionHeading(line)));
    const custom=(extraSectionHeading.test(line)||textHeading)?line.replace(/[:：]\s*$/,''):null;
    if(textHeading){contentSection={name:custom,content:[]};contentSections.push(contentSection);}
    else if(workHeading.test(line)||educationHeading.test(line)||endHeading.test(line)||extraSectionHeading.test(line))contentSection=null;
    else if(contentSection)contentSection.content.push(line);
    const section=custom?`custom:${custom}`:workHeading.test(line)?'experience':educationHeading.test(line)?'education':!contentSection&&endHeading.test(line)?'certificates':null;
    if(section&&!sectionOrder.includes(section))sectionOrder.push(section);
    if(custom&&!customSections.some(s=>s.name===custom))customSections.push({name:custom});
    if(section)seenSection=true;
  }
  const headingIndex = lines.findIndex(l => workHeading.test(l));
  const input = headingIndex >= 0 ? lines.slice(headingIndex + 1) : lines;
  const experiences = []; let current = null, headers = [], pendingBullet = '', currentSection='experience';
  const formattedProjectHeaders=new Set(projectHeaders.map(line=>line.replace(/\s+/g,' ').trim()));
  const flushBullet = () => {
    if (pendingBullet.trim() && current) current.bullets.push(pendingBullet.replace(/\s+/g, ' ').trim());
    pendingBullet = '';
  };
  const startExperience = () => {
    flushBullet();
    const dateLine = headers.find(l => datePattern.test(l));
    const dates = dateLine?.match(datePattern)?.[0] || '';
    const clean = headers.map(l => (l === dateLine ? l.replace(datePattern, '') : l).replace(/^[\s|,;]+|[\s|,;]+$/g, '').trim()).filter(Boolean);
    let role = '', company = '';
    if (clean.length === 1 && /\s\|\s/.test(clean[0])) {
      const chunks = clean[0].split(/\s\|\s/);
      const roleIndex = chunks.findIndex(c => rolePattern.test(c) && !companyPattern.test(c));
      if (roleIndex >= 0) { role = chunks[roleIndex]; company = chunks.filter((_, i) => i !== roleIndex).join(' | '); }
      else { role = chunks[0]; company = chunks.slice(1).join(' | '); }
    } else {
      const roleIndex = clean.findIndex(c => rolePattern.test(c) && !companyPattern.test(c));
      if (roleIndex >= 0) { role = clean[roleIndex]; company = clean.filter((_, i) => i !== roleIndex).join(' '); }
      else if (clean.length > 1 && companyPattern.test(clean[0])) { company = clean[0]; role = clean.slice(1).join(' '); }
      else { role = clean[0] || ''; company = clean.slice(1).join(' '); }
    }
    current = { role, company, dates, bullets: [], section:currentSection };
    experiences.push(current); headers = [];
  };
  for (const line of input) {
    // Check structured sections first. An all-caps PROJECTS heading also looks
    // like a generic text heading, but its entries have the same metadata and
    // bullet structure as work experience and must not be flattened to text.
    if(extraSectionHeading.test(line)){flushBullet();headers=[];current=null;currentSection=`custom:${line.replace(/[:：]\s*$/,'')}`;continue;}
    if(currentSection!=='experience' && formattedProjectHeaders.has(line.replace(/\s+/g,' ').trim())){flushBullet();if(headers.length)startExperience();current=null;headers=[line];continue;}
    if(isTextSectionHeading(line))break;
    if (endHeading.test(line)) break;
    if (workHeading.test(line)) continue;
    if (bulletPattern.test(line)) {
      flushBullet();
      if (headers.length || !current) startExperience();
      pendingBullet = line.replace(bulletPattern, '');
      continue;
    }
    const isHeader = datePattern.test(line) && line.length < 160 && !bulletPattern.test(line) && !actionPattern.test(line);
    if (isHeader) {
      flushBullet();
      if(headers.some(h=>datePattern.test(h)))startExperience();
      headers.push(line);
    }
    else if(actionPattern.test(line) && (current || headers.length>=2)) {
      flushBullet();
      if(headers.length || !current)startExperience();
      pendingBullet=line;
    }
    else if (pendingBullet && headers.length === 0) pendingBullet += ` ${line}`;
    else headers.push(line);
  }
  flushBullet();
  if (headers.length) startExperience();
  // A header without bullets remains visible for manual completion, never silently discarded.
  return {
    experiences, profile:{name,phone,email,other},education:parseEducation(lines),certificateSections:parseCertificateSections(lines),sectionOrder,customSections,contentSections:contentSections.map(s=>({...s,content:s.content.join('\n')})),sourceText:String(text),
    warnings: experiences.flatMap((e, i) => [!e.role && `Experience ${i + 1} is missing a title.`, !e.company && `Experience ${i + 1} is missing a company.`, !e.dates && `Experience ${i + 1} is missing dates.`, !e.bullets.length && `Experience ${i + 1} has no bullet points.`].filter(Boolean))
  };
}
