// Keep an isolated web mount on its own assets and API service.
export function mountWebHtml(html, publicUrl) {
  let prefix = ''
  try { prefix = new URL(publicUrl).pathname.replace(/\/$/, '') } catch { return html }
  if (prefix !== '/experience') return html
  return html.replace(/\b(href|src)=(['"])\/(?!\/|experience(?:\/|['"]))([^'"]*)\2/g,
    (_, attr, quote, path) => `${attr}=${quote}${prefix}/${path}${quote}`)
}
