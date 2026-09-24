import { createServer, request } from 'node:http'
import { gunzipSync } from 'node:zlib'
import { randomBytes } from 'node:crypto'
import { writeHttpBody } from './http-body.mjs'

let checks = 0
function check(name, ok) { if (!ok) throw Error(name); console.log(`ok ${++checks} - ${name}`) }
const json = JSON.stringify({rows:Array.from({length:300},(_,i)=>({id:i,说明:'同一家店的真实显示内容不因压缩改变',amount:12345}))})
const image = randomBytes(4096)
const server = createServer((req,res)=>{
  const p=req.url
  const type=p==='/image'?'image/png':p==='/css'?'text/css; charset=utf-8':p==='/script'?'application/javascript; charset=utf-8':'application/json; charset=utf-8'
  const body=p==='/empty'?undefined:p==='/image'?image:p==='/small'?'{}':p==='/css'?'.x { color: red; }\n'.repeat(200):p==='/script'?'console.log("你好");\n'.repeat(200):json
  writeHttpBody(res,p==='/error'?403:200,{'content-type':type,'cache-control':'no-store','set-cookie':['a=1; HttpOnly; Secure'],'x-test':'kept'},body)
})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
async function get(path,encoding,method='GET') {
  return new Promise((resolve,reject)=>{
    const q=request({host:'127.0.0.1',port:server.address().port,path,method,headers:encoding===undefined?{}:{'accept-encoding':encoding}},r=>{const chunks=[];r.on('data',c=>chunks.push(c));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,body:Buffer.concat(chunks)}))});q.on('error',reject);q.end()
  })
}
try {
  const a=await get('/json','gzip, deflate, br')
  check('大 JSON 协商为 gzip',a.headers['content-encoding']==='gzip')
  check('解压后 Unicode、金额与原文逐字相同',gunzipSync(a.body).toString()===json)
  check('重复业务数据传输量至少减少 80%',a.body.length<Buffer.byteLength(json)*0.2)
  check('压缩长度与 HTTP Content-Length 一致',Number(a.headers['content-length'])===a.body.length)
  check('缓存协商声明 Accept-Encoding',a.headers.vary==='Accept-Encoding')
  check('原缓存与其他头不被改变',a.headers['cache-control']==='no-store'&&a.headers['x-test']==='kept')
  check('登录 Cookie 的 HttpOnly/Secure 保留',a.headers['set-cookie'][0]==='a=1; HttpOnly; Secure')
  const plain=await get('/json')
  check('无协商仍返回原文',!plain.headers['content-encoding']&&plain.body.toString()===json)
  check('原文长度按 UTF-8 字节计算',Number(plain.headers['content-length'])===Buffer.byteLength(json))
  for(const encoding of ['gzip;q=0, *;q=1','br','gzip;q=bad','gzip;q=2']) {
    const r=await get('/json',encoding);check(`不支持或禁用的协商保留原文：${encoding}`,!r.headers['content-encoding']&&r.body.toString()===json)
  }
  check('通配协商支持 gzip',(await get('/json','*;q=0.5')).headers['content-encoding']==='gzip')
  const empty=await get('/empty','gzip');check('空响应没有虚报正文长度',empty.body.length===0&&empty.headers['content-length']==='0')
  const small=await get('/small','gzip');check('小响应不压缩',!small.headers['content-encoding']&&small.body.toString()==='{}')
  const img=await get('/image','gzip');check('图片二进制逐字节保留',!img.headers['content-encoding']&&img.body.equals(image))
  const error=await get('/error','gzip');check('权限错误仍为 403 且错误体完整',error.status===403&&gunzipSync(error.body).toString()===json)
  const head=await get('/json','gzip','HEAD');check('HEAD 无正文但表示长度准确',head.body.length===0&&Number(head.headers['content-length'])===a.body.length)
  for(const [path,source] of [['/css','.x { color: red; }\n'.repeat(200)],['/script','console.log("你好");\n'.repeat(200)]]) {
    const r=await get(path,'gzip');check(`${path} 解压后可执行文本不变`,r.headers['content-encoding']==='gzip'&&gunzipSync(r.body).toString()===source)
  }
} finally { await new Promise(r=>server.close(r)) }
console.log(`通过 ${checks} 项`)
