import { websiteSource } from "./generated/website-home-assets.mjs";
import { renderHome as render } from "../admin-ui/website-home-template.mjs";
export const renderHome=(content,options)=>render(content,websiteSource,options);
