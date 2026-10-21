// Publish an explicit public-site allowlist to prevent shipping Netlify Functions
// (and other server-side files) as static resources.
import { cp,mkdir,readdir,rm,stat } from "node:fs/promises";
import { join,resolve } from "node:path";
const base=resolve(".");
const output=join(base,"dist");
const publicFolders=["assets","framework","founder","legal","virtual-edit-studio",".well-known"];
const publicFiles=["index.html","app.js","styles.css","_headers","sitemap.xml","robots.txt","llms.txt","project-received.html","favicon.ico","favicon-16x16.png","favicon-32x32.png","apple-touch-icon.png","og-image.png"];
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for(const name of [...publicFolders,...publicFiles]){
  const source=join(base,name);
  try{
    await stat(source);
  }catch(error){
    if(error.code==="ENOENT")throw new Error("Missing expected public-site asset: "+name);
    throw error;
  }
  await cp(source,join(output,name),{recursive:true,force:true});
}
const entries=(await readdir(output)).sort();
if(entries.includes("netlify")||entries.includes("scripts")||entries.includes("node_modules"))throw new Error("Unsafe published asset directory");
console.log("PostOpz public site built:",entries.join(", "));
