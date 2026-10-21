import test from "node:test";
import assert from "node:assert/strict";
import {
  makeVagonAuthorization,createVagonClient,getVagonConnectionConfig,
  draftVagonMachine,VagonApiError
} from "../netlify/functions/lib/vagon-teams.mjs";

const KEYS={publicKey:"public-test-key",secretKey:"secret-test-key"};
const TIMESTAMP="1700000000000",NONCE="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
test("HMAC SHA256 matches the Vagon documented signing sequence",()=>{
  const header=makeVagonAuthorization({...KEYS,method:"GET",path:"/organization-management/v1/machines",timestamp:TIMESTAMP,nonce:NONCE});
  assert.equal(header,"HMAC public-test-key:9a8b85944a27052fa1ed660f84ce493ff05bc7e6afb4dfa062602cbad4b4b816:"+NONCE+":"+TIMESTAMP);
});
test("read-only Teams client authenticates GET machines and returns sanitized parse",async()=>{
  const calls=[];
  const fetchImpl=async(url,init)=>{
    calls.push({url,init});
    return new Response(JSON.stringify({machines:[{id:"100",attributes:{friendly_status:"off"}}],count:1}),
      {status:200,headers:{"content-type":"application/json"}});
  };
  const client=createVagonClient({...KEYS,fetchImpl,now:()=>Number(TIMESTAMP),nonce:()=>NONCE});
  const res=await client.listMachines();
  assert.equal(res.count,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://api.vagon.io/organization-management/v1/machines");
  assert.equal(calls[0].init.method,"GET");
  assert.match(calls[0].init.headers.Authorization,/^HMAC public-test-key:/);
  assert.equal(typeof client.createMachine,"undefined");
  assert.equal(typeof client.startMachine,"undefined");
  assert.equal(typeof client.stopMachine,"undefined");
  assert.equal(typeof client.getAccessLink,"undefined");
});
test("read-only software catalog uses an allowlisted GET",async()=>{
  let requestedPath="";
  const fetchImpl=async(url)=>{requestedPath=url;return Response.json({softwares:[]})};
  const client=createVagonClient({...KEYS,fetchImpl,now:()=>Number(TIMESTAMP),nonce:()=>NONCE});
  await client.listSoftware();
  assert.equal(requestedPath,"https://api.vagon.io/organization-management/v1/software");
});
test("vendor API failures do not leak error bodies",async()=>{
  const client=createVagonClient({...KEYS,fetchImpl:async()=>new Response("SENSITIVE_TOKEN",{status:401}),now:()=>Number(TIMESTAMP),nonce:()=>NONCE});
  await assert.rejects(client.listMachines(),error=>error instanceof VagonApiError && error.status===401 && !error.message.includes("SENSITIVE_TOKEN"));
});
test("outbound errors are sanitized",async()=>{
  const client=createVagonClient({...KEYS,fetchImpl:async()=>{throw Error("Sensitive environment detail")},now:()=>Number(TIMESTAMP),nonce:()=>NONCE});
  await assert.rejects(client.listMachines(),/Vagon API connection failed/);
});
test("preflight machine draft is non-executable and narrowly scoped",()=>{
  const d=draftVagonMachine({planId:109,region:"dublin",softwareIds:[3,3,4],baseImageId:78});
  assert.equal(d.executionEnabled,false);
  assert.equal(d.vendorPaymentRequired,true);
  assert.equal(d.endpoint,"POST /organization-management/v1/machines");
  assert.equal(d.request.quantity,1);
  assert.deepEqual(d.request.software_ids,[3,4]);
  assert.equal(d.request.permissions.can_download_from_vagon_workstation,false);
  assert.equal(d.request.permissions.screen_recording_enabled,false);
});
test("invalid machine plans, region and software selections are rejected",()=>{
  assert.throws(()=>draftVagonMachine({planId:0,region:"dublin"}));
  assert.throws(()=>draftVagonMachine({planId:100,region:"https://evil.example"}));
  assert.throws(()=>draftVagonMachine({planId:100,region:"dublin",softwareIds:["DROP TABLE"]}));
  assert.throws(()=>draftVagonMachine({planId:100,region:"dublin",os:"linux"}));
});
test("credentials are only considered ready when both keys are present",()=>{
  assert.equal(getVagonConnectionConfig(()=>undefined).configured,false);
  assert.equal(getVagonConnectionConfig(key=>key==="VAGON_TEAMS_API_PUBLIC_KEY"?"PUBLIC":"").configured,false);
  assert.equal(getVagonConnectionConfig(key=>key==="VAGON_TEAMS_API_PUBLIC_KEY"?"PUBLIC":"SECRET").configured,true);
});
