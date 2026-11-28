import { websiteSource } from "./generated/website-home-assets.mjs";
import { homepageEnabled, publishedHome, homePriceLabels } from "./website-home.mjs";
import { renderHome } from "./website-home-template.mjs";
import { environmentGuard } from "./orders-guard.mjs";
import { productSource } from './generated/product-publication-assets.mjs';
import { publishedProduct, renderProduct } from './product-publication.mjs';
import { contentImageSources } from './product-content.mjs';
const headers={'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
export async function websitePublic(request,env){
  if(!homepageEnabled(env))return new Response(null,{status:404,headers});if(!(await environmentGuard(env)))return new Response(null,{status:503,headers});if(request.method!=='GET')return new Response(null,{status:405,headers});const path=new URL(request.url).pathname,home=await publishedHome(env);
  const slug=path.match(/^\/api\/site\/products\/(drop03|drop02)$/)?.[1];
  if(slug){const page=await publishedProduct(env,slug);if(!page)return new Response(null,{status:404,headers});return new Response(renderProduct(page.snapshot.content,page.state,{preview:false}),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});}
  const theme=path.match(/^\/api\/site\/assets\/product-theme-([a-z0-9-]+)\.css$/)?.[1];
  if(theme&&productSource.themes[theme])return new Response(productSource.themes[theme].css,{headers:{...headers,'Content-Type':'text/css; charset=utf-8'}});
  const runtime=path.match(/^\/api\/site\/assets\/product-runtime-(drop03|drop02)\.js$/)?.[1];
  if(runtime)return new Response('window.NORX_API="/api/orders";window.NORX_PAGE='+JSON.stringify({product:runtime,root:'/'} )+';',{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
  if(home&&(home.version!==1||home.rendererVersion!==websiteSource.version))throw Error('Unsupported publication');
  const file=path.match(/^\/api\/site\/media\/([0-9a-f-]{36}\.(jpg|png|webp))$/)?.[1];
  if(file&&env.PRODUCT_MEDIA){
    const src='/api/admin/product-images/'+file;let referenced=home?.content.hero.src===src;
    if(!referenced)for(const slug of Object.keys(productSource.fixtures)){const page=await publishedProduct(env,slug);if(page&&contentImageSources(page.snapshot.content).includes(src)){referenced=true;break;}}
    if(referenced){const object=await env.PRODUCT_MEDIA.get('products/'+file);if(object)return new Response(object.body,{headers:{...headers,'Content-Type':file.endsWith('.jpg')?'image/jpeg':file.endsWith('.png')?'image/png':'image/webp','Content-Security-Policy':"default-src 'none'; sandbox"}});}
    return new Response(null,{status:404,headers});
  }
  if(!home)return new Response(null,{status:404,headers});
  if(path==='/api/site/home')return new Response(renderHome(home.content,{origin:env.ORDERS_ALLOWED_ORIGIN,prices:await homePriceLabels(env)}),{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"}});
  const source=websiteSource;
  if(path==='/api/site/assets/website-home.css')return new Response(source.css,{headers:{...headers,'Content-Type':'text/css; charset=utf-8'}});
  if(path==='/api/site/assets/home-interactions.js')return new Response(source.scripts,{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
  if(path==='/api/site/assets/home-runtime.js')return new Response('window.NORX_API="/api/orders";window.NORX_PAGE={root:"/"};',{headers:{...headers,'Content-Type':'text/javascript; charset=utf-8'}});
  return new Response(null,{status:404,headers});
}
