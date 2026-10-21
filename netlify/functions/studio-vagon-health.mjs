// Authenticated operator-only Vagon diagnostics. Read-only and inactive without secrets.
// NEVER return access links, API credentials, account balance, user identity or raw vendor data.
import {createHash, timingSafeEqual} from "node:crypto";
import {createVagonClient,getVagonConnectionConfig} from "./lib/vagon-teams.mjs";

function authorized(authorization, expected){
  if (!expected || expected.length < 43 || typeof authorization !== "string") return false;
  const supplied=authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (supplied.length < 43 || supplied.length > 256) return false;
  const a=createHash("sha256").update(supplied).digest();
  const b=createHash("sha256").update(expected).digest();
  return timingSafeEqual(a,b);
}
const json=(body,status=200)=>Response.json(body,{status,headers:{"cache-control":"no-store","x-content-type-options":"nosniff"}});
export default async function handler(request,context){
  if(context?.deploy?.context!=="production")return json({error:"Unavailable"},404);
  if(request.method!=="POST")return json({error:"Method not allowed"},405);
  const operatorToken=Netlify.env.get("STUDIO_OPERATOR_TOKEN")||"";
  if(!operatorToken || operatorToken.length<43)return json({error:"Operator authentication not configured"},503);
  if(!authorized(request.headers.get("authorization"),operatorToken))return json({error:"Unauthorized"},401);
  const config=getVagonConnectionConfig(key=>Netlify.env.get(key));
  if(!config.configured)return json({
    status:"awaiting-provider-credentials",
    provider:"Vagon Teams",
    required:["VAGON_TEAMS_API_PUBLIC_KEY","VAGON_TEAMS_API_SECRET_KEY"],
    liveVendorRequestMade:false,mayProvision:false
  });
  try{
    const client=createVagonClient(config);
    const machines=await client.listMachines();
    const rows=Array.isArray(machines.machines) ? machines.machines : [];
    const count=Number.isFinite(machines.count)?machines.count:rows.length;
    const safeStatus=new Set(["off","creating","turning_on","ready","turning_off","resizing_disk","installing","region_migration","warming_up","graceful_stopping"]);
    const counts={};
    for(const item of rows){
      const status=String(item?.attributes?.friendly_status||"unknown");
      const key=safeStatus.has(status)?status:"unknown";
      counts[key]=(counts[key]||0)+1;
    }
    return json({
      status:"read-only-connected",provider:"Vagon Teams",
      machineCount:count,displayedMachineStatusCounts:counts,
      canProvision:false,
      warning:"Vendor listing is only a connectivity check. No machine was created, started, stopped or assigned."
    });
  }catch(error){
    return json({
      status:"vendor-check-failed",provider:"Vagon Teams",
      providerStatusCode:Number.isInteger(error?.status)?error.status:null,
      mayProvision:false,
      error:"Unable to confirm Vagon API access; verify credentials and Teams permissions."
    },502);
  }
}
export const config={
  path:"/api/studio/internal/vagon-health",
  method:"POST",
  rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:10}
};
