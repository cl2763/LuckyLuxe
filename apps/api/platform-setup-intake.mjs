import {randomBytes,createHash} from 'node:crypto'
import {allowedSections,validateAnswers,intakeProgress,FILE_MAX,TOTAL_MAX,INTAKE_VERSION} from '../web/setup-intake-schema.mjs'

const hash=v=>createHash('sha256').update(v).digest('hex')
const fileColumns='id,section,name,mime,size,sha256,created_at AS createdAt'
export function createSetupIntake({db,apiError,json,getEntitlements}){
  db.exec(`CREATE TABLE IF NOT EXISTS platform_setup_intakes (
    tenant_id TEXT PRIMARY KEY NOT NULL, answers_json TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft', updated_at TEXT NOT NULL, submitted_at TEXT);
    CREATE TABLE IF NOT EXISTS platform_setup_intake_links (
    token_hash TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS platform_setup_intake_files (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, section TEXT NOT NULL, name TEXT NOT NULL,
    mime TEXT NOT NULL,size INTEGER NOT NULL,sha256 TEXT NOT NULL,bytes BLOB NOT NULL,created_at TEXT NOT NULL,
    UNIQUE(tenant_id,section,sha256));`)
  const now=()=>new Date().toISOString()
  const files=tid=>db.prepare(`SELECT ${fileColumns} FROM platform_setup_intake_files WHERE tenant_id=? ORDER BY created_at,id`).all(tid)
  const ensure=tid=>{
    if(!db.prepare('SELECT id FROM tenants WHERE id=?').get(tid))throw apiError(404,'NOT_FOUND','门店不存在。')
  }
  function read(tid){
    const ent=getEntitlements(tid),sections=allowedSections(ent),row=db.prepare('SELECT * FROM platform_setup_intakes WHERE tenant_id=?').get(tid)
    const allAnswers=JSON.parse(row?.answers_json||'{}'),answers=Object.fromEntries(sections.filter(s=>allAnswers[s.id]).map(s=>[s.id,allAnswers[s.id]]))
    const visibleFiles=files(tid).filter(f=>sections.some(s=>s.id===f.section))
    return {version:INTAKE_VERSION,tenantId:tid,storeName:ent.tenantName,planName:ent.planNameZh,plan:ent.plan,sections,answers,files:visibleFiles,
      revision:row?.revision||0,status:row?.status||'draft',updatedAt:row?.updated_at||null,submittedAt:row?.submitted_at||null,
      progress:intakeProgress(sections,answers,visibleFiles),limits:{fileBytes:FILE_MAX,totalBytes:TOTAL_MAX}}
  }
  async function bounded(req,max){
    const chunks=[];let length=0
    for await(const c of req){length+=c.length;if(length>max)throw apiError(413,'TOO_LARGE','文件或资料超过大小限制。');chunks.push(Buffer.from(c))}
    return Buffer.concat(chunks)
  }
  async function body(req){try{return JSON.parse((await bounded(req,150000)).toString('utf8')||'{}')}catch(e){if(e.status)throw e;throw apiError(400,'BAD_REQUEST','资料格式无效。')}}
  const done=(res,status,value)=>{json(res,status,value,{'cache-control':'private, no-store','referrer-policy':'no-referrer'});return true}
  async function route({req,res,path,isPlatform}){
    const platform=path.match(/^\/platform\/tenants\/([^/]+)\/setup-intake(?:\/(link|files)(?:\/([^/]+))?)?$/)
    const invited=path.match(/^\/setup-intake(?:\/(files)(?:\/([^/]+))?)?$/)
    if(!platform&&!invited)return false
    let tid,action,fileId
    if(platform){
      if(!isPlatform())throw apiError(401,'UNAUTHORIZED','请先登录平台。')
      ;[,tid,action,fileId]=platform;ensure(tid)
    }else{
      const token=String(req.headers['x-setup-intake-token']||'')
      if(!/^[a-f0-9]{64}$/.test(token))throw apiError(401,'INVALID_INTAKE_LINK','请使用平台提供的资料填写链接。')
      const link=db.prepare('SELECT * FROM platform_setup_intake_links WHERE token_hash=? AND revoked=0 AND expires_at>?').get(hash(token),now())
      if(!link)throw apiError(401,'INVALID_INTAKE_LINK','资料链接已失效，请联系平台重新提供。')
      tid=link.tenant_id;ensure(tid);[,action,fileId]=invited
    }
    if(action==='link'){
      if(req.method==='POST'){
        const token=randomBytes(32).toString('hex'),time=now(),expires=new Date(Date.now()+14*86400000).toISOString()
        db.exec('SAVEPOINT setup_link')
        try{db.prepare('UPDATE platform_setup_intake_links SET revoked=1 WHERE tenant_id=?').run(tid)
          db.prepare('INSERT INTO platform_setup_intake_links(token_hash,tenant_id,expires_at,created_at) VALUES(?,?,?,?)').run(hash(token),tid,expires,time)
          db.exec('RELEASE setup_link')
        }catch(e){db.exec('ROLLBACK TO setup_link; RELEASE setup_link');throw e}
        return done(res,201,{url:`/web/setup-intake.html#${token}`,expiresAt:expires})
      }
      if(req.method==='DELETE'){db.prepare('UPDATE platform_setup_intake_links SET revoked=1 WHERE tenant_id=?').run(tid);return done(res,200,{revoked:true})}
    }
    if(action==='files'){
      if(fileId){
        const f=db.prepare('SELECT * FROM platform_setup_intake_files WHERE id=? AND tenant_id=?').get(fileId,tid)
        if(!f)throw apiError(404,'NOT_FOUND','材料不存在。')
        if(!allowedSections(getEntitlements(tid)).some(s=>s.id===f.section))throw apiError(403,'FORBIDDEN','该资料模块当前未开通。')
        if(req.method==='GET'){
          res.writeHead(200,{'content-type':f.mime,'content-length':f.size,'content-disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
            'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"})
          res.end(Buffer.from(f.bytes));return true
        }
        if(req.method==='DELETE'){db.prepare('DELETE FROM platform_setup_intake_files WHERE id=? AND tenant_id=?').run(fileId,tid);return done(res,200,{removed:true})}
      }else if(req.method==='POST'){
        const section=String(req.headers['x-setup-section']||'')
        if(!allowedSections(getEntitlements(tid)).some(s=>s.id===section&&s.files))throw apiError(400,'BAD_REQUEST','请选择已开通的资料模块。')
        let name;try{name=decodeURIComponent(String(req.headers['x-file-name']||''))}catch{throw apiError(400,'BAD_REQUEST','文件名无效。')}
        if(!name||name.length>180||/[\x00-\x1f/\\]/.test(name))throw apiError(400,'BAD_REQUEST','文件名无效或过长。')
        const bytes=await bounded(req,FILE_MAX),mime=detectMaterial(name,bytes)
        if(!mime)throw apiError(400,'INVALID_FILE','文件内容与支持的图片、PDF、表格或文档格式不符。')
        const digest=hash(bytes),existing=db.prepare(`SELECT ${fileColumns} FROM platform_setup_intake_files WHERE tenant_id=? AND section=? AND sha256=?`).get(tid,section,digest)
        if(existing)return done(res,200,{file:existing,duplicate:true})
        const used=db.prepare('SELECT COALESCE(SUM(size),0) AS bytes,COUNT(*) AS n FROM platform_setup_intake_files WHERE tenant_id=?').get(tid)
        if(used.bytes+bytes.length>TOTAL_MAX||used.n>=60)throw apiError(413,'TOO_LARGE','本店资料上限为50MB、60份文件，请先移除重复材料。')
        const id=randomBytes(18).toString('hex'),time=now()
        db.prepare('INSERT INTO platform_setup_intake_files(id,tenant_id,section,name,mime,size,sha256,bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,tid,section,name,mime,bytes.length,digest,bytes,time)
        return done(res,201,{file:{id,section,name,mime,size:bytes.length,sha256:digest,createdAt:time}})
      }
    }
    if(!action&&req.method==='GET')return done(res,200,read(tid))
    if(!action&&req.method==='PUT'){
      const b=await body(req),sections=allowedSections(getEntitlements(tid));let answers
      try{answers=validateAnswers(b.answers,sections)}catch(e){throw apiError(400,'BAD_REQUEST',e.message)}
      if(!Number.isSafeInteger(b.revision)||b.revision<0)throw apiError(400,'BAD_REQUEST','缺少资料版本，请刷新。')
      if(b.submit&&intakeProgress(sections,answers,files(tid)).some(s=>s.missing.length))throw apiError(400,'MISSING_FIELDS','请填写门店名称、城市、联系方式及币种。')
      // One synchronous transaction after await: no stale overwrite, including the first save.
      db.exec('SAVEPOINT setup_intake_save')
      try{
        const current=db.prepare('SELECT * FROM platform_setup_intakes WHERE tenant_id=?').get(tid)
        if((current?.revision||0)!==b.revision)throw apiError(409,'REVISION_CONFLICT','资料已在另一处更新，请重新读取后核对。')
        // Preserve disabled modules; a downgrade must never erase previously supplied materials.
        const merged={...JSON.parse(current?.answers_json||'{}'),...answers},time=now()
        db.prepare(`INSERT INTO platform_setup_intakes(tenant_id,answers_json,revision,status,updated_at,submitted_at) VALUES(?,?,?,?,?,?)
          ON CONFLICT(tenant_id) DO UPDATE SET answers_json=excluded.answers_json,revision=excluded.revision,status=excluded.status,updated_at=excluded.updated_at,submitted_at=excluded.submitted_at`)
          .run(tid,JSON.stringify(merged),b.revision+1,b.submit?'submitted':'draft',time,b.submit?time:current?.submitted_at||null)
        db.exec('RELEASE setup_intake_save')
      }catch(e){db.exec('ROLLBACK TO setup_intake_save; RELEASE setup_intake_save');throw e}
      return done(res,200,read(tid))
    }
    throw apiError(405,'METHOD_NOT_ALLOWED','此操作不受支持。')
  }
  return {route,read}
}

export function detectMaterial(name,bytes){
  if(!bytes.length)return null
  const ext=name.toLowerCase().split('.').pop(),ascii=bytes.subarray(0,16).toString('latin1')
  if(['jpg','jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg'
  if(ext==='png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png'
  if(ext==='webp'&&ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP')return 'image/webp'
  if(ext==='heic'&&ascii.slice(4,8)==='ftyp'&&['heic','heix','hevc','mif1'].includes(ascii.slice(8,12)))return 'image/heic'
  if(ext==='pdf'&&ascii.startsWith('%PDF-'))return 'application/pdf'
  if(['docx','xlsx'].includes(ext)&&bytes[0]===80&&bytes[1]===75&&bytes.includes(Buffer.from('[Content_Types].xml'))&&bytes.includes(Buffer.from(ext==='docx'?'word/':'xl/')))
    return ext==='docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if(['csv','txt'].includes(ext)&&!bytes.includes(0)){
    try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);return ext==='csv'?'text/csv; charset=utf-8':'text/plain; charset=utf-8'}catch{return null}
  }
  return null
}
