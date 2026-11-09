import { splitParagraphs, similarity } from './batch.js';
import { interfaceLanguage, translateInterface, translateText } from './interface-language.js?v=20261109-1';
import { validState } from './validation.js';
import { CloudSync } from './cloud.js';
import { SEED } from './seed.js';
import { parseResume } from './parser.js?v=20261109-1';
import { extractPdf } from './pdf-import.js?v=20261109-1';
import { SECTIONS, orderedKeys, migrateState } from './model.js';

const STORAGE = 'resume-studio-v1';
let cloud=null,editorReady=false,hadLocalData=false;
const clone = value => structuredClone(value);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const uid = () => crypto.randomUUID();
const icons = {
  file:'<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4M9 12h6M9 16h6"/>',
  library:'<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 4v17M12 9h4M12 13h4"/>',
  folder:'<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  upload:'<path d="M12 16V3M7 8l5-5 5 5M4 15v5h16v-5"/>',
  download:'<path d="M12 3v13M7 11l5 5 5-5M4 16v5h16v-5"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  up:'<path d="m6 14 6-6 6 6"/>',
  down:'<path d="m6 10 6 6 6-6"/>',
  settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="9" cy="18" r="2" fill="currentColor"/>',
  edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14z"/>',
  copy:'<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M15 8V3H3v13h5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">${icons[name] || icons.file}</svg>`;

let initialError = '';
let state = clone(SEED);
try {
  const saved = localStorage.getItem(STORAGE);
  if (saved) {
    const data = JSON.parse(saved);
    if (validState(data)) { state = data;hadLocalData=true; }
    else initialError = '保存的数据格式有误，已加载初始经历库。原数据尚未被覆盖。';
  }
} catch { initialError = '无法读取本地保存。可以继续编辑，请及时下载备份。'; }
let saveFailed = false;
const migrated = migrateState(state);
// This edition is English-only. Existing browser data is retained only for its
// English resume library so a previous Chinese selection cannot be restored.
state.activeLang='en';
state.languages={en:state.languages?.en || clone(SEED.languages.en)};
if(!state.careers){state.careers=[{id:'career-initial',name:'My Career',categories:state.categories,languages:state.languages}];state.activeCareer='career-initial';}
for(const career of state.careers){career.languages={en:career.languages?.en || clone(SEED.languages.en)};}
function currentCareer(){return state.careers.find(c=>c.id===state.activeCareer);}
function activateCareer(id){const selected=state.careers.find(c=>c.id===id);if(!selected)return;state.activeCareer=id;state.categories=selected.categories;state.languages=selected.languages;}
activateCareer(state.activeCareer);
function ensurePersonalLibraries(){
 if(!state.personalLibraries){
  state.personalLibraries={en:{contacts:[],education:[]}};
 }
 if(!state.personalLibrariesCareerMigration){
  for(const c of state.careers)for(const language of ['en']){
    const p=c.languages[language].profile, lib=state.personalLibraries[language];
    if([p.name,p.phone,p.email,p.location].some(Boolean) && !lib.contacts.some(x=>x.label===c.name&&['name','phone','email','location'].every(k=>x[k]===p[k])))lib.contacts.push({id:uid(),label:c.name,name:p.name,phone:p.phone,email:p.email,location:p.location});
    for(const e of p.education)if(!lib.education.some(x=>x.school===e.school&&x.degree===e.degree&&x.dates===e.dates))lib.education.push({...clone(e),id:uid()});
  }
  state.personalLibrariesCareerMigration=true;
 }
}
ensurePersonalLibraries();
const ui = { route:'editor', tab:'library', category:'all', search:'', openCards:new Set(['qingxian','enniu']), fits:true, font:13.4, filterDirty:false, alphabetical:false };
const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
document.addEventListener('click',event=>{
  document.querySelectorAll('.picker-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});
});
modal.addEventListener('click',event=>{if(event.target===modal)modal.close();});
const langData = () => state.languages[state.activeLang];
const draft = () => langData().drafts.find(d => d.id === langData().activeDraft);
const allBullets = () => langData().experiences.flatMap(e => e.bullets);
const categoryName = id => state.categories.find(c=>c.id===id)?.name || '';
const selectedCount = () => draft().selected.filter(id=>allBullets().some(b=>b.id===id)).length;
let toastTimer;
function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = translateText(message); el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(()=>el.classList.remove('visible'), 4200);
}
function save() {
  if(state.careers){const c=currentCareer();c.categories=state.categories;c.languages=state.languages;}
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); saveFailed = false; }
  catch { saveFailed = true; toast('浏览器空间不足或禁止保存，请下载数据备份。'); }
  cloud?.schedule();
}
function syncStatus(){
  return cloud?.enabled?`<button class="save-status cloud-sync-status ${cloud.status==='conflict' || cloud.status==='expired'?'save-warning':''}" data-action="account">${esc(cloud.label)}</button>`:`<span class="save-status ${saveFailed?'save-warning':''}">${saveFailed?'尚未保存，请下载备份':'修改已自动保存'}</span>`;
}
function updateCloudStatus(){
  const el=document.querySelector('.cloud-sync-status');
  if(el){el.textContent=cloud.label;el.classList.toggle('save-warning',['conflict','expired','offline'].includes(cloud.status));}
}
function capture() {
  document.querySelectorAll('.experience-card').forEach(el => el.open ? ui.openCards.add(el.dataset.exp) : ui.openCards.delete(el.dataset.exp));
  return { library:document.querySelector('.experience-list')?.scrollTop || 0, paper:document.querySelector('.paper-area')?.scrollTop || 0 };
}
function tags(b) { return b.categories.filter(id=>categoryName(id)).map(id=>`<span class="tag">${esc(categoryName(id))}</span>`).join(''); }
function filterBullet(e,b) {
  const search = ui.search.trim().toLocaleLowerCase();
  return (ui.category==='all' || b.categories.includes(ui.category)) && (!search || `${e.role} ${e.company} ${b.text}`.toLocaleLowerCase().includes(search));
}
function categoriesFilter() {
  return `<div class="filter-chips"><button class="chip ${ui.category==='all'?'active':''}" data-action="filter" data-id="all">全部</button>${state.categories.map(c=>`<button class="chip ${ui.category===c.id?'active':''}" data-action="filter" data-id="${esc(c.id)}">${esc(c.name)}</button>`).join('')}</div>`;
}
function searchField() {
  return `<div class="search-wrap">${icon('search')}<input type="search" id="search" placeholder="搜索公司、职位或经历内容" aria-label="搜索经历" value="${esc(ui.search)}"></div>`;
}
function render() {
  const scroll = capture();
  const routeName = {editor:'简历制作',library:'经历库',personal:'个人信息',education:'教育经历',other:'其他章节',categories:'分类管理'}[ui.route];
  app.innerHTML = `<div class="app-shell">
    <aside class="sidebar"><a class="brand" href="#editor" aria-label="简历工作室首页"><span class="brand-icon">${icon('file')}</span>简历工作室</a>
      <div class="side-label">我的工作台</div><nav class="nav-list" aria-label="主导航">
      ${[['editor','file','简历制作'],['personal','file','个人信息'],['education','file','教育经历'],['library','library','经历库'],['other','folder','其他章节'],['categories','folder','分类管理']].map(([id,i,label])=>`<button class="nav-item ${ui.route===id?'active':''}" data-action="navigate" data-id="${id}" aria-label="${label}" ${ui.route===id?'aria-current="page"':''}>${icon(i)}${label}${id==='library'?`<span class="nav-count" aria-hidden="true">${allBullets().length}</span>`:''}</button>`).join('')}
      </nav><div class="side-bottom"><div class="local-note"><span class="status-dot"></span>${cloud?.enabled?'登录后跨设备同步':'保存在本机浏览器'}</div><p>${cloud?.enabled?'经历与简历会自动同步。<br>也可以下载一份数据备份。':'经历与修改会自动保存。<br>换设备前，请先下载备份。'}</p>${cloud?.enabled?'<button class="quiet small" data-action="account">账户与同步</button>':''}<div class="backup-actions"><button class="quiet" data-action="backup">下载备份</button><button class="quiet" data-action="restore">恢复备份</button></div></div>
    </aside><main class="main"><header class="topbar"><div class="breadcrumbs">我的工作台 <span>/</span> <strong>${routeName}</strong></div><div class="top-actions">${syncStatus()}</div></header>
    <div class="workspace">${ui.route==='editor'?editorView():ui.route==='library'?libraryView():ui.route==='personal'||ui.route==='education'?personalView(ui.route):ui.route==='other'?otherView():categoriesView()}</div></main></div>`;
  if (ui.route === 'editor') {
    refreshPreview();
    document.querySelector('.experience-list').scrollTop = scroll.library;
    document.querySelector('.paper-area').scrollTop = scroll.paper;
  }
  translateInterface(app);
}
function editorView() {
  return `<div class="page-heading"><div><div class="eyebrow">RESUME STUDIO</div><h1>制作你的英文简历</h1><p>从经历库逐条选择，组合适合这次投递的简历。</p></div><div class="heading-actions"><button data-action="import">${icon('upload')}导入简历</button><button class="primary" data-action="export">${icon('download')}导出简历</button></div></div>
  <div class="draft-bar"><div class="draft-picker"><div class="draft-picker-row"><label for="career-select">岗位</label><select id="career-select" aria-label="当前职业">${state.careers.map(c=>`<option value="${esc(c.id)}" ${c.id===state.activeCareer?'selected':''}>${esc(c.name)}</option>`).join('')}</select><details class="picker-menu"><summary title="${interfaceLanguage()==='en'?'Career actions':'岗位操作'}" aria-label="${interfaceLanguage()==='en'?'Career actions':'岗位操作'}">${icon('settings')}</summary><div class="picker-menu-options"><button type="button" data-action="new-career">${icon('plus')}新增岗位</button><button type="button" data-action="rename-career">${icon('edit')}修改职业名称</button><button type="button" data-action="copy-career-data">${icon('copy')}从其他岗位导入</button><button type="button" class="danger" data-action="delete-career">删除岗位</button></div></details></div><div class="draft-picker-row"><label for="draft-select">简历</label><select id="draft-select" aria-label="当前简历">${langData().drafts.map(d=>`<option value="${esc(d.id)}" ${d.id===draft().id?'selected':''}>${esc(d.name)}</option>`).join('')}</select><details class="picker-menu"><summary title="${interfaceLanguage()==='en'?'Resume actions':'简历操作'}" aria-label="${interfaceLanguage()==='en'?'Resume actions':'简历操作'}">${icon('settings')}</summary><div class="picker-menu-options"><button type="button" data-action="new-draft">${icon('plus')}新增简历</button><button type="button" data-action="rename-draft">${icon('edit')}修改简历名称</button><button type="button" data-action="choose-personal">${icon('file')}选择个人与教育资料</button><button type="button" data-action="copy-draft">${icon('copy')}另存一份</button>${langData().drafts.length>1?'<button type="button" class="danger" data-action="delete-draft">删除</button>':''}</div></details></div></div></div>
  <div class="editor-grid"><section class="selection-panel" aria-label="选择经历"><div class="selection-top"><div class="panel-tabs"><button data-action="tab" data-id="library" class="${ui.tab==='library'?'active':''}">选择经历 <span>${allBullets().length}</span></button><button data-action="tab" data-id="selected" class="${ui.tab==='selected'?'active':''}">已选内容 <span>${selectedCount()}</span></button></div>${ui.tab==='library'?`${searchField()}${categoriesFilter()}`:'<p class="independent-note">勾选或取消勾选内容，并用上下箭头调整经历和要点顺序。</p>'}</div>
  <div class="selection-summary"><span>${ui.tab==='library'?'勾选条目，即可加入右侧简历':`已选择 ${selectedCount()} 条经历要点`}</span><button class="quiet small" data-action="${ui.tab==='library'?'import':'clear-selection'}">${ui.tab==='library'?'导入经历':'清空选择'}</button></div><div class="experience-list" id="selection-list">${ui.tab==='library'?selectionList():selectedList()}</div></section>
  <section class="preview-panel" aria-label="简历预览"><div class="preview-toolbar"><strong>简历预览 <span class="muted">· English · Letter</span></strong><div class="preview-tools"><button class="page-badge" id="page-badge" data-action="layout" aria-label="打开排版设置">正在排版</button><button class="small preview-sort-button" data-action="preview-reorder" aria-label="在预览中调整顺序">${icon('up')}调整顺序</button></div></div><div class="paper-area"><div class="paper-wrap preview-interactive" id="paper-wrap" data-action="preview-reorder" role="button" tabindex="0" aria-label="点击预览中的内容进行编辑" aria-describedby="preview-instruction" aria-haspopup="dialog"><article id="resume-preview" class="resume-page"></article><span class="preview-reorder-hint" aria-hidden="true">${icon('up')}点击编辑</span></div><div class="preview-caption"><span id="preview-instruction">点击预览中的内容进行编辑；在“已选内容”中勾选并调整顺序</span><span>与原简历相同的单栏版式 · 8.5 × 11 英寸</span></div></div></section></div>`;
}
function selectionList() {
  const groups = langData().experiences.map(e=>({e,bullets:(ui.alphabetical?[...e.bullets].sort((a,b)=>a.text.localeCompare(b.text,undefined,{sensitivity:"base"})):e.bullets).filter(b=>filterBullet(e,b))})).filter(g=>g.bullets.length||(!g.e.bullets.length&&!ui.search&&ui.category==='all'));
  if (!groups.length) return `<div class="empty-state">${icon('library')}<h3>${allBullets().length?'没有找到对应经历':'从第一段经历开始'}</h3><p>${allBullets().length?'试试其他分类或搜索词。':'导入已有简历，或在经历库手动添加。'}</p>${!allBullets().length?'<button class="small" data-action="import">导入经历</button>':''}</div>`;
  return groups.map(({e,bullets},index)=>{const section=(langData().customSections||[]).find(s=>s.id===e.section)?.name || (e.section==='experience'?'Work Experience':'Other Experience');const previous=groups[index-1]?.e;const previousSection=(langData().customSections||[]).find(s=>s.id===previous?.section)?.name || (previous?.section==='experience'?'Work Experience':'Other Experience');return `${section!==previousSection?`<div class="editor-section-heading">${esc(section)}</div>`:''}<details class="experience-card" data-exp="${esc(e.id)}" ${ui.openCards.has(e.id)||ui.search||ui.category!=='all'?'open':''}><summary><span class="chevron">${icon('chevron')}</span><div class="experience-info"><h3>${esc(e.role)}</h3><p class="company-short">${esc(e.company)}</p><p>${esc(e.dates)}</p></div><span class="experience-count">${bullets.filter(b=>draft().selected.includes(b.id)).length}/${bullets.length}</span></summary><div class="experience-bulk"><button type="button" class="quiet small" data-action="select-experience" data-id="${esc(e.id)}">${((bullets.length ? bullets.every(b=>draft().selected.includes(b.id)) : (draft().selectedExperiences||[]).includes(e.id)))?'取消全选':'全选该经历'}</button></div>${bullets.map(b=>`<div class="bullet-row ${draft().selected.includes(b.id)?'selected':''}"><input type="checkbox" id="select-${esc(b.id)}" data-select="${esc(b.id)}" ${draft().selected.includes(b.id)?'checked':''} aria-label="选择经历：${esc(b.text.slice(0,70))}"><div class="bullet-label"><label for="select-${esc(b.id)}" class="bullet-text">${esc(b.text)}</label><div class="bullet-footer">${tags(b)}<span class="source-label">${esc(b.sources.join(' / '))}</span><button class="quiet bullet-edit" data-action="edit-bullet" data-id="${esc(b.id)}" data-mode="library">编辑</button></div></div></div>`).join('')}</details>`;}).join('');
}
function orderedExperiences() {
  const data = langData(); const d = draft();
  return [...data.experiences].sort((a,b)=>{
    const ai=d.order.indexOf(a.id), bi=d.order.indexOf(b.id);
    return (ai<0?999:ai)-(bi<0?999:bi);
  }).map(e=>({...e,...d.metaOverrides[e.id],bullets:d.selected.map(id=>e.bullets.find(b=>b.id===id)).filter(Boolean)})).filter(e=>e.bullets.length||(d.selectedExperiences||[]).includes(e.id));
}
function selectedList() {
  const groups=orderedExperiences();
  if (!groups.length) return '<div class="empty-state"><h3>还没有选择经历</h3><p>回到“选择经历”，勾选你希望加入的要点。</p></div>';
  return groups.map((e,ei)=>`<div class="selected-block"><div class="selected-block-heading"><div><strong>${esc(e.role)}</strong><div class="muted">${esc(e.company)}</div><button class="quiet small" data-action="edit-draft-meta" data-id="${esc(e.id)}">修改职位、公司与时间</button></div><div class="move-actions"><button class="icon-button quiet" data-action="move-experience" data-id="${esc(e.id)}" data-direction="-1" aria-label="上移经历" ${ei===0?'disabled':''}>${icon('up')}</button><button class="icon-button quiet" data-action="move-experience" data-id="${esc(e.id)}" data-direction="1" aria-label="下移经历" ${ei===groups.length-1?'disabled':''}>${icon('down')}</button></div></div>${e.bullets.map((b,bi)=>`<div class="selected-item"><label class="selected-item-select"><input type="checkbox" data-select="${esc(b.id)}" checked aria-label="保留经历：${esc(b.text.slice(0,70))}"><span>${esc(draft().overrides[b.id]??b.text)}</span></label><div class="selected-item-footer"><button class="quiet small" data-action="edit-bullet" data-id="${esc(b.id)}" data-mode="draft">编辑文字</button><div class="move-actions"><button class="quiet icon-button" data-action="move-bullet" data-id="${esc(b.id)}" data-direction="-1" aria-label="上移要点" ${bi===0?'disabled':''}>${icon('up')}</button><button class="quiet icon-button" data-action="move-bullet" data-id="${esc(b.id)}" data-direction="1" aria-label="下移要点" ${bi===e.bullets.length-1?'disabled':''}>${icon('down')}</button></div></div></div>`).join('')}</div>`).join('');
}
function resumeMarkup() {
  const d=draft(), p={...langData().profile,...(d.personalOverride||{}),education:d.educationOverride??langData().profile.education}, en=state.activeLang==='en';
  const contact = [p.phone,p.email,p.location].filter(Boolean).map(esc).join(' | ');
  const education = orderedKeys(d.educationOrder,p.education.map(e=>e.id)).map(id=>p.education.find(e=>e.id===id));
  const certificateLines = p.certificates.split('\n').filter(line=>line.trim());
  const certificates = orderedKeys(d.certificateOrder,certificateLines.map((_,i)=>i)).map(i=>({id:i,text:certificateLines[i]}));
  const sections = {
    education:education.length?`<h2 class="resume-heading" data-preview-sort="sections" data-preview-key="education">${en?'Education':'教育背景'}</h2>${education.map(e=>`<div class="resume-education" data-preview-sort="education" data-preview-key="${esc(e.id)}"><div class="resume-row"><span class="resume-school">${esc(e.school)}</span><span class="resume-dates">${esc(e.dates)}</span></div><div class="resume-degree">${esc(e.degree)}</div></div>`).join('')}`:'',
    experience:'',
    certificates:certificates.length?`<h2 class="resume-heading" data-preview-sort="sections" data-preview-key="certificates">${en?'Certificate & Language':'证书与语言'}</h2><p class="resume-certificate">${certificates.map(c=>`<span data-preview-sort="certificates" data-preview-key="${c.id}">${esc(c.text)}</span>`).join('\n')}</p>`:''
  };
  for(const section of [{id:'experience',name:en?'Work Experience':'工作经历'},...(langData().customSections||[])]){
    const entries=orderedExperiences().filter(e=>(e.section || 'experience')===section.id);
    const text=section.id==='experience'?'':(d.otherContent?.[section.id]||'');
    sections[section.id]=(entries.length||text.trim())?`${section.untitled?'':`<h2 class="resume-heading" data-preview-sort="sections" data-preview-key="${esc(section.id)}">${esc(section.name)}</h2>`}${text.trim()?`<p class="resume-certificate" data-preview-edit="other" data-preview-id="${esc(section.id)}">${esc(text)}</p>`:''}${entries.map(e=>`<section class="resume-experience" data-preview-sort="experiences" data-preview-key="${esc(e.id)}"><div class="resume-row"><span class="resume-role">${esc(e.role)}</span><span class="resume-dates">${esc(e.dates)}</span></div>${e.company?`<div class="resume-company">${esc(e.company)}</div>`:''}<ul class="resume-bullets">${e.bullets.map(b=>`<li data-preview-sort="bullets-${esc(e.id)}" data-preview-key="${esc(b.id)}">${esc(d.overrides[b.id]??b.text)}</li>`).join('')}</ul></section>`).join('')}`:'';
  }
  return `<div class="resume-header"><h1 class="resume-name">${esc(p.name || (en?'Your Name':'姓名'))}</h1><span class="resume-contact">${contact}</span>${p.other?`<div class="resume-contact resume-contact-other">${esc(p.other)}</div>`:''}</div>${orderedKeys(d.sectionOrder,[...SECTIONS,...(langData().customSections||[]).map(s=>s.id)]).filter(id=>!(d.hiddenSections||[]).includes(id)).map(id=>sections[id]).join('')}`;
}
function careerPicker(){return `<div class="career-filter"><label for="career-select">岗位</label><select id="career-select" aria-label="当前职业">${state.careers.map(c=>`<option value="${esc(c.id)}" ${c.id===state.activeCareer?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>`;}
let resizeObserver;
function refreshPreview() {
  const page=document.querySelector('#resume-preview'); if (!page) return;
  page.className=`resume-page lang-${state.activeLang} ${draft().accent==='black'?'black':''}`;
  page.innerHTML=resumeMarkup();
  let font=draft().autoFit?16:draft().fontSize;
  let lineHeight=draft().autoFit?1.45:(draft().lineHeight??1.16);
  const fits=()=> page.scrollHeight<=page.clientHeight+1 && page.scrollWidth<=page.clientWidth+1;
  page.style.setProperty('--resume-font',`${font}px`);
  page.style.setProperty('--resume-line-height',String(lineHeight));
  if(draft().autoFit) {
    while(!fits() && lineHeight>1.16) { lineHeight=Math.max(1.16,Math.round((lineHeight-.02)*100)/100);page.style.setProperty('--resume-line-height',String(lineHeight)); }
    while(!fits() && font>12.67) { font=Math.max(12.67,font-.15); page.style.setProperty('--resume-font',`${font.toFixed(2)}px`); }
  }
  ui.fits=fits(); ui.font=font;ui.lineHeight=lineHeight;
  const badge=document.querySelector('#page-badge');
  badge.textContent=ui.fits?`${draft().autoFit?'Auto layout':'Manual layout'} · 1 page · ${(font*.75).toFixed(1)} pt`:'Content exceeds one page';
  badge.classList.toggle('over',!ui.fits);
  const area=document.querySelector('.paper-area'),wrap=document.querySelector('#paper-wrap');
  const scale=()=>{
    const style=getComputedStyle(area);
    const available=area.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    const s=Math.min(1,available/816);
    wrap.style.setProperty('--scale',s);wrap.style.width=`${816*s}px`;wrap.style.height=`${Math.max(1056,page.scrollHeight)*s}px`;
  };
  resizeObserver?.disconnect(); resizeObserver=new ResizeObserver(scale);resizeObserver.observe(area);scale();
}
function libraryView() {
  const l=langData();
  return `<div class="page-heading"><div><div class="eyebrow">EXPERIENCE LIBRARY</div><h1>你的经历，随时可用</h1><p>把完整经历放在这里，按条编辑、分类，再用于不同简历。</p></div><div class="heading-actions"><button data-action="import">${icon('upload')}导入经历</button><button data-action="add-project">${icon('plus')}Add project</button><button class="primary" data-action="new-experience">${icon('plus')}添加经历</button></div></div>
  ${careerPicker()}<div class="stats-row"><div class="stat"><strong>${l.experiences.length.toString().padStart(2,'0')}</strong><span>段工作经历</span></div><div class="stat"><strong>${allBullets().length.toString().padStart(2,'0')}</strong><span>条经历要点</span></div><div class="stat"><strong>${state.categories.length.toString().padStart(2,'0')}</strong><span>个求职方向</span></div></div>

  <div class="library-toolbar">${searchField()}${categoriesFilter()}<label class="check-label sort-toggle"><input type="checkbox" data-sort-alpha ${ui.alphabetical?'checked':''}>按首字母排序</label></div><div class="library-grid" id="library-grid">${libraryCards()}</div>`;
}
function libraryCards() {
  const groups=langData().experiences.map(e=>({e,bullets:e.bullets.filter(b=>filterBullet(e,b))})).filter(g=>g.bullets.length || (!ui.search && ui.category==='all'));
  if(!groups.length) return '<div class="empty-state"><h3>暂无符合条件的经历</h3><p>可以导入简历，或手动添加。</p></div>';
  const grouped=new Map();
  for(const item of groups){const title=item.e.role.trim()||(state.activeLang==='en'?'Untitled role':'未填写职位'),key=title.toLocaleLowerCase();if(!grouped.has(key))grouped.set(key,{title,items:[]});grouped.get(key).items.push(item);}
  return [...grouped.values()].map(({title,items},groupIndex)=>`<details class="role-group" ${ui.search||ui.category!=='all'?'open':''}><summary class="role-group-summary"><span class="chevron">${icon('chevron')}</span><div><h2 data-user-content>${esc(title)}</h2><p>${items.length} 段经历 · ${items.reduce((n,item)=>n+item.e.bullets.length,0)} 条要点</p></div><span class="role-group-action">${groupIndex===0?'点击展开':''}</span></summary><div class="role-group-content">${items.map(({e,bullets})=>`<article class="library-card"><header class="library-card-header"><div><h3>${esc(e.role||'未填写职位')}</h3><p>${esc(e.company||'未填写公司')}</p><small>${esc(e.dates||'未填写时间')} · ${e.bullets.length} 条要点</small></div><button class="small" data-action="edit-experience" data-id="${esc(e.id)}">编辑经历</button></header>${bullets.map(b=>`<div class="library-bullet"><p>${esc(b.text)}</p><div class="library-bullet-footer">${tags(b)}<span class="source-label">${esc(b.sources.join(' / '))}</span><button class="quiet bullet-edit" data-action="edit-bullet" data-id="${esc(b.id)}" data-mode="library">编辑与分类</button></div></div>`).join('')}<footer class="library-card-bottom"><button class="quiet small" data-action="new-bullet" data-id="${esc(e.id)}">${icon('plus')}添加要点</button><button class="quiet small" data-action="batch-bullets" data-id="${esc(e.id)}">${icon('plus')}批量添加</button></footer></article>`).join('')}</div></details>`).join('');
}
function categoriesView() {
  return `<div class="page-heading"><div><div class="eyebrow">APPLICATION DIRECTIONS</div><h1>按方向，整理经历</h1><p>同一条经历可以放进多个分类。在简历制作页按分类筛选，再逐条选择。</p></div><button class="primary" data-action="new-category">${icon('plus')}新建分类</button></div>${careerPicker()}<div class="categories-grid">${state.categories.map(c=>{
    const bullets=allBullets().filter(b=>b.categories.includes(c.id));
    const count=langData().experiences.filter(e=>e.bullets.some(b=>b.categories.includes(c.id))).length;
    return `<article class="category-card"><div class="category-top"><h3>${esc(c.name)}</h3>${icon('folder')}</div><p>${bullets.length} 条要点，来自 ${count} 段经历<br>${state.activeLang==='en'?'英文经历库':'中文经历库'}</p><div class="category-bottom"><button class="small" data-action="assign-category" data-id="${esc(c.id)}">选择条目</button><button class="quiet small" data-action="rename-category" data-id="${esc(c.id)}">改名</button><button class="quiet small danger" data-action="delete-category" data-id="${esc(c.id)}">删除</button></div></article>`;
  }).join('') || '<div class="empty-state"><h3>新建你的第一个求职方向</h3><p>例如营销、AI 或数据合规。</p></div>'}</div><p class="layout-note" style="margin-top:22px">分类名称在中英文之间共用，分类中的条目分别来自各自的经历库。</p>`;
}

function field(label,name,value='',options={}) {
  return `<div class="form-field ${options.full?'full':''}"><label for="field-${esc(name)}">${label}</label>${options.textarea?`<textarea id="field-${esc(name)}" name="${esc(name)}" rows="${options.rows||5}" ${options.required?'required':''}>${esc(value)}</textarea>`:`<input id="field-${esc(name)}" name="${esc(name)}" value="${esc(value)}" ${options.required?'required':''} ${options.type?`type="${options.type}"`:''} ${options.list?`list="${options.list}"`:''}>`}</div>`;
}
function openModal(title,body,onSubmit,{submit='保存',extra='',wide=false}={}) {
  modal.className=wide?'modal-wide':'';
  modal.innerHTML=`<form id="modal-form"><header class="modal-header"><h2 id="modal-title">${title}</h2><button type="button" class="quiet icon-button" data-close aria-label="关闭">${icon('close')}</button></header><div class="modal-body">${body}</div><footer class="modal-footer">${extra}<button type="button" data-close>取消</button>${onSubmit?`<button type="submit" class="primary" id="modal-submit">${submit}</button>`:''}</footer></form>`;
  modal.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>modal.close());
  modal.querySelector('form').onsubmit=async event=>{
    event.preventDefault();
    try { await onSubmit?.(new FormData(event.currentTarget)); }
    catch(error){ toast(error.message); }
  };
  if(!modal.open)modal.showModal();
  translateInterface(modal);
}
function done(message='已保存') { save();modal.close();render();toast(message); }
function confirmModal(title,message,callback) {
  openModal(title,`<p>${esc(message)}</p>`,()=>{callback();done('已完成');},{submit:'确认'});
}
function askName(title,value,callback) {
  openModal(title,field('名称','name',value,{required:true}),form=>{const name=form.get('name').trim();if(!name)throw new Error('请填写名称。');callback(name);done();});
}
function reorderModal(target) {
  const d=draft(),p={...langData().profile,education:d.educationOverride??langData().profile.education},groups=orderedExperiences();
  const names={education:translateText('教育经历'),experience:translateText('工作经历'),certificates:translateText('证书与语言'),...Object.fromEntries((langData().customSections||[]).map(s=>[s.id,s.name]))};
  const list=(name,items)=>`<div class="reorder-list" data-sort-list="${esc(name)}">${items.map(([id,text],i)=>`<div class="reorder-row" data-key="${esc(id)}"><span class="reorder-position">${i+1}</span><span class="reorder-text">${esc(text)}</span>${name==='sections'?`<label class="check-label"><input type="checkbox" name="visible-section" value="${esc(id)}" ${(d.hiddenSections||[]).includes(id)?'':'checked'}>显示</label>`:''}<div class="move-actions"><button type="button" class="small" data-sort-move="-1" aria-label="上移" ${i===0?'disabled':''}>${icon('up')}上移</button><button type="button" class="small" data-sort-move="1" aria-label="下移" ${i===items.length-1?'disabled':''}>${icon('down')}下移</button></div></div>`).join('') || '<p class="muted">暂无条目。</p>'}</div>`;
  const certificates=p.certificates.split('\n').filter(line=>line.trim());
  const body=`<p>新增章节后，请在“其他章节”中编辑内容；这里仅负责添加空白章节和调整顺序。</p>${field('新增章节','new-section','')}${field('新章节内容（可分行）','new-section-content','',{textarea:true,rows:3})}
    <section class="reorder-group"><h3>简历各部分</h3>${list('sections',orderedKeys(d.sectionOrder,[...SECTIONS,...(langData().customSections||[]).map(s=>s.id)]).map(id=>[id,names[id]]))}</section>
    <section class="reorder-group"><h3>教育经历</h3>${list('education',orderedKeys(d.educationOrder,p.education.map(e=>e.id)).map(id=>[id,p.education.find(e=>e.id===id).school]))}</section>
    <section class="reorder-group"><h3>工作经历</h3>${list('experiences',groups.map(e=>[e.id,`${e.role} · ${e.company}`]))}</section>
    ${groups.map(e=>`<section class="reorder-group"><h3>${esc(e.role)} · 每条经历要点</h3><p class="muted">${esc(e.company)}</p>${list(`bullets-${e.id}`,e.bullets.map(b=>[b.id,d.overrides[b.id]??b.text]))}</section>`).join('')}
    <section class="reorder-group"><h3>证书与语言</h3>${list('certificates',orderedKeys(d.certificateOrder,certificates.map((_,i)=>i)).map(i=>[i,certificates[i]]))}</section>`;
  openModal('章节和顺序',body,form=>{
    const custom=langData().customSections||[];
    const newName=form.get('new-section').trim();
    if(newName && custom.some(s=>s.name===newName))throw new Error('已有同名章节。');
    const keys=name=>[...modal.querySelectorAll('[data-sort-list]')].find(el=>el.dataset.sortList===name);
    const order=name=>[...keys(name).children].filter(el=>el.hasAttribute('data-key')).map(el=>el.dataset.key);
    d.otherContent ||= {};
    d.sectionOrder=order('sections');d.hiddenSections=d.sectionOrder.filter(id=>!form.getAll('visible-section').includes(id));if(newName){const section={id:uid(),name:newName,content:form.get('new-section-content').trim()};custom.push(section);d.sectionOrder.push(section.id);d.otherContent[section.id]=section.content;}langData().customSections=custom;
    d.educationOrder=order('education');d.certificateOrder=order('certificates').map(Number);
    d.order=orderedKeys(order('experiences'),langData().experiences.map(e=>e.id));
    const selected=d.order.flatMap(id=>groups.some(e=>e.id===id)?order(`bullets-${id}`):[]);
    d.selected=orderedKeys(selected,d.selected);
    done('顺序已保存，预览与导出已同步。');
  },{submit:'保存顺序',wide:true});
  modal.classList.add('reorder-modal');
  const bodyEl=modal.querySelector('.modal-body');
  bodyEl.innerHTML=`<div class="reorder-controls">${bodyEl.innerHTML}</div><aside class="reorder-preview"><strong>${interfaceLanguage()==='en'?'Resume preview':'简历预览'}</strong><div class="reorder-preview-area"><div class="reorder-paper"><article class="resume-page"></article></div></div></aside>`;
  const updatePreview=()=>{
    const form=new FormData(modal.querySelector('form'));
    const listKeys=name=>[...modal.querySelectorAll('[data-sort-list]')].find(el=>el.dataset.sortList===name);
    const order=name=>[...(listKeys(name)?.children||[])].filter(el=>el.hasAttribute('data-key')).map(el=>el.dataset.key);
    const savedDraft=structuredClone(d), savedSections=langData().customSections;
    try {
      const sections=(savedSections||[]).map(s=>({...s}));
      d.otherContent={...(d.otherContent||{})};
      sections.forEach(s=>{d.otherContent[s.id]=d.otherContent[s.id]??s.content??'';});
      d.sectionOrder=order('sections');d.hiddenSections=d.sectionOrder.filter(id=>!form.getAll('visible-section').includes(id));
      const newName=form.get('new-section').trim();
      if(newName){const id='__new_section_preview__';sections.push({id,name:newName});d.sectionOrder.push(id);d.otherContent[id]=form.get('new-section-content');}
      langData().customSections=sections;
      d.educationOrder=order('education');d.certificateOrder=order('certificates').map(Number);
      d.order=orderedKeys(order('experiences'),langData().experiences.map(e=>e.id));
      d.selected=orderedKeys(d.order.flatMap(id=>groups.some(e=>e.id===id)?order(`bullets-${id}`):[]),d.selected);
      const page=modal.querySelector('.reorder-paper .resume-page');
      page.className=`resume-page lang-${state.activeLang} ${d.accent==='black'?'black':''}`;
      page.style.setProperty('--resume-font',`${ui.font || d.fontSize}px`);page.style.setProperty('--resume-line-height',String(ui.lineHeight??d.lineHeight??1.16));
      page.innerHTML=resumeMarkup();
      const area=modal.querySelector('.reorder-preview-area'),paper=modal.querySelector('.reorder-paper');
      const scale=Math.min(1,(area.clientWidth-32)/816);
      paper.style.width=`${816*scale}px`;paper.style.height=`${Math.max(1056,page.scrollHeight)*scale}px`;page.style.transform=`scale(${scale})`;
    } finally { Object.assign(d,savedDraft);langData().customSections=savedSections; }
  };
  modal.querySelector('form').addEventListener('input',updatePreview);
  modal.querySelector('form').addEventListener('change',updatePreview);
  modal.querySelectorAll('[data-sort-move]').forEach(button=>button.onclick=()=>{
    const row=button.closest('.reorder-row'),parent=row.parentElement;
    if(button.dataset.sortMove==='-1' && row.previousElementSibling)parent.insertBefore(row,row.previousElementSibling);
    else if(button.dataset.sortMove==='1' && row.nextElementSibling)parent.insertBefore(row.nextElementSibling,row);
    [...parent.children].forEach((el,i)=>{
      el.querySelector('.reorder-position').textContent=i+1;
      el.querySelector('[data-sort-move="-1"]').disabled=i===0;
      el.querySelector('[data-sort-move="1"]').disabled=i===parent.children.length-1;
    });
    updatePreview();
  });
  updatePreview();
  if(target){
    const list=[...modal.querySelectorAll('[data-sort-list]')].find(el=>el.dataset.sortList===target.group);
    const row=list && [...list.children].find(el=>el.dataset.key===target.key);
    if(row){
      row.classList.add('reorder-highlight');
      row.scrollIntoView({block:'center'});
      const control=row.querySelector('button:not(:disabled)');
      control?.focus({preventScroll:true});
    }
  }
}
function personalView(type){
  const lib=state.personalLibraries[state.activeLang];
  const isContact=type==='personal';
  return `<div class="page-heading"><div><h1>${isContact?'个人信息':'教育经历'}</h1><p>${state.activeLang==='en'?'英文资料库':'中文资料库'}</p></div><button data-action="${isContact?'new-contact':'new-education'}">${icon('plus')}${isContact?'添加个人信息':'添加教育经历'}</button></div>${isContact?(lib.contacts.map(c=>`<article class="library-card personal-item"><div data-user-content><h3>${esc(c.label)}</h3><p>${esc([c.name,c.phone,c.email,c.location].filter(Boolean).join(' · '))}</p></div><button data-action="edit-contact" data-id="${esc(c.id)}">编辑</button></article>`).join('')||'<p class="muted">暂无个人信息。</p>'):(lib.education.map(e=>`<article class="library-card personal-item"><div data-user-content><h3>${esc(e.school)}</h3><p>${esc([e.degree,e.dates].filter(Boolean).join(' · '))}</p></div><button data-action="edit-education" data-id="${esc(e.id)}">编辑</button></article>`).join('')||'<p class="muted">暂无教育经历。</p>')}`;
}
function otherView(){
  const sections=langData().customSections||[];
  return `<div class="page-heading"><div><h1>其他章节</h1><p>管理可重复使用的项目和自定义内容。要把内容放入简历，请回到简历制作页面选择。</p></div><div class="heading-actions"><button data-action="add-project">${icon('plus')}Add project</button><button data-action="new-other">${icon('plus')}新增章节</button></div></div>${careerPicker()}<article class="library-card personal-item"><div><h3>证书与语言</h3><p>${esc(langData().profile.certificates||'暂无文字内容')}</p></div><button data-action="edit-certificates">编辑</button></article>${sections.map(s=>{const projects=langData().experiences.filter(e=>e.section===s.id);const isProject=/project/i.test(s.name);return `<article class="library-card other-section-card"><div class="other-section-header"><div><h3 class="section-name">${esc(s.name)}</h3><p>${isProject?`${projects.length} project${projects.length===1?'':'s'} · manage these in Resume Studio`:esc(s.content||'暂无文字内容')}</p></div><div class="move-actions">${isProject?'<button data-action="add-project">Add project</button>':''}<button data-action="edit-other" data-id="${esc(s.id)}">编辑</button></div></div>${isProject?`<div class="other-project-list">${projects.map(e=>`<div class="other-project-row"><span><strong>${esc(e.role)}</strong><small>${esc([e.company,e.dates].filter(Boolean).join(' · '))}</small></span><button class="quiet small" data-action="edit-experience" data-id="${esc(e.id)}">Edit</button></div>`).join('')||'<p class="muted">No projects yet.</p>'}</div>`:''}</article>`;}).join('')}`;
}
function editLayout() {
  const d=draft();
  openModal('Layout settings',`<p>Auto layout adjusts text size and line spacing to fit one page. Switch to manual to choose your own settings.</p><div class="form-field"><label for="layout-mode">Layout mode</label><select id="layout-mode" name="mode"><option value="auto" ${d.autoFit?'selected':''}>Auto layout</option><option value="manual" ${!d.autoFit?'selected':''}>Manual</option></select></div><div class="form-field"><label for="font-size">Body text size</label><select id="font-size" name="fontSize">${[[12.67,'9.5 pt'],[13.33,'10 pt'],[14,'10.5 pt'],[14.67,'11 pt'],[15.33,'11.5 pt'],[16,'12 pt']].map(([v,t])=>`<option value="${v}" ${Math.abs(v-d.fontSize)<.2?'selected':''}>${t}</option>`).join('')}</select></div><div class="form-field"><label for="line-height">Line spacing</label><select id="line-height" name="lineHeight">${[[1.16,'Compact'],[1.25,'Normal'],[1.35,'Relaxed'],[1.45,'Wide']].map(([v,t])=>`<option value="${v}" ${Math.abs(v-(d.lineHeight??1.16))<.01?'selected':''}>${t}</option>`).join('')}</select></div><div class="form-field"><label for="accent">Heading color</label><select id="accent" name="accent"><option value="blue" ${d.accent==='blue'?'selected':''}>Blue</option><option value="black" ${d.accent==='black'?'selected':''}>Black</option></select></div>`,form=>{
    d.autoFit=form.get('mode')==='auto';if(!d.autoFit){d.fontSize=Number(form.get('fontSize'));d.lineHeight=Number(form.get('lineHeight'));}d.accent=form.get('accent');done();
  });
  const mode=modal.querySelector('#layout-mode'),font=modal.querySelector('#font-size'),spacing=modal.querySelector('#line-height');
  const update=()=>{font.disabled=spacing.disabled=mode.value==='auto';};mode.addEventListener('change',update);update();
}
function addProject(){
  const sections=langData().customSections ||= [];
  let section=sections.find(s=>/project/i.test(s.name));
  openModal('Add project',`<p>Add one project at a time. It will appear in the Projects section using the same layout as work experience.</p>${field('Project name','role','',{required:true})}${field('Organization or link','company','')}${field('Dates','dates','')}${field('Project highlights (one per line)','bullets','',{textarea:true,rows:6})}`,form=>{
    const role=form.get('role').trim(),company=form.get('company').trim(),dates=form.get('dates').trim(),bullets=splitBullets(form.get('bullets'));
    if(!role)throw new Error('Enter a project name.');
    if(!section){section={id:uid(),name:'Projects'};sections.push(section);}
    const eid=uid(),items=bullets.map(text=>({id:uid(),text,categories:[],sources:['Manual entry']}));
    langData().experiences.unshift({id:eid,role,company,dates,section:section.id,alternatives:[],bullets:items});
    for(const d of langData().drafts)d.order.unshift(eid);
    ui.openCards.add(eid);done('Project added to the library. Select it in Resume Studio when you want to use it.');
  },{submit:'Add project'});
}
function editCertificates(){
  openModal('证书与语言',field('证书与语言（每行一项）','certificates',langData().profile.certificates,{textarea:true,rows:6}),form=>{
    const value=form.get('certificates').trim();if(value!==langData().profile.certificates)for(const d of langData().drafts)delete d.certificateOrder;
    langData().profile.certificates=value;done();
  });
}
function editFromPreview(kind,id){
  if(kind==='other'){
    const section=(langData().customSections||[]).find(s=>s.id===id);if(!section)return;
    openModal('编辑章节',field('章节名称','name',section.name,{required:true})+field('章节内容（可分行）','content',draft().otherContent?.[id]??section.content??'',{textarea:true,rows:6}),form=>{
      section.name=form.get('name').trim();if(!section.name)throw new Error('请填写章节名称。');section.content=form.get('content').trim();draft().otherContent ||= {};draft().otherContent[id]=section.content;done();
    });return;
  }
  if(kind==='bullet'){
    const {b}=findBullet(id);if(!b)return;
    openModal('编辑经历要点',field('经历内容','text',draft().overrides[id]??b.text,{textarea:true,rows:6,required:true}),form=>{
      const value=form.get('text').trim();if(!value)throw new Error('请填写经历内容。');b.text=value;delete draft().overrides[id];done();
    });return;
  }
  if(kind==='experience'){
    const e=langData().experiences.find(x=>x.id===id);if(!e)return;const effective={...e,...draft().metaOverrides[id]};
    openModal('编辑经历',field('职位','role',effective.role)+field('公司或项目名称','company',effective.company)+field('时间','dates',effective.dates),form=>{
      for(const k of ['role','company','dates'])e[k]=form.get(k).trim();delete draft().metaOverrides[id];done();
    });return;
  }
  if(kind==='education'){
    const selected=(draft().educationOverride??langData().profile.education).find(e=>e.id===id);if(!selected)return;
    openModal('教育经历',field('学校及地点','school',selected.school,{required:true})+field('学位及补充信息','degree',selected.degree)+field('就读时间','dates',selected.dates),form=>{
      const values=Object.fromEntries(['school','degree','dates'].map(k=>[k,form.get(k).trim()]));
      Object.assign(selected,values);const lib=state.personalLibraries[state.activeLang].education.find(e=>e.id===id);if(lib)Object.assign(lib,values);
      const original=langData().profile.education.find(e=>e.id===id);if(original)Object.assign(original,values);if(!lib)state.personalLibraries[state.activeLang].education.push({id,...values});done();
    });return;
  }
  if(kind==='personal'){
    const current={...langData().profile,...(draft().personalOverride||{})};const keys=['name','phone','email','location','other'];
    const matched=state.personalLibraries[state.activeLang].contacts.filter(c=>keys.every(k=>c[k]===current[k]));
    openModal('个人信息',keys.map((k,i)=>field(['姓名','电话','邮箱','所在城市','其他信息'][i],k,current[k],k==='other'?{textarea:true,rows:3}:{})).join(''),form=>{
      const values=Object.fromEntries(keys.map(k=>[k,form.get(k).trim()]));Object.assign(langData().profile,values);if(draft().personalOverride)Object.assign(draft().personalOverride,values);if(matched.length===1)Object.assign(matched[0],values);else if(!matched.length)state.personalLibraries[state.activeLang].contacts.push({id:uid(),label:currentCareer().name,...values});done();
    });return;
  }
  if(kind==='certificates')editCertificates();
}
function editOther(id){
  const sections=langData().customSections||[],section=sections.find(s=>s.id===id);
  openModal(section?'编辑章节':'新增章节',`${field('章节名称','name',section?.name||'',{required:true})}${field('章节内容（可分行）','content',section?.content||'',{textarea:true,rows:7})}`,form=>{
    const name=form.get('name').trim(),content=form.get('content').trim();if(!name)throw new Error('请填写章节名称。');
    if(sections.some(s=>s.id!==id&&s.name===name))throw new Error('已有同名章节。');
    if(section){Object.assign(section,{name,content});if(draft().otherContent && Object.hasOwn(draft().otherContent,id))draft().otherContent[id]=content;}else sections.push({id:uid(),name,content});
    langData().customSections=sections;done();
  });
}
function editPersonalRecord(type,id){
  const lib=state.personalLibraries[state.activeLang],items=type==='contact'?lib.contacts:lib.education;
  const record=items.find(x=>x.id===id),data=record||{};
  const fields=type==='contact'?[['label','名称'],['name','姓名'],['phone','电话'],['email','邮箱'],['location','所在城市'],['other','其他信息']]:[['school','学校及地点'],['degree','学位及补充信息'],['dates','就读时间']];
  openModal(type==='contact'?'个人信息':'教育经历',fields.map(([k,label])=>field(label,k,data[k]||'',{required:k===(type==='contact'?'label':'school'),textarea:k==='other',rows:3})).join(''),form=>{
    const values=Object.fromEntries(fields.map(([k])=>[k,form.get(k).trim()]));
    if(!values[type==='contact'?'label':'school'])throw new Error('请填写必填项。');
    if(record)Object.assign(record,values);else items.push({id:uid(),...values});done();
  });
}
function choosePersonal(){
  const lib=state.personalLibraries[state.activeLang];
  openModal('选择个人与教育资料',`<p>选择资料后复制到当前简历；不会修改资料库或其他简历。</p><div class="form-field"><label for="contact-choice">个人信息</label><select name="contact" id="contact-choice"><option value="">保持当前个人信息</option>${lib.contacts.map(c=>`<option value="${esc(c.id)}">${esc(c.label)} · ${esc(c.name)}</option>`).join('')}</select></div><h3>教育经历</h3><p>勾选的教育经历将替换当前简历中的教育列表。</p>${lib.education.map(e=>`<label class="check-label"><input type="checkbox" name="education" value="${esc(e.id)}"><span>${esc(e.school)} · ${esc(e.degree)} · ${esc(e.dates)}</span></label>`).join('')||'<p class="muted">资料库中没有教育经历。</p>'}<label class="check-label"><input type="checkbox" name="replace-education">应用所选教育经历</label>`,form=>{
    const contact=lib.contacts.find(c=>c.id===form.get('contact'));
    if(contact)draft().personalOverride=Object.fromEntries(['name','phone','email','location','other'].map(k=>[k,contact[k]||'']));
    if(form.has('replace-education')){const selected=new Set(form.getAll('education'));draft().educationOverride=lib.education.filter(e=>selected.has(e.id)).map(e=>clone(e));delete draft().educationOrder;}
    done('已更新当前简历资料。');
  });
}
function editProfile() {
  const p=clone(langData().profile);
  const body=`<p>基本信息由同语言的简历共用。各份简历可以在排版设置中选择是否显示教育、证书与语言。</p><div class="form-grid">${field('姓名','name',p.name)}${field('电话','phone',p.phone)}${field('邮箱','email',p.email)}${field('所在城市（可留空）','location',p.location)}</div><div class="inline-actions"><h3>教育经历</h3><button type="button" id="add-education" class="quiet small">添加教育经历</button></div><div id="education-fields"></div>${field('证书与语言（每行一项）','certificates',p.certificates,{textarea:true,rows:3})}`;
  openModal('基本信息',body,form=>{
    const education=[...modal.querySelectorAll('.education-entry')].map(el=>({id:el.dataset.id,school:el.querySelector('[name=school]').value.trim(),degree:el.querySelector('[name=degree]').value.trim(),dates:el.querySelector('[name=edu-dates]').value.trim()})).filter(e=>e.school||e.degree||e.dates);
    const certificates=form.get('certificates').trim();
    if(certificates!==p.certificates)for(const d of langData().drafts)delete d.certificateOrder;
    langData().profile={...p,...Object.fromEntries(['name','phone','email','location','other','certificates'].map(k=>[k,form.get(k).trim()])),education};done();
  });
  modal.querySelector('.form-grid').insertAdjacentHTML('beforeend',field('其他信息','other',p.other||'',{textarea:true,rows:3,full:true}));
  translateInterface(modal);
  const addEducation=e=>{
    const div=document.createElement('div');div.className='education-entry';div.dataset.id=e.id;
    div.innerHTML=`${field('学校及地点','school',e.school)}${field('学位及补充信息','degree',e.degree)}${field('就读时间','edu-dates',e.dates)}<button type="button" class="quiet small danger">删除这条教育经历</button>`;
    div.querySelectorAll('input').forEach(input=>{
      const label=div.querySelector(`label[for="${input.id}"]`);
      input.id=`education-${e.id}-${input.name}`;if(label)label.htmlFor=input.id;
    });
    div.querySelector('button').onclick=()=>div.remove();modal.querySelector('#education-fields').append(div);
  };
  p.education.forEach(addEducation);
  modal.querySelector('#add-education').onclick=()=>addEducation({id:uid(),school:'',degree:'',dates:''});
  translateInterface(modal);
}
function categoryCheckboxes(selected=[]) {
  return `<div class="form-field"><div class="category-label-row"><label>所属分类（可多选）</label><button type="button" class="quiet small add-category-inline" data-action="add-category-inline">${icon('plus')}增加分类</button></div><div class="category-checkboxes" data-category-boxes>${state.categories.map(c=>`<label class="check-label"><input type="checkbox" name="categories" value="${esc(c.id)}" ${selected.includes(c.id)?'checked':''}>${esc(c.name)}</label>`).join('')||'<span class="muted">尚无分类，可先增加一个分类。</span>'}</div><div class="category-add-inline hidden" data-category-add-form><input type="text" data-new-category-name placeholder="例如：诉讼方向" maxlength="40" aria-label="新分类名称"><button type="button" class="small primary" data-action="save-category-inline">保存</button><button type="button" class="quiet small" data-action="cancel-category-inline">取消</button></div></div>`;
}

function refreshModalCategories(newId) {
  const boxes=modal.querySelector('[data-category-boxes]');
  if(!boxes)return;
  const selected=new Set([...boxes.querySelectorAll('input[name="categories"]:checked')].map(input=>input.value));
  if(newId)selected.add(newId);
  boxes.innerHTML=state.categories.map(c=>`<label class="check-label"><input type="checkbox" name="categories" value="${esc(c.id)}" ${selected.has(c.id)?'checked':''}>${esc(c.name)}</label>`).join('');
}
function wireCategoryInline() {
  modal.querySelector('[data-action="add-category-inline"]')?.addEventListener('click',()=>{
    const form=modal.querySelector('[data-category-add-form]');form?.classList.remove('hidden');form?.querySelector('[data-new-category-name]')?.focus();
  });
  modal.querySelector('[data-action="cancel-category-inline"]')?.addEventListener('click',()=>modal.querySelector('[data-category-add-form]')?.classList.add('hidden'));
  modal.querySelector('[data-action="save-category-inline"]')?.addEventListener('click',()=>{
    const form=modal.querySelector('[data-category-add-form]'),input=form?.querySelector('[data-new-category-name]'),name=input?.value.trim();
    if(!name){toast('请填写分类名称。');input?.focus();return;}
    if(state.categories.some(c=>c.name===name)){toast('已存在同名分类。');input?.focus();return;}
    const category={id:uid(),name};state.categories.push(category);refreshModalCategories(category.id);input.value='';form.classList.add('hidden');save();toast(`已增加分类“${name}”，并已勾选。`);
  });
}
function findBullet(id) {
  for(const e of langData().experiences){const b=e.bullets.find(b=>b.id===id);if(b)return {e,b};}
  return {};
}
function editBullet(id,mode='library',experienceId) {
  const {e,b}=id?findBullet(id):{e:langData().experiences.find(e=>e.id===experienceId),b:null};
  const original=b?.text||'';
  const text=mode==='draft'?(draft().overrides[id]??original):original;
  openModal(mode==='draft'?'编辑当前简历要点':b?'编辑经历要点':'添加经历要点',`<p>${esc(e.role)} · ${esc(e.company)}<br>${mode==='draft'?'仅修改当前简历，经历库原文不变。':'修改经历库原文。未单独改写的简历将使用更新后的文字。'}</p>${field('经历内容','text',text,{textarea:true,rows:8,required:true})}${mode==='library'?categoryCheckboxes(b?.categories):''}${mode==='draft'&&draft().overrides[id]!==undefined?'<button type="button" id="restore-original" class="quiet small">恢复经历库原文</button>':''}`,form=>{
    const text=form.get('text').trim();if(!text)throw new Error('请填写经历内容。');
    if(mode==='draft'){ if(text===original)delete draft().overrides[id];else draft().overrides[id]=text; }
    else if(b){b.text=text;b.categories=form.getAll('categories');}
    else e.bullets.push({id:uid(),text,categories:form.getAll('categories'),sources:['手动输入']});
    done();
  },{extra:b&&mode==='library'?'<button type="button" class="quiet small danger" id="delete-bullet" style="margin-right:auto">删除要点</button>':''});
  wireCategoryInline();
  modal.querySelector('#restore-original')?.addEventListener('click',()=>{modal.querySelector('[name=text]').value=original;});
  modal.querySelector('#delete-bullet')?.addEventListener('click',()=>confirmModal('删除经历要点','这条要点也会从所有简历中移除。其他要点保持不变。',()=>{
    e.bullets=e.bullets.filter(x=>x.id!==id);for(const d of langData().drafts){d.selected=d.selected.filter(x=>x!==id);delete d.overrides[id];}
  }));
}
function editExperience(id,onlyDraft=false) {
  const original=langData().experiences.find(e=>e.id===id);
  const e=onlyDraft?{...original,...draft().metaOverrides[id]}:original||{role:'',company:'',dates:''};
  openModal(onlyDraft?'编辑当前简历的经历信息':id?'编辑经历':'添加经历',`<p>${onlyDraft?'仅修改当前简历中的职位、公司和时间。':'填写职位、公司和时间。每段经历可以有多个要点。'}</p>${!onlyDraft?`<div class="form-field"><label for="experience-section">所属章节</label><select name="section" id="experience-section">${[{id:'experience',name:'工作经历'},...(langData().customSections||[])].map(s=>`<option value="${esc(s.id)}" ${(e.section||'experience')===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>`:''}${field('职位','role',e.role,{list:'role-alternatives'})}<datalist id="role-alternatives">${[original?.role,...(original?.alternatives||[])].filter(Boolean).map(t=>`<option value="${esc(t)}"></option>`).join('')}</datalist>${field('公司或项目名称','company',e.company)}${field('时间','dates',e.dates)}${!id?field('经历要点（每行一条）','bullets','',{textarea:true,rows:6}):''}`,form=>{
    const fields=Object.fromEntries(['role','company','dates'].map(k=>[k,form.get(k).trim()]));
    if(!Object.values(fields).some(Boolean))throw new Error('请至少填写一项经历信息。');
    if(onlyDraft)draft().metaOverrides[id]=fields;
    else if(original)Object.assign(original,fields,{section:form.get('section')});
    else {const eid=uid();langData().experiences.unshift({id:eid,...fields,section:form.get('section'),alternatives:[],bullets:splitBullets(form.get('bullets')).map(text=>({id:uid(),text,categories:[],sources:['手动输入']}))});for(const d of langData().drafts)d.order.unshift(eid);ui.openCards.add(eid);}
    done();
  },{extra:id&&!onlyDraft?'<button type="button" id="delete-experience" class="quiet small danger" style="margin-right:auto">删除经历</button>':''});
  modal.querySelector('#delete-experience')?.addEventListener('click',()=>confirmModal('删除整段经历','这段经历及所有要点也会从各份简历中移除。建议先下载数据备份。',()=>{
    const ids=new Set(original.bullets.map(b=>b.id));langData().experiences=langData().experiences.filter(e=>e.id!==id);
    for(const d of langData().drafts){d.selected=d.selected.filter(id=>!ids.has(id));d.order=d.order.filter(eid=>eid!==id);for(const bid of ids)delete d.overrides[bid];delete d.metaOverrides[id];}
  }));
}
function sectionsModal(){
  const sections=langData().customSections||[];
  openModal('管理章节',`<p>可添加实习、项目等章节。在经历库的“编辑经历”中选择所属章节。章节顺序可在“调整顺序”中修改。</p><div class="import-review"><strong>基本信息 · 教育经历 · 工作经历 · 证书与语言</strong></div>${sections.map(s=>`<div class="import-review">${field('章节名称',`section-${s.id}`,s.name)}</div>`).join('')}${field('添加新章节','new-section','')}`,form=>{
    for(const s of sections){const name=form.get(`section-${s.id}`).trim();if(!name)throw new Error('章节名称不能为空。');}
    for(const s of sections)s.name=form.get(`section-${s.id}`).trim();
    const name=form.get('new-section').trim();
    if(name){if(sections.some(s=>s.name===name))throw new Error('已有同名章节。');sections.push({id:uid(),name});}
    langData().customSections=sections;done();
  });
}
function copyCareerData(){
  const others=state.careers.filter(c=>c.id!==state.activeCareer);
  if(!others.length){toast('请先创建另一个岗位。');return;}
  openModal('从其他岗位导入',`<div class="form-field"><label for="source-career">选择来源岗位</label><select id="source-career" name="source">${others.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div><p>下一步可以逐项选择。复制后的内容与原岗位独立。</p>`,form=>{
    const source=others.find(c=>c.id===form.get('source'));const l=source.languages[state.activeLang];
    const profileFields=[['name','姓名'],['phone','电话'],['email','邮箱'],['location','所在地'],['certificates','证书与语言']];
    openModal('选择要导入的内容',`<p>来源：${esc(source.name)} · ${state.activeLang==='en'?'英文':'中文'}。基本信息会替换所选字段；其他内容作为副本添加。</p><h3>基本信息</h3>${profileFields.filter(([k])=>l.profile[k]).map(([k,label])=>`<label class="check-label"><input type="checkbox" name="profile" value="${k}">${label}：${esc(l.profile[k])}</label>`).join('')||'<p class="muted">没有可导入的基本信息。</p>'}<h3>教育经历</h3>${l.profile.education.map(e=>`<label class="check-label"><input type="checkbox" name="education" value="${esc(e.id)}"><span>${esc(e.school)} · ${esc(e.degree)}</span></label>`).join('')||'<p class="muted">没有教育经历。</p>'}<h3>工作、实习和其他经历</h3>${l.experiences.map(e=>`<div class="import-review"><strong>${esc(e.role)} · ${esc(e.company)}</strong>${e.bullets.map(b=>`<label class="check-label"><input type="checkbox" name="bullet" value="${esc(b.id)}"><span>${esc(b.text)}</span></label>`).join('')}</div>`).join('')||'<p class="muted">没有经历条。</p>'}`,selected=>{
      const profile=selected.getAll('profile'),education=new Set(selected.getAll('education')),bullets=new Set(selected.getAll('bullet'));
      if(!profile.length&&!education.size&&!bullets.size)throw new Error('请至少选择一项内容。');
      for(const key of profile)langData().profile[key]=l.profile[key];
      for(const item of l.profile.education)if(education.has(item.id))langData().profile.education.push({...clone(item),id:uid()});
      for(const e of l.experiences){
        const picked=e.bullets.filter(b=>bullets.has(b.id));if(!picked.length)continue;
        let section='experience';
        if(e.section && e.section!=='experience'){
          const original=(l.customSections||[]).find(s=>s.id===e.section);
          if(original){langData().customSections ||= [];let target=langData().customSections.find(s=>s.name===original.name);if(!target){target={id:uid(),name:original.name};langData().customSections.push(target);}section=target.id;}
        }
        const entry={...clone(e),id:uid(),section,bullets:picked.map(b=>({...clone(b),id:uid(),categories:[]}))};
        langData().experiences.push(entry);for(const d of langData().drafts)d.order.push(entry.id);
      }
      done('已导入所选内容。');
    },{submit:'导入所选内容',wide:true});
  },{submit:'选择内容'});
}
const splitBullets=text=>String(text||'').split('\n').map(t=>t.replace(/^\s*(?:[•●▪◦·]|[-*]\s|\d+[.)]\s)\s*/, '').trim()).filter(Boolean);
function editCategory(id) {
  const c=state.categories.find(c=>c.id===id);
  openModal(`选择“${esc(c.name)}”的条目`,`<p>勾选后，这些条目会出现在该方向的筛选结果中。这里的操作不会改变当前简历。</p><div class="category-assign-list">${langData().experiences.map(e=>`<h3>${esc(e.role)} · ${esc(e.company)}</h3>${e.bullets.map(b=>`<label class="check-label"><input type="checkbox" name="bullets" value="${esc(b.id)}" ${b.categories.includes(id)?'checked':''}><span>${esc(b.text)}</span></label>`).join('')}`).join('')||'<p class="muted">请先添加经历。</p>'}</div>`,form=>{
    const selected=new Set(form.getAll('bullets'));
    for(const b of allBullets()){b.categories=b.categories.filter(c=>c!==id);if(selected.has(b.id))b.categories.push(id);}done();
  },{wide:true});
}

function batchBullets(id) {
  const experience=langData().experiences.find(e=>e.id===id);
  openModal('批量添加经历条',`<p>${esc(experience.role)} · ${esc(experience.company)}</p><p>每段经历之间空一行；也可使用项目符号区分条目。</p>${field('经历内容','text','',{textarea:true,rows:12,required:true})}`,form=>{
    const entries=splitParagraphs(form.get('text'));
    if(!entries.length)throw new Error('请填写经历内容。');
    if(entries.length>100 || entries.some(t=>t.length>5000))throw new Error('一次最多添加 100 条，每条最多 5000 字。');
    const matches=entries.map(text=>experience.bullets.map(b=>({b,score:similarity(text,b.text)})).filter(m=>m.score>=.9).sort((a,b)=>b.score-a.score));
    openModal('核对批量添加',`<p>共识别 ${entries.length} 条。相似度基于文字计算，请逐条确认。</p>${entries.map((text,i)=>`<div class="import-review"><h3>新经历条 ${i+1}</h3><p>${esc(text)}</p>${matches[i].length?`<p class="error-text">与现有条目相似（${Math.round(matches[i][0].score*100)}%）</p><p>${esc(matches[i][0].b.text)}</p><div class="form-field"><label>如何处理</label><select name="choice-${i}"><option value="existing">保留已有条目</option><option value="new">用新内容替换已有条目</option><option value="both">两条都保留</option></select></div>`:'<p class="muted">将添加为新条目</p>'}</div>`).join('')}`,form=>{
      let added=0,replaced=0;
      entries.forEach((text,i)=>{
        const choice=matches[i].length?form.get(`choice-${i}`):'both';
        if(choice==='existing')return;
        if(choice==='new'){matches[i][0].b.text=text;replaced++;return;}
        experience.bullets.push({id:uid(),text,categories:[],sources:['批量输入']});added++;
      });
      done(`已添加 ${added} 条，替换 ${replaced} 条。`);
    },{submit:'确认添加',wide:true});
  },{submit:'识别并核对',wide:true});
}

function importModal() {
  const en=interfaceLanguage()==='en';
  openModal('导入经历',`<p>Upload a PDF or text file, or paste your resume. Review the extracted information before importing.</p><div class="import-zone"><label for="import-file">${icon('upload')} Choose a resume PDF or text file<input id="import-file" type="file" accept=".pdf,.txt,.md"></label><p>PDF / UTF-8 TXT · Maximum 20 MB</p></div><div class="form-field"><label for="ocr-language">Scanned PDF language</label><input id="ocr-language" value="English" disabled><input type="hidden" name="ocr-language" value="en"><small>Scanned pages are recognized on your device. The first use downloads language files.</small></div><div id="file-status" class="muted" role="status"></div>${field('或粘贴经历文本','text','',{textarea:true,rows:10})}<small>Check the recognized text before importing.</small>`,form=>{
    const text=form.get('text').trim();if(!text)throw new Error('请上传文件或粘贴经历内容。');
    const parsed=parseResume(text);
    if(!parsed.experiences.length)throw new Error('未识别到工作经历。请保留职位、时间、公司和每条要点前的 • 或 -。');
    reviewImport(parsed,modal.dataset.source||'粘贴导入');
  },{submit:'识别并核对',wide:true});
  modal.dataset.source='粘贴导入';
  let controller;
  modal.addEventListener('close',()=>controller?.abort(),{once:true});
  modal.querySelector('#import-file').onchange=async event=>{
    const file=event.target.files[0];if(!file)return;
    controller?.abort();controller=new AbortController();const signal=controller.signal;
    const status=modal.querySelector('#file-status'),submit=modal.querySelector('#modal-submit');
    if(file.size>20*1024*1024){status.textContent='文件不能超过 20 MB。';return;}
    status.textContent=en?'Reading file on this device...':'正在本地读取文件...';submit.disabled=true;
    try {
      const data=file.name.toLowerCase().endsWith('.pdf')?await extractPdf(file,{language:modal.querySelector('#ocr-language').value,signal,onProgress:({page,total,progress})=>{if(!signal.aborted)status.textContent=en?`Recognizing scanned page ${page} of ${total}${Number.isFinite(progress)?` (${Math.round(progress*100)}%)`:''}...`:`正在识别扫描件第 ${page} / ${total} 页${Number.isFinite(progress)?`（${Math.round(progress*100)}%）`:''}...`;}}):{text:await file.text(),usedOcr:false};
      if(signal.aborted)return;
      if(!data.text.trim())throw new Error('未读取到文字，请粘贴经历文本。');
      modal.querySelector('[name=text]').value=data.text;modal.dataset.source=file.name;
      status.textContent=en?`Read ${file.name}${data.usedOcr?' with OCR. Please review the text.':''}`:`已读取 ${file.name}${data.usedOcr?'（文字识别结果请仔细核对）':''}`;
    }catch(error){if(!signal.aborted){status.textContent=en?'Could not read the PDF. Check your connection and try again, or paste the text.':`读取失败，请检查网络后重试或粘贴文字。${error.message}`;status.className='error-text';}}
    finally{if(!signal.aborted)submit.disabled=false;}
  };
}
function reviewImport(parsed,source) {
  const norm=t=>t.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
  const match=e=>langData().experiences.find(x=>{const a=norm(x.company.split('|').at(-1)),b=norm(e.company.split('|').at(-1));return a&&b&&(a===b||a.includes(b)||b.includes(a));});
  const sectionTitle=id=>id==='experience'?'Work Experience':(parsed.customSections||[]).find(s=>`custom:${s.name}`===id)?.name||'Other Experience';
  const workCount=parsed.experiences.filter(e=>(e.section||'experience')==='experience').length;
  const projectCount=parsed.experiences.length-workCount;
  const experienceReviews=Object.entries(Object.groupBy(parsed.experiences,(e)=>e.section||'experience')).map(([section,entries])=>`<section class="review-section"><h2 class="section-name">${esc(sectionTitle(section))}</h2>${entries.map(e=>{
    const i=parsed.experiences.indexOf(e),isProject=section!=='experience',kind=isProject?'Project':'Experience';
    return `<div class="import-review" data-review="${i}"><div class="inline-actions"><h3>${kind} ${entries.indexOf(e)+1}</h3><label class="check-label"><input type="checkbox" name="include-${i}" checked>Import this ${kind.toLowerCase()}</label></div>${field(isProject?'Project name':'Job title',`role-${i}`,e.role)}${field(isProject?'Organization or link':'Company',`company-${i}`,e.company)}${field('Dates',`dates-${i}`,e.dates)}${field(isProject?'Project highlights (one per line)':'Experience highlights (one per line)',`bullets-${i}`,e.bullets.join('\n'),{textarea:true,rows:Math.min(8,Math.max(3,e.bullets.length*2))})}<div class="form-field"><label for="merge-${i}">Add to</label><select name="merge-${i}" id="merge-${i}"><option value="new">Create a new ${kind.toLowerCase()}</option>${langData().experiences.map(x=>`<option value="${esc(x.id)}" ${match(e)?.id===x.id?'selected':''}>Existing entry: ${esc(x.company)}</option>`).join('')}</select></div></div>`;
  }).join('')}</section>`).join('');
  const addProjectControl=`<section class="review-section"><div class="inline-actions"><h2>Other sections</h2><button type="button" class="small" id="add-project-review">${icon('plus')} Add project</button></div><p class="muted">Review projects and other sections below.</p></section>`;
  openModal('核对识别结果',`<div class="parse-note">Found ${workCount} work experiences${projectCount?` and ${projectCount} project${projectCount===1?'':'s'}`:''}, plus ${parsed.education.length} education records. Review each item.</div><div class="import-review"><h3>基本信息</h3><p>勾选需要导入的字段，将替换当前对应内容。</p>${[['name','姓名'],['phone','电话'],['email','邮箱']].map(([key,label])=>`<label class="check-label"><input type="checkbox" name="import-${key}" ${parsed.profile[key]&&!langData().profile[key]?'checked':''}>导入${label}</label>${field(label,`profile-${key}`,parsed.profile[key])}`).join('')}<label class="check-label"><input type="checkbox" name="import-order">按识别的章节顺序排列当前简历</label><p class="muted">${esc(parsed.sectionOrder.join(' → ')||'未识别')}</p></div>${parsed.education.map((e,i)=>`<div class="import-review"><div class="inline-actions"><h3>教育经历 ${i+1}</h3><label class="check-label"><input type="checkbox" name="education-include-${i}" checked>导入这段教育经历</label></div>${field('学校及地点',`education-school-${i}`,e.school)}${field('学位及补充信息',`education-degree-${i}`,e.degree)}${field('就读时间',`education-dates-${i}`,e.dates)}</div>`).join('')}${(parsed.certificateSections||[]).map((section,i)=>`<div class="import-review"><div class="inline-actions"><h3>${esc(section.title)}</h3><label class="check-label"><input type="checkbox" name="certificate-include-${i}" checked>导入证书与语言</label></div>${field('证书与语言（每行一项）',`certificate-content-${i}`,section.content,{textarea:true,rows:4})}</div>`).join('')}${parsed.warnings.length?`<p class="error-text">${parsed.warnings.map(esc).join('；')}</p>`:''}${experienceReviews}${addProjectControl}`,form=>{
    const entries=[];
    parsed.experiences.forEach((_,i)=>{
      if(!form.has(`include-${i}`))return;
      const role=form.get(`role-${i}`).trim(),company=form.get(`company-${i}`).trim(),dates=form.get(`dates-${i}`).trim(),bullets=splitBullets(form.get(`bullets-${i}`));
      if(!role&&!company&&!dates&&!bullets.length)throw new Error(`经历 ${i+1} 为空，请填写内容或取消导入。`);
      entries.push({role,company,dates,bullets,merge:form.get(`merge-${i}`),section:parsed.experiences[i].section||'experience'});
    });
    const importedCertificates=(parsed.certificateSections||[]).flatMap((_,i)=>form.has(`certificate-include-${i}`)?[form.get(`certificate-content-${i}`).trim()].filter(Boolean):[]);
    const education=parsed.education.flatMap((_,i)=>{
      if(!form.has(`education-include-${i}`))return [];
      const item={school:form.get(`education-school-${i}`).trim(),degree:form.get(`education-degree-${i}`).trim(),dates:form.get(`education-dates-${i}`).trim()};
      if(!item.school)throw new Error(`请填写教育经历 ${i+1} 的学校。`);
      return [item];
    });
    const importedSections=(parsed.contentSections||[]).flatMap((s,i)=>form.has(`custom-include-${i}`)?[{name:s.name,content:form.get(`custom-content-${i}`).trim()}]:[]);
    if(!entries.length && !education.length && !importedCertificates.length && !importedSections.length && !form.get('unclassified-content').trim() && !['name','phone','email','other'].some(k=>form.has(`import-${k}`)))throw new Error('请至少选择一段经历或一项基本信息。');
    if(importedCertificates.length){const lines=langData().profile.certificates.split('\n').map(v=>v.trim()).filter(Boolean);for(const item of importedCertificates)for(const line of item.split('\n').map(v=>v.trim()).filter(Boolean))if(!lines.some(v=>norm(v)===norm(line)))lines.push(line);langData().profile.certificates=lines.join('\n');}
    for(const item of education){
      const duplicate=langData().profile.education.some(existing=>norm(existing.school)===norm(item.school) && norm(existing.degree)===norm(item.degree) && norm(existing.dates)===norm(item.dates));
      if(!duplicate)langData().profile.education.push({id:uid(),...item});
      const lib=state.personalLibraries[state.activeLang].education;
      if(!lib.some(existing=>norm(existing.school)===norm(item.school)&&norm(existing.degree)===norm(item.degree)&&norm(existing.dates)===norm(item.dates)))lib.push({id:uid(),...item});
    }
    const importedKeys=['name','phone','email','other'].filter(k=>form.has(`import-${k}`));
    for(const k of importedKeys)langData().profile[k]=form.get(`profile-${k}`).trim();
    if(importedKeys.length){
      if(draft().personalOverride)for(const k of importedKeys)draft().personalOverride[k]=langData().profile[k];
      const p=langData().profile,contact=Object.fromEntries(['name','phone','email','location','other'].map(k=>[k,p[k]||'']));
      const lib=state.personalLibraries[state.activeLang].contacts;
      if(!lib.some(c=>c.label===currentCareer().name&&['name','phone','email','location','other'].every(k=>(c[k]||'')===contact[k])))lib.push({id:uid(),label:currentCareer().name,...contact});
    }
    if(education.length && draft().educationOverride){
      for(const item of education)if(!draft().educationOverride.some(existing=>norm(existing.school)===norm(item.school)&&norm(existing.degree)===norm(item.degree)&&norm(existing.dates)===norm(item.dates)))draft().educationOverride.push({id:uid(),...item});
    }
    langData().customSections ||= [];
    const sectionIds={experience:'experience'};
    for(const section of parsed.customSections||[]){
      if((parsed.contentSections||[]).some(s=>s.name===section.name)&&!importedSections.some(s=>s.name===section.name))continue;
      let existing=langData().customSections.find(s=>s.name.toLocaleLowerCase()===section.name.toLocaleLowerCase());
      if(!existing){existing={id:uid(),name:section.name};langData().customSections.push(existing);}
      const imported=importedSections.find(s=>s.name===section.name);
      if(imported){const previous=existing.content||'';existing.content=previous&&imported.content&&!previous.includes(imported.content)?`${previous}\n${imported.content}`:previous||imported.content;draft().otherContent ||= {};draft().otherContent[existing.id]=existing.content;}
      sectionIds[`custom:${section.name}`]=existing.id;
    }
    if(parsed.sectionOrder.length && (form.has('import-order') || !draft().sectionOrder))draft().sectionOrder=parsed.sectionOrder.filter(id=>!id.startsWith('custom:')||sectionIds[id]).map(id=>sectionIds[id]||id);
    const extraText=form.get('unclassified-content').trim();
    if(extraText){const section={id:uid(),name:interfaceLanguage()==='en'?'Untitled content':'无标题内容',untitled:true,content:extraText};langData().customSections.push(section);draft().otherContent ||= {};draft().otherContent[section.id]=extraText;const order=orderedKeys(draft().sectionOrder,[...SECTIONS,...langData().customSections.map(s=>s.id)]).filter(id=>id!==section.id);const position=order.indexOf(sectionIds[form.get('unclassified-position')]||form.get('unclassified-position'));order.splice(position<0?order.length:position+1,0,section.id);draft().sectionOrder=order;}
    let added=0;
    for(const item of entries){
      let e=langData().experiences.find(e=>e.id===item.merge);
      if(!e){e={id:uid(),role:item.role,company:item.company,dates:item.dates,section:sectionIds[item.section]||'experience',alternatives:[],bullets:[]};langData().experiences.push(e);for(const d of langData().drafts)d.order.push(e.id);}
      for(const text of item.bullets){
        let bullet=e.bullets.find(b=>norm(b.text)===norm(text));
        if(!bullet){bullet={id:uid(),text,categories:[],sources:[source]};e.bullets.push(bullet);added++;}
        if(!draft().selected.includes(bullet.id))draft().selected.push(bullet.id);
      }
      if(!e.bullets.length){draft().selectedExperiences ||= [];if(!draft().selectedExperiences.includes(e.id))draft().selectedExperiences.push(e.id);}
      draft().hiddenSections=(draft().hiddenSections||[]).filter(id=>id!==(e.section||'experience'));
      ui.openCards.add(e.id);
    }
    done(`导入完成，新增 ${added} 条要点。`);
  },{submit:'确认加入经历库',wide:true});
  modal.querySelector('#add-project-review')?.addEventListener('click',()=>{
    let section=(parsed.customSections||[]).find(s=>/project/i.test(s.name));
    if(!section){section={name:'Projects'};(parsed.customSections ||= []).push(section);parsed.sectionOrder ||= [];if(!parsed.sectionOrder.includes('custom:Projects'))parsed.sectionOrder.push('custom:Projects');}
    parsed.experiences.push({role:'',company:'',dates:'',bullets:[],section:`custom:${section.name}`});
    reviewImport(parsed,source);
  });
  const reviews=(parsed.contentSections||[]).map((section,i)=>`<div class="import-review"><div class="inline-actions"><h3 class="section-name">${esc(section.name)}</h3><label class="check-label"><input type="checkbox" name="custom-include-${i}" checked>${interfaceLanguage()==='en'?'Import section':'导入此章节'}</label></div>${field(interfaceLanguage()==='en'?'Section content':'章节内容',`custom-content-${i}`,section.content,{textarea:true,rows:6})}</div>`).join('');
  modal.querySelector('.modal-body').insertAdjacentHTML('beforeend',reviews);
  const en=interfaceLanguage()==='en';
  modal.querySelector('.import-review').insertAdjacentHTML('beforeend',`<label class="check-label"><input type="checkbox" name="import-other" ${parsed.profile.other&&!langData().profile.other?'checked':''}>${en?'Import other personal details':'导入其他个人信息'}</label>${field(en?'Other personal details':'其他个人信息','profile-other',parsed.profile.other||'',{textarea:true,rows:3})}`);
  modal.querySelector('.modal-body').insertAdjacentHTML('beforeend',`<div class="import-review"><h3>${en?'Unclassified content':'未分类内容'}</h3>${field(en?'Untitled content':'无标题内容','unclassified-content','',{textarea:true,rows:3})}<label for="unclassified-position">${en?'Place after':'放在以下章节之后'}</label><select id="unclassified-position" name="unclassified-position">${parsed.sectionOrder.map(id=>`<option value="${esc(id)}">${esc(id.replace(/^custom:/,''))}</option>`).join('')}</select></div><details class="import-review"><summary>${en?'View extracted text':'查看提取的原文'}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(parsed.sourceText||'')}</pre></details>`);
}
function download(blob,filename) {
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function backup() { download(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),`resume-backup-${new Date().toISOString().slice(0,10)}.json`);toast('备份已下载，包含中英文经历库和所有简历。'); }
function accountModal(){
  if(!cloud?.enabled)return;
  const conflict=cloud.conflict;
  openModal('账户与同步',`<p>登录账号：${esc(cloud.user?.email || '登录已过期')}<br>当前状态：${esc(cloud.label)}</p>${conflict?'<div class="notice">另一台设备的资料也有更新。请先下载本机备份，再选择保留哪个版本，避免覆盖你需要的修改。</div><div class="account-actions"><button type="button" id="sync-backup">下载本机备份</button><button type="button" id="use-cloud">使用云端版本</button><button type="button" id="use-local">使用本机版本</button></div>':`<p>${cloud.status==='expired'?'请重新登录，本机未同步的修改会保留。':'同一账号登录后会读取云端资料。离线修改先保存在本机，恢复网络后继续同步。'}</p><div class="account-actions"><button type="button" id="sync-now">立即同步</button><button type="button" id="sync-backup">下载数据备份</button><button type="button" id="logout">保存后退出登录</button>${cloud.status==='expired'?'<button type="button" id="relogin">重新登录</button>':''}</div>`}<p class="muted" style="margin-top:18px">从原来的本机网站迁移：先在原网站下载备份，再在这里使用“恢复备份”，即可把最近的编辑同步到其他设备。</p>${cloud.lastError?`<p class="error-text">${esc(cloud.lastError)}</p>`:''}`,null);
  modal.querySelector('#sync-backup').onclick=backup;
  modal.querySelector('#sync-now')?.addEventListener('click',async()=>{modal.close();await cloud.refresh();accountModal();});
  modal.querySelector('#logout')?.addEventListener('click',async()=>{try{await cloud.logout();}catch(error){toast(error.message);}});
  modal.querySelector('#relogin')?.addEventListener('click',()=>location.reload());
  for(const [id,choice,label] of [['use-cloud','remote','云端'],['use-local','local','本机']]){
    modal.querySelector(`#${id}`)?.addEventListener('click',()=>openModal(`使用${label}版本`,`<p>确认使用${label}版本作为最新资料吗？另一版本不会与它自动合并；请先下载需要保留的数据备份。</p>`,async()=>{
      await cloud.resolve(choice);modal.close();render();toast('版本已确认，已同步。');
    },{submit:'确认使用'}));
  }
}
function restore() {
  openModal('恢复数据备份','<p>选择之前下载的 JSON 备份。确认恢复后，会替换当前浏览器中的中英文经历库、分类和简历。</p><div class="form-field"><label for="restore-file">备份文件</label><input type="file" id="restore-file" accept=".json" required></div><p class="muted">建议先关闭此窗口，下载当前数据的备份，再进行恢复。</p>',async()=>{
    const file=modal.querySelector('#restore-file').files[0];if(!file)throw new Error('请选择备份文件。');
    if(file.size>20*1024*1024)throw new Error('备份文件不能超过 20 MB。');
    let data;try{data=JSON.parse(await file.text());}catch{throw new Error('备份不是有效的 JSON 文件。');}
    if(!validState(data))throw new Error('备份结构不完整，未修改当前数据。');
    confirmModal('确认恢复备份','将用所选备份替换当前全部数据。',()=>{state=data;migrateState(state);if(!state.careers){state.careers=[{id:'career-initial',name:'我的职业',categories:state.categories,languages:state.languages}];state.activeCareer='career-initial';}activateCareer(state.activeCareer);ensurePersonalLibraries();ui.category='all';ui.search='';ui.tab='library';});
  },{submit:'读取备份'});
}
async function renderResumeCanvas() {
  const page=document.querySelector('#resume-preview');
  if(!page)throw new Error('找不到简历预览。');
  const css=await fetch('./resume.css?v=20261109-2').then(response=>response.text());
  const markup=`<div xmlns="http://www.w3.org/1999/xhtml" class="${esc(page.className)}" style="--resume-font:${ui.font||draft().fontSize}px;--resume-line-height:${ui.lineHeight??draft().lineHeight??1.16};width:816px;height:1056px;overflow:hidden"><style>${css}</style>${resumeMarkup()}</div>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xhtml="http://www.w3.org/1999/xhtml" width="816" height="1056" viewBox="0 0 816 1056"><foreignObject width="816" height="1056">${markup}</foreignObject></svg>`;
  const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
  try {
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('无法生成简历图片，请使用打印导出。'));img.src=url;});
    const canvas=document.createElement('canvas'),scale=2;canvas.width=816*scale;canvas.height=1056*scale;
    const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);return canvas;
  } finally {URL.revokeObjectURL(url);}
}
function canvasBlob(canvas,type,quality){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('无法生成图片文件。')),type,quality));}

