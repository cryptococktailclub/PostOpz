import test from "node:test";
import assert from "node:assert/strict";
import health from "../netlify/functions/studio-vagon-health.mjs";

const url="https://postopz.com/api/studio/internal/vagon-health";
const context={deploy:{context:"production"}};
const mock=(vars)=>{globalThis.Netlify={env:{get:(key)=>vars[key]||""}}};
const token="c".repeat(64);
test("health endpoint is hidden outside production",async()=>{
  mock({"STUDIO_OPERATOR_TOKEN":token});
  const res=await health(new Request(url,{method:"POST",headers:{"authorization":"Bearer "+token}}),{deploy:{context:"deploy-preview"}});
  assert.equal(res.status,404);
});
test("missing operator credentials fail closed",async()=>{
  mock({});
  const res=await health(new Request(url,{method:"POST"}),context);
  assert.equal(res.status,503);
});
test("wrong operator bearer is rejected",async()=>{
  mock({"STUDIO_OPERATOR_TOKEN":token});
  const res=await health(new Request(url,{method:"POST",headers:{"authorization":"Bearer "+"x".repeat(64)}}),context);
  assert.equal(res.status,401);
});
test("authenticated operator receives non-sensitive missing-credentials status",async()=>{
  mock({"STUDIO_OPERATOR_TOKEN":token});
  const res=await health(new Request(url,{method:"POST",headers:{"authorization":"Bearer "+token}}),context);
  const data=await res.json();
  assert.equal(res.status,200);
  assert.equal(data.liveVendorRequestMade,false);
  assert.equal(data.mayProvision,false);
  assert.equal(JSON.stringify(data).includes(token),false);
});
test("no GET access to authenticated operator-only function",async()=>{
  mock({"STUDIO_OPERATOR_TOKEN":token});
  const res=await health(new Request(url,{method:"GET",headers:{"authorization":"Bearer "+token}}),context);
  assert.equal(res.status,405);
});
