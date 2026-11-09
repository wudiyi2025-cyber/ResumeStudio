export function validState(s) {
  if(s?.careers!==undefined){
    if(!Array.isArray(s.careers)||!s.careers.length||!s.careers.every(c=>c&&typeof c.id==='string'&&typeof c.name==='string'&&validState({schemaVersion:1,activeLang:s.activeLang,categories:c.categories,languages:c.languages})))return false;
    if(new Set(s.careers.map(c=>c.id)).size!==s.careers.length||!s.careers.some(c=>c.id===s.activeCareer))return false;
  }
  if (!s || s.schemaVersion !== 1 || s.activeLang !== 'en' || !Array.isArray(s.categories) || s.categories.length > 200) return false;
  const isString = v => typeof v === 'string' && v.length <= 100000;
  const unique = values => new Set(values).size === values.length;
  if (!s.categories.every(c => c && isString(c.id) && isString(c.name)) || !unique(s.categories.map(c=>c.id))) return false;
  return ['en'].every(lang => {
    const l = s.languages?.[lang];
    if (!l || !l.profile || !Array.isArray(l.experiences) || !Array.isArray(l.drafts) || !l.drafts.length) return false;
    if(l.customSections!==undefined && (!Array.isArray(l.customSections)||!l.customSections.every(s=>s&&isString(s.id)&&isString(s.name))||!unique(l.customSections.map(s=>s.id))))return false;
    if (!['name','phone','email','location','certificates'].every(k=>isString(l.profile[k])) || !Array.isArray(l.profile.education)) return false;
    if (!l.profile.education.every(e => e && ['id','school','degree','dates'].every(k=>isString(e[k])))) return false;
    if (!l.experiences.every(e => e && ['id','role','company','dates'].every(k=>isString(e[k])) && Array.isArray(e.bullets) && e.bullets.every(b=>b && isString(b.id) && isString(b.text) && Array.isArray(b.categories) && b.categories.every(isString) && Array.isArray(b.sources) && b.sources.every(isString)))) return false;
    if (!unique(l.experiences.map(e=>e.id)) || !unique(l.experiences.flatMap(e=>e.bullets.map(b=>b.id)))) return false;
    const stringOrder = value => value === undefined || (Array.isArray(value) && value.every(isString));
    const numericOrder = value => value === undefined || (Array.isArray(value) && value.every(v=>Number.isInteger(v) && v>=0));
    return unique(l.drafts.map(d=>d.id)) && l.drafts.some(d=>d.id===l.activeDraft) && l.drafts.every(d => d && isString(d.id) && isString(d.name) && Array.isArray(d.selected) && d.selected.every(isString) && Array.isArray(d.order) && d.order.every(isString) && stringOrder(d.sectionOrder) && stringOrder(d.educationOrder) && numericOrder(d.certificateOrder) && d.overrides && typeof d.overrides === 'object' && Object.values(d.overrides).every(isString) && d.metaOverrides && typeof d.metaOverrides === 'object' && Object.values(d.metaOverrides).every(m=>m && ['role','company','dates'].every(k=>isString(m[k]))) && typeof d.showEducation==='boolean' && typeof d.showCertificates==='boolean' && typeof d.autoFit==='boolean' && Number.isFinite(d.fontSize) && d.fontSize>=12 && d.fontSize<=16 && ['blue','black'].includes(d.accent));
  });
}
