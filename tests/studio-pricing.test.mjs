import test from "node:test";
import assert from "node:assert/strict";
import {quoteConfiguration,buildInquiry} from "../netlify/functions/lib/studio-pricing.mjs";
test("production baseline quote",()=>{
 const q=quoteConfiguration({tier:"production",monthlyGpuHours:160,sharedStorageTB:2,workflow:"PostOpz Framework"});
 assert.equal(q.estimate.monthlyUSD,1499);assert.equal(q.estimate.onboardingUSD,299);assert.equal(q.provisioningAuthorized,undefined);
});
test("custom studio upgraded configuration",()=>{
 const q=quoteConfiguration({tier:"studio",monthlyGpuHours:240,sharedStorageTB:7,workflow:"Custom standards requested"});
 assert.equal(q.estimate.monthlyUSD,2999+40*7.5+2*149);
 assert.equal(q.estimate.onboardingUSD,748);
});
test("essential baseline and overages",()=>{
 const q=quoteConfiguration({tier:"essential",monthlyGpuHours:60,sharedStorageTB:1.5,workflow:"framework"});
 assert.equal(q.estimate.monthlyUSD,599+20*4.5+149);
});
test("invalid selection is rejected",()=>{
 assert.throws(()=>quoteConfiguration({tier:"production",monthlyGpuHours:10000,sharedStorageTB:2,workflow:"framework"}));
 assert.throws(()=>quoteConfiguration({tier:"production",monthlyGpuHours:160,sharedStorageTB:1000,workflow:"framework"}));
});
test("customer cannot alter server-computed quote",()=>{
 const q=buildInquiry({source:"PostOpz Virtual Edit Studio landing page",name:"Test",email:"test@example.com",selected_tier:"Production",monthly_gpu_hours:"160",shared_storage_tb:"2",requested_workflow:"PostOpz Framework",estimated_monthly_usd:"1",estimated_onboarding_usd:"2"});
 assert.equal(q.quote.estimate.monthlyUSD,1499);
 assert.deepEqual(q.priceMatch,{monthly:false,onboarding:false});
 assert.equal(q.provisioningAuthorized,false);
 assert.equal(q.status,"awaiting-manual-review");
});
test("other form events are ignored",()=>assert.equal(buildInquiry({source:"other"}),null));
