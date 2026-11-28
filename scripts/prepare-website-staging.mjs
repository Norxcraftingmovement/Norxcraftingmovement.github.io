// Reads prior private staging inputs; writes only ignored .staging/website/. Never invokes Wrangler or a network API.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderWebsiteStaging,websiteInputsFromPrivate} from './website-staging-config.mjs';
const args=process.argv.slice(2);
if(args.length!==2||args[0]!=='--from'){console.error('Usage: node scripts/prepare-website-staging.mjs --from <private-staging-input-directory>');process.exit(2);}
try{
  const source=resolve(args[1]),read=name=>JSON.parse(readFileSync(join(source,name),'utf8'));
  const admin=read('deploy-admin.json'),pub=read('deploy-public.json');
  const inputs=websiteInputsFromPrivate(admin,pub);
  const configs=renderWebsiteStaging(inputs),out=new URL('../.staging/website/',import.meta.url);mkdirSync(out,{recursive:true});
  // Keep identity values private. Live account/DB/policy/version verification is still required before any write.
  for(const [name,config]of Object.entries(configs))writeFileSync(new URL(name,out),JSON.stringify(config,null,2)+'\n',{mode:0o600});
  console.log('Prepared 3 private website staging configs; nothing uploaded. Output: '+fileURLToPath(out));
}catch{console.error('Preparation failed: missing or inconsistent private staging inputs. No private values are printed.');process.exit(1);}
