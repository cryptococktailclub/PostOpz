// Verified Netlify Forms submissions -> immutable, server-repriced pilot manifests.
// This handler cannot create workstations or spend vendor funds.
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { buildInquiry } from "./lib/studio-pricing.mjs";
export default {
  async formSubmitted(event){
    // Production-only processing: preview/test deploys must never write site-wide customer records.
    if(Netlify.env.get("STUDIO_EVENT_PROCESSING_ENABLED")!=="true")return;
    const data=event?.data;
    if(!data||data.source!=="PostOpz Virtual Edit Studio landing page")return;
    let manifest;
    try{manifest=buildInquiry(data)}catch(err){
      console.warn("Studio intake skipped: invalid pricing or contact configuration");
      return;
    }
    if(!manifest)return;
    const fingerprint=JSON.stringify({
      email:manifest.customer.email,
      details:manifest.customer.projectDetails,
      selection:manifest.quote,
      start:manifest.intake.targetStart,
      nle:manifest.intake.nle
    });
    const id=createHash("sha256").update(fingerprint).digest("hex").slice(0,24);
    const record={...manifest,id,recordType:"studio-provisioning-request",reviewRequired:true,
      nextAction:"Review in Netlify Blobs, validate quote, licenses and provider accounts before manual provisioning approval."};
    const store=getStore({name:"postopz-studio-requests",consistency:"strong"});
    const write=await store.setJSON("requests/"+id+".json",record,{onlyIfNew:true});
    console.info("Studio pilot request",id,write.modified?"created":"already-recorded");
  }
};
