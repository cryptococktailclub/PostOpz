// Public, read-only quote endpoint; does not expose customer data, secrets or vendor APIs.
import { quoteConfiguration } from "./lib/studio-pricing.mjs";
export default async function handler(request){
  if(request.method!=="POST")return new Response("Method not allowed",{status:405,headers:{"allow":"POST"}});
  if(Number(request.headers.get("content-length")||0)>4096)return Response.json({error:"Request too large"},{status:413});
  let body;
  try{body=await request.text();if(body.length>4096)throw Error("Oversized request");body=JSON.parse(body)}
  catch{return Response.json({error:"Invalid configuration"},{status:400,headers:{"cache-control":"no-store"}})}
  try{
    const configuration=quoteConfiguration(body);
    return Response.json({configuration,provisioningStatus:"manual-review-required",canAutoProvision:false},{headers:{"cache-control":"no-store"}});
  }catch{
    return Response.json({error:"Unsupported configuration"},{status:422,headers:{"cache-control":"no-store"}});
  }
}
export const config={path:"/api/studio/quote",method:"POST",rateLimit:{action:"rate_limit",aggregateBy:"ip",windowSize:60,windowLimit:40}};
