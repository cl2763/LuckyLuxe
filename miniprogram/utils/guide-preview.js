// wx.previewImage expects file paths on devices; turn the selected inline image into a local file.
module.exports = function previewGuide(image) {
 if(/^https?:\/\//.test(image||'')){wx.previewImage({urls:[image]});return}
 const match=String(image||'').match(/^data:image\/(png|jpeg|webp);base64,(.+)$/)
 if(!match)return
 const path=wx.env.USER_DATA_PATH+'/arrival-guide-preview.'+match[1]
 wx.getFileSystemManager().writeFile({filePath:path,data:match[2],encoding:'base64',success:()=>wx.previewImage({urls:[path],fail:()=>wx.showToast({title:'图片预览失败，请重试',icon:'none'})}),fail:()=>wx.showToast({title:'图片读取失败，请重试',icon:'none'})})
}
