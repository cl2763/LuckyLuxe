// One album per approved service, never merge separate visits by technician.
const albumId = work => work.albumId || work.id.replace(/:\d+$/, '')
function windowOf(album, offset) {
  const start = Math.max(0, Math.min(offset, album.works.length - 1))
  return Object.assign({}, album, { offset: start, current: album.works[start] })
}
function albumsOf(works) {
  const groups = []
  works.filter(work => work.image).forEach(work => {
    let group = groups.find(item => item.id === albumId(work))
    if (!group) { group = { id: albumId(work), works: [] }; groups.push(group) }
    group.works.push(work)
  })
  return groups.map(group => windowOf(group, 0))
}
function moveAlbum(albums, id, step) {
  return albums.map(album => album.id === id ? windowOf(album, album.offset + step) : album)
}
function previewOf(works, current, step) {
  const group = works.filter(work => work.image && current && albumId(work) === albumId(current))
  const index = Math.max(0, Math.min(group.length - 1, group.findIndex(work => work.id === (current && current.id)) + step))
  return { work: group[index], index, total: group.length }
}
module.exports = { albumsOf, moveAlbum, previewOf }