async function downloadTextPdf() {
  if(!window.jspdf)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='./vendor/jspdf/jspdf.umd.min.js';script.onload=resolve;script.onerror=()=>reject(new Error('Could not load the PDF exporter.'));document.head.append(script);});
  await document.fonts.ready;refreshPreview();
  if(!ui.fits)throw new Error('Content exceeds one page. Reduce content before exporting.');
  const page=document.querySelector('#resume-preview'),rect=page.getBoundingClientRect(),scale=rect.width/816;
  const response=await fetch('./vendor/fonts/NotoSans-Regular.ttf');if(!response.ok)throw new Error('Could not load the PDF font.');
  const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const pdf=new window.jspdf.jsPDF({unit:'pt',format:'letter',compress:true});pdf.addFileToVFS('NotoSans.ttf',btoa(binary));pdf.addFont('NotoSans.ttf','NotoSans','normal');pdf.setFont('NotoSans');
  const walker=document.createTreeWalker(page,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){
    const parent=node.parentElement;if(!parent || !node.nodeValue.trim())continue;
    const style=getComputedStyle(parent),size=parseFloat(style.fontSize),color=style.color.match(/[\d.]+/g)||[0,0,0];pdf.setFontSize(size*.75);pdf.setTextColor(Number(color[0]),Number(color[1]),Number(color[2]));
    const pattern=/\S+/gu;let match;while((match=pattern.exec(node.nodeValue))){const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);const bounds=range.getBoundingClientRect();if(!bounds.width)continue;const text=style.textTransform==='uppercase'?match[0].toLocaleUpperCase():match[0];pdf.text(text,(bounds.left-rect.left)/scale*.75,((bounds.top-rect.top)/scale+size*.86)*.75);}
  }
  for(const li of page.querySelectorAll('.resume-bullets li')){const bounds=li.getBoundingClientRect(),size=parseFloat(getComputedStyle(li).fontSize);pdf.setFontSize(size*.75);pdf.setTextColor(0,0,0);pdf.text('•',(bounds.left-rect.left)/scale*.75-8,((bounds.top-rect.top)/scale+size*.86)*.75);}
  pdf.save('resume.pdf');
}
function exportModal() {
  refreshPreview();
  if(!ui.fits){toast('内容超出一页。请减少条目或调整排版后导出。');return;}
  openModal('Export resume','<p>Download your resume as a PDF or JPEG.</p><div class="export-buttons"><button type="button" class="primary" id="export-pdf">Download PDF</button><button type="button" id="export-jpg">Download JPEG</button></div><button type="button" class="quiet small" id="print-resume">Use print dialog</button>',null);
  modal.querySelector('#export-pdf').onclick=async()=>{const button=modal.querySelector('#export-pdf');button.disabled=true;try{await downloadTextPdf();modal.close();toast('PDF downloaded.');}catch(error){button.disabled=false;toast(error.message||'Could not export PDF.');}};
  modal.querySelector('#print-resume').onclick=()=>{modal.close();requestAnimationFrame(()=>requestAnimationFrame(()=>window.print()));};
  modal.querySelector('#export-jpg').onclick=async()=>{const button=modal.querySelector('#export-jpg');button.disabled=true;try{const canvas=await renderResumeCanvas();download(await canvasBlob(canvas,'image/jpeg',.95),'resume.jpg');modal.close();toast('JPEG downloaded.');}catch(error){button.disabled=false;toast('Image export is unavailable in this browser. Try Chrome or Edge.');}};
}

