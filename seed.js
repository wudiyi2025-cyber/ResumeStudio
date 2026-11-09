const profile = () => ({name:'',phone:'',email:'',location:'',education:[],certificates:''});
const language = (id,name) => ({profile:profile(),experiences:[],drafts:[{id,name,selected:[],order:[],overrides:{},metaOverrides:{},showEducation:true,showCertificates:true,fontSize:13.4,autoFit:true,accent:'blue'}],activeDraft:id});
export const SEED = {schemaVersion:1,contentVersion:2,activeLang:'en',categories:[],languages:{en:language('draft-en-1','My Resume')}};
