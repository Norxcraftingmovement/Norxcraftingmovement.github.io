const figure=document.querySelector("#event-poster");
const image=document.querySelector("#event-poster-image");
image.addEventListener("load",()=>{figure.hidden=false;},{once:true});
image.addEventListener("error",()=>{figure.hidden=true;},{once:true});
image.src="/media/events/move-kids-2026/poster";
