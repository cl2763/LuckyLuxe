// 仅页面间的短时内存草稿，不写本地存储，不上传。按租户隔离，10分钟过期。
let draft = null
module.exports={
 put(tenant,sourceCardId,files){draft={tenant,sourceCardId,files:files.slice(0,4),at:Date.now()}},
 take(tenant){const d=draft;draft=null;return d&&d.tenant===tenant&&Date.now()-d.at<600000?d:null},
 clear(){draft=null}
}
