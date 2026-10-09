import { createHash } from 'node:crypto'
import { readdirSync,readFileSync,writeFileSync } from 'node:fs'
import { join,relative,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)),'..','miniprogram')
const target = join(root,'utils/package-build.js')
const hash = createHash('sha256')
function walk(dir) { for (const item of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) { const p=join(dir,item.name); if(item.isDirectory())walk(p); else if(p!==target)hash.update(relative(root,p)).update('\0').update(readFileSync(p)) } }
walk(root)
const build = hash.digest('hex').slice(0,16)
writeFileSync(target,'// Generated before upload; identifies the mini-program bundle, not the API.\nmodule.exports = '+JSON.stringify({build})+'\n')
console.log('Mini-program bundle: '+build)
