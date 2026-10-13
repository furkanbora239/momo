import { mkdir, mkdtemp, writeFile, readFile, copyFile, readdir, readlink, rm } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import { join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { OpenCode } from '../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js'
const worktree = process.cwd()
const bin = process.env.MOMO_NATIVE_OPENCODE_BIN
if (!bin || !isAbsolute(bin)) throw new Error('Set MOMO_NATIVE_OPENCODE_BIN to the installed native OpenCode binary absolute path')
const evidence = join(worktree,'.omo/evidence/20261013-permission-repair',process.env.MOMO_PROBE_BASELINE==='1'?'baseline':'fixed')
const root = await mkdtemp(join(tmpdir(),'momo-permission-'))
const project = join(root,'project'), config = join(root,'config/opencode'), data = join(root,'data'), log = join(root,'permission-events.jsonl')
const env: NodeJS.ProcessEnv = { ...process.env, HOME:join(root,'home'), OPENCODE_TEST_HOME:join(root,'home'), OPENCODE_CONFIG_DIR:config, XDG_DATA_HOME:data, XDG_CONFIG_HOME:join(root,'config'), XDG_STATE_HOME:join(root,'state'), XDG_CACHE_HOME:join(root,'cache'), OPENCODE_DISABLE_AUTOUPDATE:'1', OPENCODE_DISABLE_MODELS_FETCH:'1' }
for (const key of Object.keys(env)) if (/(API[_-]?KEY|_TOKEN$|_SECRET$|PASSWORD|OPENCODE_CONFIG$|OPENCODE_DB$)/i.test(key)) delete env[key]
for (const dir of [project, config,join(config,'agents'),data,env.HOME ?? join(root,'home'),evidence]) await mkdir(dir,{recursive:true})
const outside=join(root,'outside.txt'), approved=join(root,'approved.txt'), marker=join(root,'mutation-marker')
await writeFile(outside,'OUTSIDE_UNAUTHORIZED');await writeFile(approved,'EXPLICIT_READ_OK')
const cases = new Map<string,{code?:string; tool?:string; args?:unknown}>([
 ['truncation',{code:'return Array.from({length:3000}, (_,i) => i === 2999 ? "RECOVERED_NATIVE_OUTPUT" : "padding "+i).join("\\n")'}],
 ['outside',{tool:'read',args:{path:outside,limit:1}}],
 ['approved',{tool:'read',args:{path:approved,limit:1}}],
 ['shell',{tool:'shell',args:{command:`printf bypass > ${marker}`,description:'negative shell guard'}}],
 ['edit',{tool:'edit',args:{path:approved,oldString:'EXPLICIT_READ_OK',newString:'MUTATED'}}],
 ['custom',{tool:'external_operate',args:{}}],
])
const realDatabase = join(process.env.HOME ?? '', '.local/share/opencode/opencode.db')
function realCounts(){
 const tables=execFileSync('sqlite3',['-readonly',realDatabase,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session','session_v2','session_message');"],{encoding:'utf8'}).trim().split('\n').filter(Boolean)
 return Object.fromEntries(tables.map(table=>[table,Number(execFileSync('sqlite3',['-readonly',realDatabase,'SELECT count(*) FROM '+table],{encoding:'utf8'}).trim())]))
}
const countsBefore=realCounts()
const requests:unknown[]=[]
const model=Bun.serve({port:0,fetch:async(req)=>{
 const body=await req.json() as {messages:{role:string;content:unknown}[];model:string}
 requests.push(body)
 const user=body.messages.filter(m=>m.role==='user').at(-1)
 const text=JSON.stringify(user?.content)
 const name=[...cases.keys()].find(key=>text.includes('CASE_'+key))
 const c=name ? cases.get(name):undefined
 const replies=body.messages.filter(m=>m.role==='tool')
 const conversation=JSON.stringify(body.messages)
 let tool=c?.tool??'execute',args=c?.args??{code:c?.code}
 let call=replies.length===0 && c!==undefined
 if(name==='truncation'){
  const artifact=conversation.match(/full output saved to ([^\]"\\]+)/)?.[1]
  if(replies.length===1 && artifact){tool='read';args={path:artifact,offset:3000,limit:1};call=true}
  if(replies.length===2 && artifact){tool='grep';args={path:artifact,pattern:'RECOVERED_NATIVE_OUTPUT',limit:1};call=true}
 }
 const delta=call?{tool_calls:[{index:0,id:'call_'+crypto.randomUUID().replaceAll('-',''),type:'function',function:{name:tool,arguments:JSON.stringify(args)}}]}:{content:'PROBE_DONE'}
 const chunk=(d:unknown,finish:unknown)=>({id:'qa',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:d,finish_reason:finish}]})
 return new Response(`data: ${JSON.stringify(chunk(delta,null))}\n\ndata: ${JSON.stringify(chunk({},call?'tool_calls':'stop'))}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}})
}})
const plugin=join(root,'plugin')
await mkdir(plugin)
await writeFile(join(plugin,'package.json'),JSON.stringify({name:'permission-probe',type:'module',exports:{'.':'./index.js'}}))
const source=join(root,'fixture.ts')
await writeFile(source,`
import { appendFileSync, writeFileSync } from 'node:fs'
import { z } from '${worktree}/node_modules/zod/index.js'
import { registerNativePermissions } from '${worktree}/packages/omo-opencode/src/native-runtime/permission-policy.ts'
export default { id:'permission-probe',async setup(ctx){
const log=(event)=>appendFileSync(${JSON.stringify(log)},JSON.stringify(event)+'\\n')
await ctx.provider.transform(editor=>editor.add({info:{id:'momo-qa',name:'QA',activation:'enabled',package:'aisdk:@ai-sdk/openai-compatible',settings:{baseURL:'http://127.0.0.1:${model.port}/v1',apiKey:'local-only'}},models:[{id:'qa',modelID:'qa',providerID:'momo-qa',name:'QA',capabilities:{tools:true,input:['text'],output:['text']},variants:[],time:{released:0},cost:[{input:0,output:0,cache:{read:0,write:0}}],status:'active',enabled:true,limit:{context:32000,output:4096}}]}))
await ctx.provider.reload()
await ctx.agent.transform(editor=>editor.update('momo-orchestrator',agent=>agent.permissions.push({action:'external_directory',resource:${JSON.stringify(root+'/*')},effect:'ask'},{action:'external_directory',resource:${JSON.stringify(join(data,'opencode/tool-output/*'))},effect:'allow'})))
await ctx.agent.reload()
await ctx.tool.transform(editor=>editor.add({name:'external_operate',description:'QA forbidden neutral custom mutation',input:z.object({}),execute:async()=>{writeFileSync(${JSON.stringify(marker)},'custom-ran');return {content:[{type:'text',text:'custom-ran'}]}}}))
const originals=new Map()
await ctx.session.hook('context',event=>originals.set(event.sessionID,{...event.tools}))
await ctx.permission.hook('evaluate',event=>{log({phase:'before',...event});if(event.action==='external_directory' && event.resources.some(r=>r===${JSON.stringify(root+'/*')}))event.effect='ask'})
const cleanup=await registerNativePermissions(ctx,new Set(['momo-orchestrator']))
await ctx.permission.hook('evaluate',event=>log({phase:'after',...event}))
// Record the production catalog, then deliberately bypass its filtering to test execute.before too.
await ctx.session.hook('context',event=>{log({phase:'context',sessionID:event.sessionID,tools:Object.keys(event.tools)});Object.assign(event.tools,originals.get(event.sessionID))})
return cleanup
}}
`)
const build=await Bun.build({entrypoints:[source],outdir:plugin,target:'bun',naming:'index.js'})
if(!build.success)throw new Error(JSON.stringify(build.logs))
await writeFile(join(config,'agents/momo-orchestrator.md'),'---\nmode: primary\ndescription: Isolated permission probe\n---\nFollow the probe instructions.\n')
await writeFile(join(config,'opencode.json'),JSON.stringify({plugins:[`file:${plugin}`],model:'momo-qa/qa',agent:'momo-orchestrator'}))
await writeFile(join(config,'service.json'),JSON.stringify({password:'local-qa'}))
const port=Bun.serve({port:0,fetch:()=>new Response('')});const servicePort=port.port;port.stop(true)
let output=''
const proc=spawn(bin,['serve','--service','--hostname','127.0.0.1','--port',String(servicePort)],{cwd:project,env,detached:true,stdio:['ignore','pipe','pipe']})
proc.stdout?.on('data',b=>output+=b);proc.stderr?.on('data',b=>output+=b)
const client=OpenCode.make({baseUrl:`http://127.0.0.1:${servicePort}`,headers:{authorization:'Basic '+Buffer.from('opencode:local-qa').toString('base64')}})
const results:Record<string,unknown>={}
try{
 let ready=false, readinessError: unknown
 for(let i=0;i<100;i++){try{const p=await client.plugin.list({location:{directory:project}});if(p.data.some(p=>p.id==='permission-probe'&&p.state.status==='active')){ready=true;break}}catch(error){readinessError=error};await Bun.sleep(100)}
 if(!ready)throw new Error('Plugin not ready '+String(readinessError)+' '+output)
 const rows=execFileSync('ps',['-Ao','pid=,pgid='],{encoding:'utf8'}).split('\n')
 const pids=rows.flatMap(row=>{const [pid,group]=row.trim().split(/\s+/).map(Number);return group===proc.pid?[pid]:[]})
 const dbPaths=new Set<string>()
 for(const pid of pids){for(const fd of await readdir('/proc/'+pid+'/fd')){try{const link=await readlink('/proc/'+pid+'/fd/'+fd);if(/opencode.*\.db(?:-(?:wal|shm))?$/.test(link))dbPaths.add(link)}catch(error){if(!(error instanceof Error)||!('code' in error)||error.code!=='ENOENT')throw error}}}
 results.databasePaths=[...dbPaths]
 if(dbPaths.size===0||[...dbPaths].some(path=>!path.startsWith(root+'/')))throw new Error('Database isolation not established')
 results.version=execFileSync(bin,['--version'],{env,cwd:project,encoding:'utf8'}).trim()
 for(const name of cases.keys()){
  const session=await client.session.create({location:{directory:project},agent:'momo-orchestrator',model:{providerID:'momo-qa',id:'qa'}})
  const pending=client.session.prompt({sessionID:session.id,text:'CASE_'+name})
  if(name==='outside'||name==='approved'){
   let asks:Awaited<ReturnType<typeof client.permission.list>>=[]
   for(let i=0;i<100;i++){asks=await client.permission.list({sessionID:session.id});if(asks.length)break;await Bun.sleep(100)}
   results[name+'Ask']=asks
   if(asks.length!==1)throw new Error('Expected outside read native permission ask')
   await client.permission.reply({sessionID:session.id,requestID:asks[0].id,decision:name==='approved'?'once':'reject'})
  }
  await pending;await client.session.wait({sessionID:session.id})
  results[name]=await client.session.context({sessionID:session.id})
 }
 results.approvedContent=await readFile(approved,'utf8');results.markerExists=await Bun.file(marker).exists()
 const tools=(name:string)=>(results[name] as {content?:{type:string;name?:string;state?:{status:string;content?:unknown;metadata?:{truncated?:boolean};error?:{message?:string}}}[]}[]).flatMap(m=>(m.content??[]).filter(c=>c.type==='tool'))
 const recovered=tools('truncation')
 if(recovered.length!==3||recovered[0].state?.metadata?.truncated!==true||recovered.slice(1).some(t=>t.state?.status!=='completed'||!JSON.stringify(t.state.content).includes('RECOVERED_NATIVE_OUTPUT')))throw new Error('Truncated artifact was not recovered through both read and grep')
 if(tools('outside')[0]?.state?.status!=='error'||tools('approved')[0]?.state?.status!=='completed')throw new Error('Native outside authorization contract failed')
 for(const name of ['shell','edit','custom'])if(!tools(name)[0]?.state?.error?.message?.includes('cannot execute'))throw new Error('Execution guard missing for '+name)
 if(results.markerExists||results.approvedContent!=='EXPLICIT_READ_OK')throw new Error('Forbidden mutation occurred')
 results.status='passed'
}catch(error){results.error=String(error);results.status='failed'}finally{
 if(proc.pid)process.kill(-proc.pid,'SIGTERM')
 if(proc.exitCode===null&&proc.signalCode===null)await new Promise(resolve=>proc.once('exit',resolve))
 model.stop(true)
 const groupExists=()=>execFileSync('ps',['-Ao','pgid='],{encoding:'utf8'}).split('\n').some(line=>Number(line.trim())===proc.pid)
 for(let i=0;i<30&&groupExists();i++)await Bun.sleep(100)
 const processGroupGone=!groupExists()
 const countsAfter=realCounts()
 results.cleanup={ownedServicePID:proc.pid,exitCode:proc.exitCode,signal:proc.signalCode,root,processGroupGone,realDatabaseCountsBefore:countsBefore,realDatabaseCountsAfter:countsAfter,realDatabaseCountsUnchanged:JSON.stringify(countsBefore)===JSON.stringify(countsAfter)}
 if(!processGroupGone){results.status='failed';results.error='Owned service process group survived cleanup'}
 await writeFile(join(evidence,'probe-result.json'),JSON.stringify(results,null,2))
 await writeFile(join(evidence,'service.log'),output)
 await writeFile(join(evidence,'model-requests.json'),JSON.stringify(requests,null,2))
 if(await Bun.file(log).exists())await copyFile(log,join(evidence,'permission-events.jsonl'))
 await copyFile(join(worktree,'script/qa/momo-native-permission-repair.ts'),join(evidence,'probe.ts'))
 await rm(root,{recursive:true,force:true})
 results.cleanup={...(results.cleanup as object),disposableRootRemoved:!await Bun.file(join(root,'config/opencode/opencode.json')).exists()}
 await writeFile(join(evidence,'probe-result.json'),JSON.stringify(results,null,2))
 console.log(JSON.stringify({status:results.status,error:results.error,evidence,root}))
}
