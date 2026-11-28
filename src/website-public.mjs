import { websiteSource } from "./generated/website-home-assets.mjs";
import { homepageEnabled, publishedHome, homePriceLabels } from "./website-home.mjs";
import { renderHome } from "./website-home-template.mjs";
import { environmentGuard } from "./orders-guard.mjs";
const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function websitePublic(request,env){
  if(!homepageEnabled(env))return new Response(null,{status:404,headers});if(!(await environmentGuard(env)))return new Response(null,{status:503,headers});if(request.method!=='GET')return new Response(null,{status:405,headers});const path=new URL(request.url).pathname,home=await publishedHome(env);
  if(!home)return new Response(null,{status:404,headers});if(home.version!==1||home.rendererVersion!==websiteSource.version)throw Error('Unsupported publication');
  if(path==='/api/site/home')return new Response(renderHome(home.content,{origin:env.ORDERS_ALLOWED_ORIGIN,prices:await homePriceLabels(env)}),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
  const source=websiteSource;
  if(path==='/api/site/assets/website-home.css')return new Response(source.css,{headers:{...headers,'Content-Type':'text/css; charset=utf-8'}});
  if(path==='/api/site/assets/home-interactions.js')return new Response(source.scripts,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
  if(path==='/api/site/assets/home-runtime.js')return new Response('window.NORX_API="/api/orders";window.NORX_PAGE={root:"/"};',{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
  const file=path.match(/^\/api\/site\/media\/([0-9a-f-]{36}\.(jpg|png|webp))$/)?.[1];
  if(file&&home.content.hero.src==='/api/admin/product-images/'+file&&env.PRODUCT_MEDIA){const object=await env.PRODUCT_MEDIA.get('products/'+file);if(object)return new Response(object.body,{headers:{...headers,'Content-Type':file.endsWith('.jpg')?'image/jpeg':file.endsWith('.png')?'image/png':'image/webp','Content-Security-Policy':"default-src 'none'; sandbox"}});}
  return new Response(null,{status:404,headers});
}
