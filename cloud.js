const META='resume-cloud-sync-v1';
const CACHE='resume-studio-v1';

export class CloudSync {
  constructor({getState,applyState,validate,onChange,canApply,hasLocalData}){
    Object.assign(this,{getState,applyState,validate,onChange,canApply,hasLocalData});
    this.enabled=false;this.status='loading';this.revision=0;this.pending=false;this.sequence=0;this.busy=false;this.conflict=false;this.lastError='';
  }
  get label(){return {loading:'正在读取云端资料',syncing:'正在同步',synced:'云端已同步',offline:'已保存在本机，等待同步',conflict:'同步冲突，点击处理',expired:'登录已过期，修改已保存在本机'}[this.status] || '云端同步';}
  notify(status,error=''){this.status=status;this.lastError=error;this.onChange?.();}
  metadata(){
    localStorage.setItem(META,JSON.stringify({accountId:this.user.id,email:this.user.email,revision:this.revision,pending:this.pending}));
  }
  async request(url,options={}){
    const response=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});
    const data=await response.json();
    if(response.status===401){this.notify('expired');throw new Error('登录已过期，请重新登录。');}
    if(!response.ok && response.status!==409)throw new Error(data.error || '云端暂时不可用。');
    return {data,conflict:response.status===409};
  }
  async start(){
    let session;
    try{
      const response=await fetch('/api/session');
      if(response.status===404)return;
      if(!response.ok)throw new Error('暂时无法读取登录状态。');
      session=await response.json();
    }catch{
      let meta;try{meta=JSON.parse(localStorage.getItem(META)||'null');}catch{}
      if(meta?.accountId){this.enabled=true;this.user={id:meta.accountId,email:meta.email};this.revision=meta.revision;this.pending=!!meta.pending;this.notify('offline');this.watch();}
      return;
    }
    if(!session.cloud)return;
    this.enabled=true;this.user=session.user;
    if(!session.authenticated){this.notify('expired');return;}
    let meta;
    try{meta=JSON.parse(localStorage.getItem(META)||'null');}catch{}
    this.revision=meta?.accountId===this.user.id?meta.revision:0;
    this.pending=!!meta?.pending;
    try{
      const {data}=await this.request('/api/state');
      if(data.state && !this.validate(data.state))throw new Error('云端数据格式有误，未替换本机资料。');
      if(!data.state){this.revision=0;this.pending=true;this.metadata();await this.flush();}
      else if(this.hasLocalData && (!meta || meta.accountId!==this.user.id || (this.pending && this.revision!==data.revision))){
        this.conflict=true;this.pending=true;this.metadata();this.notify('conflict');
      }else if(this.pending){await this.flush();}
      else{this.accept(data);}
    }catch(error){if(this.status!=='expired')this.notify('offline',error.message);}
    this.watch();
  }
  watch(){
    if(this.timer)return;
    this.timer=setInterval(()=>this.refresh(),12000);
    window.addEventListener('online',()=>this.refresh());
    window.addEventListener('focus',()=>this.refresh());
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)this.refresh();});
    window.addEventListener('beforeunload',event=>{if(this.pending){event.preventDefault();event.returnValue='';}});
  }
  accept(data){
    this.applyState(data.state);this.revision=data.revision;this.pending=false;this.conflict=false;this.metadata();this.notify('synced');
  }
  schedule(){
    if(!this.enabled || !this.user)return;
    this.sequence++;this.pending=true;
    try{this.metadata();}catch{}
    if(this.conflict){this.notify('conflict');return;}
    this.notify('syncing');clearTimeout(this.debounce);this.debounce=setTimeout(()=>this.flush(),600);
  }
  async flush(){
    if(!this.enabled || this.busy || this.conflict || !this.pending || !this.user)return;
    this.busy=true;const sequence=this.sequence;
    this.notify('syncing');
    try{
      const {data,conflict}=await this.request('/api/state',{method:'PUT',body:JSON.stringify({revision:this.revision,state:this.getState()})});
      if(conflict){this.conflict=true;this.notify('conflict');return;}
      this.revision=data.revision;
      this.pending=this.sequence!==sequence;
      this.metadata();this.notify(this.pending?'syncing':'synced');
    }catch(error){if(this.status!=='expired')this.notify('offline',error.message);}
    finally{
      this.busy=false;
      if(this.pending && !this.conflict && this.status==='syncing')this.debounce=setTimeout(()=>this.flush(),200);
    }
  }
  async refresh(){
    if(!this.enabled || this.busy || this.conflict || !this.user || document.hidden || !this.canApply())return;
    if(this.pending){await this.flush();return;}
    this.busy=true;
    try{
      const {data}=await this.request('/api/state');
      if(data.state && !this.validate(data.state))throw new Error('云端数据格式有误。');
      // A local edit could have happened while this request was in flight.
      if(this.pending || !this.canApply())return;
      if(data.state && data.revision!==this.revision)this.accept(data);
      else this.notify('synced');
    }catch(error){if(this.status!=='expired')this.notify('offline',error.message);}
    finally{this.busy=false;}
  }
  async resolve(choice){
    if(this.busy)throw new Error('正在同步，请稍后重试。');
    const {data}=await this.request('/api/state');
    if(data.state && !this.validate(data.state))throw new Error('云端数据格式有误。');
    if(choice==='remote'){
      if(!data.state)throw new Error('云端还没有资料，请选择保留本机版本。');
      this.accept(data);
    }else{
      this.revision=data.revision;this.conflict=false;this.pending=true;this.metadata();await this.flush();
      if(this.pending)throw new Error(this.conflict?'另一台设备刚刚更新，请重新确认版本。':'尚未同步成功，请稍后重试。');
    }
  }
  async logout(){
    await this.flush();
    if(this.pending)throw new Error('还有未同步的修改，请先处理同步状态或下载备份。');
    await this.request('/api/logout',{method:'POST',body:'{}'});
    localStorage.removeItem(META);localStorage.removeItem(CACHE);location.reload();
  }
}
