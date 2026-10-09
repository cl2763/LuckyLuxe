const MAX_BYTES = 256000
async function avatarData(path) {
  if (!path) return undefined
  if (/^data:image\/(png|jpeg|webp);base64,/.test(path)) return path
  // Native chooseAvatar produces a device-local path: compress/read it before upload.
  const compressed = await new Promise((resolve, reject) => wx.compressImage({ src:path, quality:70, compressedWidth:320, compressedHeight:320, success:r=>resolve(r.tempFilePath), fail:reject }))
  const data = await new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({filePath:compressed,encoding:'base64',success:r=>resolve(r.data),fail:reject}))
  if (data.length * 3 / 4 > MAX_BYTES) throw new Error('头像过大，请选择较小的图片')
  const mime = data.startsWith('iVBORw0KGgo') ? 'png' : data.startsWith('/9j/') ? 'jpeg' : data.startsWith('UklGR') ? 'webp' : ''
  if (!mime) throw new Error('头像格式不支持，请选择其他图片')
  return 'data:image/' + mime + ';base64,' + data
}
module.exports = { avatarData }
