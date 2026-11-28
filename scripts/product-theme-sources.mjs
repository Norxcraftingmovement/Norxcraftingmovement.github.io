// Build-time extraction of trusted repository pages. Not a parser for user-supplied HTML.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PRODUCT_THEMES } from "../admin-ui/product-theme-options.mjs";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const plain = html => html.replace(/<br\s*\/?\s*>/gi,"\n").replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
const inside = (html, tag) => plain(html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "");
const attr = (html, name) => html.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] || "";
const image = html => {
  const tag = html.match(/<img\b[^>]*>/)?.[0] || "", src = attr(tag,"src").replace(/^\.\.\//,"/");
  if (!/^\/assets\/[A-Za-z0-9/_.-]+\.(?:jpg|png|webp)$/.test(src) || src.split("/").includes("..") || !existsSync(new URL(".." + src, import.meta.url))) throw Error("Invalid product source image");
  return {src,alt:attr(tag,"alt"),caption:inside(html,"figcaption")};
};
export function productThemeSources() {
  const themes = {}, fixtures = {}, images = [];
  for (const [index, page] of ["home-terrain","woven-stride"].entries()) {
    const html = read(page + "/index.html"), theme = PRODUCT_THEMES[index];
    const styles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m=>m[1]);
    if (styles.length !== 2 || attr(html.match(/<body\b[^>]*>/)?.[0] || "","class") !== theme.bodyClass) throw Error("Product theme source changed; review extraction");
    themes[theme.id] = {css:styles.join("\n"),styleBlocks:styles.length};
    const sections = [...html.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/g)].map(m=>m[0]);
    const hero = sections.find(s=>/class="hero"/.test(s)), photos = sections.find(s=>/class="gallery/.test(s)), sizing = sections.find(s=>/id="sizes"/.test(s));
    if (!hero || !photos || !sizing) throw Error("Missing product source section");
    const gallery = []; let group = {heading:"",images:[]};
    for (const match of photos.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>|<figure\b[^>]*>[\s\S]*?<\/figure>/g)) {
      if (match[1] !== undefined) { if(group.images.length) gallery.push(group);group={heading:plain(match[1]),images:[]}; }
      else group.images.push(image(match[0]));
    }
    if(group.images.length)gallery.push(group);
    const headers = [...sizing.match(/<thead>([\s\S]*?)<\/thead>/)[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map(m=>plain(m[1]));
    const rows = [...sizing.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(m=>[...m[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g)].map(c=>plain(c[1])));
    const notes = [...sizing.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m=>plain(m[1]));
    const slug = index === 0 ? "drop03" : "drop02", lookbook = [];
    if (index === 0) for (const match of read("home-terrain/lookbook.html").matchAll(/<img\b[^>]*>/g)) {
      const src=attr(match[0],"src"); if(!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(src))throw Error("Unexpected lookbook format");
      const bytes=Buffer.from(src.split(",")[1],"base64"), name="product-lookbook-"+createHash("sha256").update(bytes).digest("hex").slice(0,16)+".jpg";
      images.push({name,bytes});lookbook.push({src:"/assets/"+name,alt:attr(match[0],"alt"),caption:""});
    }
    fixtures[slug] = {slug,pagePath:"/"+page+"/",themeId:theme.id,heading:inside(hero,"h1"),lead:plain(hero.match(/<p class="lead">([\s\S]*?)<\/p>/)?.[1] || "").replace(/\s*—\s*$/,""),hero:image(hero),galleryTitle:inside(photos,"h2"),gallery,lookbook,sizing:{headers,rows,notes}};
  }
  return {themes,fixtures,images};
}
export function writeProductLookbookAssets(out) {
  const {images}=productThemeSources();mkdirSync(join(out,"assets"),{recursive:true});
  for(const {name,bytes} of images)writeFileSync(join(out,"assets",name),bytes);
}
