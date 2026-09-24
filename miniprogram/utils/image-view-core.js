/* Same normalized focus in web, preview and mini. Copy checked by test-image-framing. */
;(function (root) {
  const view = v => ({x: Number.isFinite(v?.x) ? Math.max(0,Math.min(100,v.x)) : 50, y:Number.isFinite(v?.y) ? Math.max(0,Math.min(100,v.y)) : 50, zoom:Number.isFinite(v?.zoom) ? Math.max(1,Math.min(3,v.zoom)) : 1})
  function style(v) { v=view(v); return `object-position:${v.x}% ${v.y}%;transform:scale(${v.zoom});transform-origin:${v.x}% ${v.y}%;` }
  function geometry(iw,ih,w,h,v) { v=view(v); const scale=Math.max(w/iw,h/ih)*v.zoom; return {width:iw*scale,height:ih*scale,left:-(iw*scale-w)*v.x/100,top:-(ih*scale-h)*v.y/100} }
  const api={view,style,geometry}
  if(typeof module==='object') module.exports=api
  else root.ImageViewCore=api
})(typeof window==='object'?window:globalThis)