app.addEventListener('pointermove',event=>{
  const wrap=event.target.closest('#paper-wrap');if(!wrap || event.pointerType==='touch')return;
  wrap.style.setProperty('--hint-x',`${Math.max(8,Math.min(event.clientX+16,innerWidth-180))}px`);
  wrap.style.setProperty('--hint-y',`${Math.max(8,Math.min(event.clientY+18,innerHeight-48))}px`);
});
app.addEventListener('keydown',event=>{
  if(event.target.id==='paper-wrap' && ['Enter',' '].includes(event.key)){
    event.preventDefault();reorderModal();
  }
});
app.addEventListener('input',event=>{
  if(event.target.id!=='search')return;
  ui.search=event.target.value;
  const list=document.querySelector('#selection-list'),grid=document.querySelector('#library-grid');
  if(list){list.innerHTML=selectionList();translateInterface(list);}if(grid){grid.innerHTML=libraryCards();translateInterface(grid);}
});
app.addEventListener('change',event=>{
  const target=event.target;
  if(target.hasAttribute('data-sort-alpha')){ui.alphabetical=target.checked;render();}
  else if(target.dataset.select){
    const id=target.dataset.select;
    draft().selected=target.checked?[...new Set([...draft().selected,id])]:draft().selected.filter(x=>x!==id);
    save();render();
  }else if(target.id==='career-select'){activateCareer(target.value);ui.search='';ui.category='all';ui.tab='library';save();render();}
  else if(target.id==='draft-select'){langData().activeDraft=target.value;save();render();}
});
app.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  const {action,id,mode}=button.dataset;
  if(action==='navigate'){ui.route=id;ui.search='';ui.category='all';render();location.hash=id;}
  else if(action==='tab'){ui.tab=id;render();}
  else if(action==='filter'){ui.category=id;render();}
  else if(action==='profile')editProfile();
  else if(action==='new-other')editOther();
  else if(action==='edit-certificates')editCertificates();
  else if(action==='use-certificates'){draft().showCertificates=true;draft().hiddenSections=(draft().hiddenSections||[]).filter(id=>id!=='certificates');save();render();toast('已加入当前简历。');}
  else if(action==='edit-other')editOther(id);
  else if(action==='use-other'){
    const section=(langData().customSections||[]).find(s=>s.id===id);
    draft().otherContent ||= {};draft().otherContent[id]=section.content||'';
    draft().hiddenSections=(draft().hiddenSections||[]).filter(x=>x!==id);save();render();toast('已加入当前简历。');
  }
  else if(action==='new-contact')editPersonalRecord('contact');
  else if(action==='edit-contact')editPersonalRecord('contact',id);
  else if(action==='new-education')editPersonalRecord('education');
  else if(action==='edit-education')editPersonalRecord('education',id);
  else if(action==='choose-personal')choosePersonal();
  else if(action==='sections')sectionsModal();
  else if(action==='reorder')reorderModal();
  else if(action==='preview-reorder'){
    const wrap=event.target.closest('#paper-wrap'),selection=window.getSelection();
    if(wrap && selection && !selection.isCollapsed && wrap.contains(selection.anchorNode))return;
    if(wrap){
      const special=event.target.closest('[data-preview-edit]');if(special){editFromPreview(special.dataset.previewEdit,special.dataset.previewId);return;}
      if(event.target.closest('.resume-header')){editFromPreview('personal');return;}
      const entry=event.target.closest('[data-preview-sort]');
      if(entry?.dataset.previewSort==='education'){editFromPreview('education',entry.dataset.previewKey);return;}
      if(entry?.dataset.previewSort?.startsWith('bullets-')){editFromPreview('bullet',entry.dataset.previewKey);return;}
      if(entry?.dataset.previewSort==='experiences'){editFromPreview('experience',entry.dataset.previewKey);return;}
      if(entry?.dataset.previewSort==='certificates'){editFromPreview('certificates');return;}
      if(entry?.dataset.previewSort==='sections' && entry.dataset.previewKey==='certificates'){editFromPreview('certificates');return;}
      if(entry?.dataset.previewSort==='sections' && (langData().customSections||[]).some(s=>s.id===entry.dataset.previewKey)){editFromPreview('other',entry.dataset.previewKey);return;}
    }
    const entry=event.target.closest('[data-preview-sort]');
    reorderModal(entry?{group:entry.dataset.previewSort,key:entry.dataset.previewKey}:undefined);
  }
  else if(action==='import')importModal();
  else if(action==='layout')editLayout();
  else if(action==='add-project')addProject();
  else if(action==='new-experience')editExperience();
  else if(action==='edit-experience')editExperience(id);
  else if(action==='edit-draft-meta')editExperience(id,true);
  else if(action==='edit-bullet')editBullet(id,mode);
  else if(action==='new-bullet')editBullet(null,'library',id);
  else if(action==='batch-bullets')batchBullets(id);
  else if(action==='add-category-inline'){
    const form=modal.querySelector('[data-category-add-form]');form?.classList.remove('hidden');
    form?.querySelector('[data-new-category-name]')?.focus();
  }
  else if(action==='cancel-category-inline')modal.querySelector('[data-category-add-form]')?.classList.add('hidden');
  else if(action==='save-category-inline'){
    const form=modal.querySelector('[data-category-add-form]'),input=form?.querySelector('[data-new-category-name]'),name=input?.value.trim();
    if(!name){toast('请填写分类名称。');input?.focus();return;}
    if(state.categories.some(c=>c.name===name)){toast('已存在同名分类。');input?.focus();return;}
    const category={id:uid(),name};state.categories.push(category);refreshModalCategories(category.id);input.value='';form.classList.add('hidden');save();toast(`已增加分类“${name}”，并已勾选。`);
  }
  else if(action==='select-experience'){const e=langData().experiences.find(x=>x.id===id);const ids=e.bullets.filter(b=>filterBullet(e,b)).map(b=>b.id);if(!e.bullets.length){draft().selectedExperiences ||= [];draft().selectedExperiences=draft().selectedExperiences.includes(id)?draft().selectedExperiences.filter(x=>x!==id):[...draft().selectedExperiences,id];}else if(ids.length){const all=ids.every(x=>draft().selected.includes(x));draft().selected=all?draft().selected.filter(x=>!ids.includes(x)):[...new Set([...draft().selected,...ids])];}save();render();}
  else if(action==='rename-career')askName('修改职业名称',currentCareer().name,name=>currentCareer().name=name);
  else if(action==='new-career')askName('新增岗位','',name=>{const base=clone(SEED);const c={id:uid(),name,categories:base.categories,languages:base.languages};state.careers.push(c);activateCareer(c.id);ui.search='';ui.category='all';ui.tab='library';});
  else if(action==='delete-career'){
    if(state.careers.length<2){toast(interfaceLanguage()==='en'?'Keep at least one career.':'请至少保留一个岗位。');return;}
    const name=currentCareer().name,id=state.activeCareer,en=interfaceLanguage()==='en';
    confirmModal(en?'Delete career':'删除岗位',en?`Delete “${name}” and its resumes, experiences and categories? Personal and education library records are kept.`:`删除“${name}”及其简历、经历和分类？个人信息和教育资料库中的记录会保留。`,()=>{state.careers=state.careers.filter(c=>c.id!==id);activateCareer(state.careers[0].id);ui.search='';ui.category='all';ui.tab='library';});
  }
  else if(action==='new-draft')askName('新增简历','',name=>{const d={...clone(SEED.languages[state.activeLang].drafts[0]),id:uid(),name,order:langData().experiences.map(e=>e.id)};langData().drafts.push(d);langData().activeDraft=d.id;});
  else if(action==='copy-career-data')copyCareerData();
  else if(action==='remove-bullet'){draft().selected=draft().selected.filter(x=>x!==id);save();render();}
  else if(action==='clear-selection')confirmModal('清空当前简历的经历选择','只清空当前简历的勾选，经历库与其他简历保持不变。',()=>{draft().selected=[];draft().selectedExperiences=[];});
  else if(action==='rename-draft')askName('修改简历名称',draft().name,name=>draft().name=name);
  else if(action==='copy-draft')askName('另存一份简历',`${draft().name} 副本`,name=>{const d={...clone(draft()),id:uid(),name};langData().drafts.push(d);langData().activeDraft=d.id;});
  else if(action==='delete-draft')confirmModal('删除当前简历','经历库与其他简历保持不变。',()=>{langData().drafts=langData().drafts.filter(d=>d.id!==draft().id);langData().activeDraft=langData().drafts[0].id;});
  else if(action==='new-category')askName('新建分类','',name=>{if(state.categories.some(c=>c.name===name))throw new Error('已存在同名分类。');state.categories.push({id:uid(),name});});
  else if(action==='rename-category')askName('修改分类名称',categoryName(id),name=>{if(state.categories.some(c=>c.id!==id&&c.name===name))throw new Error('已存在同名分类。');state.categories.find(c=>c.id===id).name=name;});
  else if(action==='delete-category')confirmModal('删除分类','只移除分类，分类中的经历要点仍保留在经历库中。',()=>{state.categories=state.categories.filter(c=>c.id!==id);for(const l of Object.values(state.languages))for(const e of l.experiences)for(const b of e.bullets)b.categories=b.categories.filter(c=>c!==id);if(ui.category===id)ui.category='all';});
  else if(action==='assign-category')editCategory(id);
  else if(action==='backup')backup();
  else if(action==='account')accountModal();
  else if(action==='restore')restore();
  else if(action==='export')exportModal();
  else if(action==='move-experience'){
    const groups=orderedExperiences(),index=groups.findIndex(e=>e.id===id),other=groups[index+Number(button.dataset.direction)];
    if(other){const ids=groups.map(e=>e.id),i=ids.indexOf(id),j=ids.indexOf(other.id);[ids[i],ids[j]]=[ids[j],ids[i]];draft().order=[...ids,...langData().experiences.map(e=>e.id).filter(id=>!ids.includes(id))];save();render();}
  }else if(action==='move-bullet'){
    const {e}=findBullet(id),ids=draft().selected.filter(id=>e.bullets.some(b=>b.id===id)),i=ids.indexOf(id),other=ids[i+Number(button.dataset.direction)];
    if(other){const a=draft().selected.indexOf(id),b=draft().selected.indexOf(other);[draft().selected[a],draft().selected[b]]=[draft().selected[b],draft().selected[a]];save();render();}
  }
});
window.addEventListener('hashchange',()=>{
  const route=location.hash.slice(1);if(['editor','library','personal','education','other','categories'].includes(route)&&ui.route!==route){ui.route=route;ui.search='';ui.category='all';render();}
});
if(['editor','library','personal','education','other','categories'].includes(location.hash.slice(1)))ui.route=location.hash.slice(1);
if(!initialError)save();
editorReady=true;
render();
if(initialError)toast(initialError);
