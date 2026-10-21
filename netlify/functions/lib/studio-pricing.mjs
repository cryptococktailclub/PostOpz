// Shared server-side pricing and review plan for the founding pilot.
// These are indicative prices. No vendor billing or provisioning is authorized here.
export const TIERS=Object.freeze({
  essential:{label:"Essential",monthly:599,hours:40,ramGB:32,storageTB:.5,onboarding:299,extraHourUSD:4.5,iconik:"Standard"},
  production:{label:"Production",monthly:1499,hours:160,ramGB:32,storageTB:2,onboarding:299,extraHourUSD:4.5,iconik:"Standard"},
  studio:{label:"Studio",monthly:2999,hours:200,ramGB:64,storageTB:5,onboarding:499,extraHourUSD:7.5,iconik:"Power"}
});
export const SUPPORTED_EXTRA_HOURS=Object.freeze([0,20,40,80]);
export const SUPPORTED_EXTRA_STORAGE=Object.freeze([0,1,2,3]);
export function quoteConfiguration({tier,monthlyGpuHours,sharedStorageTB,workflow}){
  const key=String(tier||"").toLowerCase();
  const plan=TIERS[key];
  if(!plan)throw new Error("Unknown bay configuration");
  const gpuHours=Number(monthlyGpuHours);
  const storageTB=Number(sharedStorageTB);
  const additionalHours=gpuHours-plan.hours;
  const additionalStorage=storageTB-plan.storageTB;
  if(!SUPPORTED_EXTRA_HOURS.includes(additionalHours))throw new Error("Invalid GPU hour selection");
  if(!SUPPORTED_EXTRA_STORAGE.includes(additionalStorage))throw new Error("Invalid shared storage selection");
  const customized=workflow==="Custom standards requested"||workflow==="custom";
  if(!customized&&workflow!=="PostOpz Framework"&&workflow!=="framework")throw new Error("Invalid workflow standard");
  const monthlyUSD=plan.monthly+additionalHours*plan.extraHourUSD+additionalStorage*149;
  const onboardingUSD=plan.onboarding+(customized?249:0);
  return {
    schemaVersion:"studio-pilot-v1",
    tier:key,label:plan.label,workstation:{ramGB:plan.ramGB,gpuHoursPerMonth:gpuHours},
    media:{sharedStorageTB:storageTB,assetManagement:"iconik "+plan.iconik},
    workflow:customized?"customer-custom":"postopz-framework",
    estimate:{currency:"USD",monthlyUSD,onboardingUSD,finalQuoteRequired:true},
    providerStatus:{workstation:"credentials-required",lucidlink:"credentials-required",iconik:"credentials-required",editorLicensing:"customer-confirmation-required"},
    limitations:["Indicative pricing only; no infrastructure purchase initiated.","Premiere Pro is the initial pilot target; NLE compatibility must be confirmed.","Compute is metered; standby and overage policies require customer approval.","Ingest, egress, backup, archival storage and software licenses require scoping."],
    preflight:[
      {id:"pricing",label:"Validate vendor costs and final quote",required:true},
      {id:"contract",label:"Customer accepts formal scope and billing terms",required:true},
      {id:"license",label:"Confirm NLE and plugin licensing",required:true},
      {id:"machine",label:"Confirm vendor plan ID, GPU type, region and base image",required:true},
      {id:"media",label:"Confirm media available, storage access, permissions and ingest",required:true},
      {id:"mam",label:"Confirm iconik user and collection mapping",required:true},
      {id:"security",label:"Approve customer segregation, MFA and access policy",required:true},
      {id:"backup",label:"Define backups, retention, egress, archive and recovery",required:true},
      {id:"playback",label:"Validate codec playback, audio, mounts and export",required:true},
      {id:"handoff",label:"Document workstation handoff and usage limits",required:true}
    ]
  };
}
export function buildInquiry(data){
  if(!data||data.source!=="PostOpz Virtual Edit Studio landing page")return null;
  const clean=(value,max=500)=>String(value??"").trim().slice(0,max);
  const email=clean(data.email,200).toLowerCase();
  if(!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error("Invalid email");
  const name=clean(data.name,120);
  if(!name)throw new Error("Missing name");
  const quote=quoteConfiguration({
    tier:data.selected_tier,monthlyGpuHours:data.monthly_gpu_hours,
    sharedStorageTB:data.shared_storage_tb,workflow:data.requested_workflow
  });
  const nle=clean(data.nle,40)||"unspecified";
  const mediaReady=clean(data.media_readiness,60)||"unspecified";
  const editorCount=clean(data.editor_count,15)||"unspecified";
  const date=clean(data.start_window,50)||"unspecified";
  return {
    customer:{name,email,company:clean(data.company,160),projectDetails:clean(data.project_details,1800)},
    intake:{targetStart:date,nle,mediaReadiness:mediaReady,editorCount},
    quote,
    priceMatch:{monthly:Number(data.estimated_monthly_usd)===quote.estimate.monthlyUSD,onboarding:Number(data.estimated_onboarding_usd)===quote.estimate.onboardingUSD},
    status:"awaiting-manual-review",
    provisioningAuthorized:false,
    operationalActionsTaken:[],
    createdAt:new Date().toISOString()
  };
}
