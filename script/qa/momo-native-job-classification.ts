#!/usr/bin/env bun
// MODIFIED: momo class-first routing and persistent catalog cache native proof.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { reply, fixture, assertRouting, type JevRequest, type Row } from "./momo-native-job-classification-fixture"
import { harness, isolatedEnv, until } from "./momo-native-job-classification-harness"
const worktree=process.cwd(), evidence=process.env.MOMO_NATIVE_EVIDENCE_DIR??join(worktree,".omo/evidence/20261018-job-classification")
if(process.argv.includes("--self-test")) {
  const classification={state:JSON.stringify({models:[{model:{providerID:"class-workers",id:"coding-a"},evidence:[{facts:{toolCall:true}}]}]}),questions:{m0c0:{instructions:"Model 0; job class coding.",criteria:{suitable:"yes",unsuitable:"no",unknown:"unknown"}}}}
  assert.equal(reply(classification).answers.m0c0?.choice,"suitable")
  assert.throws(()=>reply({...classification,state:JSON.stringify({models:[{model:{id:"coding-a"},evidence:[]}]})}),/Missing source/)
  const env=isolatedEnv("/isolated");assert(Object.keys(env).every(key=>!/TOKEN|SECRET|PASSWORD|API_KEY/.test(key)))
  new Bun.Transpiler({loader:"js"}).transformSync(fixture("/built/index.js","http://127.0.0.1:1234","/isolated/models.json"))
  const stage=(state:Row,questions:JevRequest["questions"]):JevRequest=>({state:JSON.stringify(state),questions})
  const stages=[stage({brief:{prompt:"CODE"}},{jobClass:{criteria:{coding:"code"}}}),stage({jobClass:"coding",roles:[{role:"worker"}]},{role:{criteria:{worker:"worker"}},lane:{criteria:{direct:"direct"}}}),stage({jobClass:"coding"},{candidate:{criteria:{"worker|class-workers/coding-a":"{}"}}})]
  assertRouting([...stages,...stages],["coding-a","research-a"])
  assert.throws(()=>assertRouting([...stages,{...stages[0]!,state:'{"models":["coding-a"]}'},...stages.slice(1)],["coding-a"]),/leaked/)
  console.log("job classification fixture self-test passed; no native process started");process.exit(0)
}
const binary=process.env.MOMO_NATIVE_OPENCODE_BIN
assert(binary&&isAbsolute(binary)&&existsSync(binary),"Set absolute MOMO_NATIVE_OPENCODE_BIN to real native executable")
const entry=join(worktree,"dist/index.js");assert(existsSync(entry),"Freshly build the plugin before native QA")
await mkdir(evidence,{recursive:true})
const qa=await harness(binary,evidence), modelFile=join(qa.root,"models.json"), requests:JevRequest[]=[], executions:Row[]=[], sourceRequests:Row[]=[]
let models=[{id:"coding-a",context:32000},{id:"research-a",context:32000}], mockError:string|undefined
const classification=()=>requests.filter(row=>Array.isArray((JSON.parse(row.state) as Row).models))
const classifiedIDs=(body:JevRequest)=>((JSON.parse(body.state) as {models:{model:{id:string}}[]}).models.map(row=>row.model.id))
const server=Bun.serve({port:0,async fetch(request){
  try {
    const path=new URL(request.url).pathname
    if(path.endsWith("/models")){sourceRequests.push({path,at:Date.now()});return Response.json({data:models.map(model=>({id:model.id,object:"model"}))})}
    const body=await request.json() as Row
    if(path.startsWith("/jev/")) {
      const payload=body as unknown as JevRequest;requests.push(structuredClone(payload))
      assert(!JSON.stringify(payload).includes("class-passive")&&!JSON.stringify(payload).includes("passive-model"),"Passive provider reached Jev")
      if(Array.isArray((JSON.parse(payload.state) as Row).models)) {assert(classifiedIDs(payload).length<=4);assert(Object.keys(payload.questions).length<=32);assert(Buffer.byteLength(payload.state,"utf8")<=24000)}
      return Response.json(reply(payload))
    }
    assert(path.endsWith("/chat/completions"),"Unexpected endpoint "+path)
    assert(!path.startsWith("/class-passive/"),"Passive provider reached native model execution")
    const messages=body.messages as {role:string;content:unknown}[], text=JSON.stringify(messages), worker=path.startsWith("/class-workers/")
    executions.push({path,model:body.model,text})
    const marker=text.includes("TASK_CODE_SECOND_PROJECT")?"TASK_CODE_SECOND_PROJECT":text.includes("TASK_RESEARCH")?"TASK_RESEARCH":"TASK_CODE"
    const call=!worker&&!messages.some(message=>message.role==="tool")&&(body.tools as {function?:{name?:string}}[]|undefined)?.some(tool=>tool.function?.name==="execute")
    const delta=call?{tool_calls:[{index:0,id:"call_"+crypto.randomUUID().replaceAll("-",""),type:"function",function:{name:"execute",arguments:JSON.stringify({code:`return JSON.parse(await tools.momo_task({action:'create',prompt:'${marker}_CHILD'}))`})}}]}:{content:worker?"CLASS_WORK_COMPLETE":"CLASS_ROOT_COMPLETE"}
    const chunk=(value:unknown,finish:unknown)=>({id:"class-qa",object:"chat.completion.chunk",created:1,model:body.model,choices:[{index:0,delta:value,finish_reason:finish}]})
    return new Response(`data: ${JSON.stringify(chunk(delta,null))}\n\ndata: ${JSON.stringify(chunk({},call?"tool_calls":"stop"))}\n\ndata: [DONE]\n\n`,{headers:{"content-type":"text/event-stream"}})
  } catch(error){mockError=String(error);return Response.json({error:mockError},{status:500})}
}})
async function sourceHashes() {
  const paths = new Set(["dist/index.js", "packages/omo-opencode/src/config/schema/catalog.ts",
    ...["momo-native-job-classification.ts", "momo-native-job-classification-fixture.ts", "momo-native-job-classification-harness.ts"].map(path => "script/qa/" + path)])
  for (const module of ["native-catalog", "native-routing", "native-runtime", "native-task"]) {
    const prefix = "packages/omo-opencode/src/" + module + "/"
    for await (const path of new Bun.Glob("**/*.ts").scan(join(worktree, prefix))) {
      if (!path.endsWith(".test.ts")) paths.add(prefix + path)
    }
  }
  return Object.fromEntries(await Promise.all([...paths].sort().map(async path => [path, createHash("sha256").update(await readFile(join(worktree, path))).digest("hex")])))
}
const result:Row={status:"running",uncovered:["paid malformed classifier and routing shared-budget restart native scenario"],bundleSHA256:createHash("sha256").update(await readFile(entry)).digest("hex")}
try {
  result.sourceHashesBefore=await sourceHashes()
  await writeFile(modelFile,JSON.stringify(models))
  await writeFile(join(qa.plugin,"package.json"),JSON.stringify({name:"job-class-qa",type:"module",exports:{".":"./index.js"}}))
  const source=fixture(entry,`http://127.0.0.1:${server.port}`,modelFile);await writeFile(join(qa.plugin,"index.js"),source);await writeFile(join(evidence,"fixture.js"),source)
  await writeFile(join(qa.env.HOME!,".omo/provider-toggles.json"),JSON.stringify({version:1,disabled:["class-passive"],updatedAt:new Date().toISOString()}))
  async function pool(){await writeFile(join(qa.env.HOME!,".omo/model-pool.json"),JSON.stringify({version:1,allowed:[...models.map(row=>({providerID:"class-workers",modelID:row.id})),{providerID:"class-passive",modelID:"passive-model"}],updatedAt:new Date().toISOString()}))}
  await pool()
  await writeFile(join(qa.project,".omo/omo.jsonc"),JSON.stringify({"[opencode]":{catalog:{job_classes:[{id:"coding",description:"Implement and debug software"},{id:"research",description:"Find and verify information"}]},manager:{jev:{provider_id:"class-manager",base_url:`http://127.0.0.1:${server.port}/jev/v1`,max_attempts:1,budget:{monthly_cap_usd:2,warn_at_usd:1.5}}}}}))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!,"opencode.json"),JSON.stringify({plugins:[`file:${qa.plugin}`],model:"class-root/root",agent:"momo-orchestrator"}))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!,"service.json"),JSON.stringify({password:"local-qa"}))
  const profilePath=join(qa.env.HOME!,".omo/native/projects",createHash("sha256").update(qa.project).digest("hex").slice(0,24),"job-classifications.json")
  async function persisted(id:string,context:number){
    await until(async()=>{try{return JSON.parse(await readFile(profilePath,"utf8")) as {profiles:Record<string,{model:{id:string};evidence:{source:string;facts:Row}[]}>}}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {profiles:{}};throw error}},data=>Object.values(data.profiles).some(profile=>profile.model.id===id&&profile.evidence.some(item=>item.source==="opencode.model.list"&&item.facts.contextLength===context)),"persisted source-backed profile "+id)
  }
  let client=await qa.start();result.version=(await client.server.info()).version
  await until(async()=>classification().length,count=>count===1,"initial classification")
  assert.deepEqual(classifiedIDs(classification()[0]!).sort(),["coding-a","research-a"])
  await persisted("coding-a",32000);await persisted("research-a",32000)
  result.initialSourceFacts=(JSON.parse(classification()[0]!.state) as Row).models
  async function runTask(marker:string,directory=qa.project){
    const session=await client.session.create({location:{directory},agent:"momo-orchestrator",model:{providerID:"class-root",id:"root"}})
    await client.session.prompt({sessionID:session.id,text:marker})
    await until(async()=>{
      const response=await client.rpc.call({rpcID:"momo.native",method:"tasks",input:{rootSessionID:session.id},location:{directory}})
      return (((response as {output?:unknown}).output??response) as {tasks:Row[]}).tasks
    },rows=>rows.some(row=>row.prompt===marker+"_CHILD"&&row.state==="succeeded"),marker+" child success",45000)
    await client.session.wait({sessionID:session.id})
  }
  for(const marker of ["TASK_CODE","TASK_RESEARCH"]) await runTask(marker)
  const routing=requests.filter(row=>!Array.isArray((JSON.parse(row.state) as Row).models));assertRouting(routing,models.map(row=>row.id))
  assert(executions.some(row=>row.model==="coding-a")&&executions.some(row=>row.model==="research-a"),"Selected class workers did not execute")
  assert.equal(classification().length,1,"Tasks reclassified unchanged catalog")
  await qa.stop();const beforeRestart=classification().length;client=await qa.start();await Bun.sleep(1500)
  assert.equal(classification().length,beforeRestart,"Unchanged catalog reclassified after restart")
  result.unchangedRestartClassificationCalls=0
  await qa.stop()
  const secondProject=join(qa.root,"second-project");await mkdir(join(secondProject,".omo"),{recursive:true})
  await writeFile(join(secondProject,".omo/omo.jsonc"),await readFile(join(qa.project,".omo/omo.jsonc")))
  client=await qa.start(secondProject)
  const secondRoot=join(qa.env.HOME!,".omo/native/projects",createHash("sha256").update(secondProject).digest("hex").slice(0,24))
  await until(async()=>{try{return JSON.parse(await readFile(join(secondRoot,"job-classification-maintenance.json"),"utf8")) as {entries:Row;batches:number}}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error}},value=>value!==undefined&&Object.keys(value.entries).length===0,"second-project shared catalog cache")
  const beforeSecondRouting=requests.length
  await runTask("TASK_CODE_SECOND_PROJECT",secondProject)
  assertRouting(requests.slice(beforeSecondRouting),models.map(row=>row.id),1)
  assert.equal(classification().length,beforeRestart,"Second project reclassified unchanged catalog")
  assert(!existsSync(join(secondRoot,"job-classifications.json")),"Shared cache read imported another project's receipt snapshot")
  const secondLedger=join(secondRoot,"routing-ledger.jsonl")
  if(existsSync(secondLedger)) assert(!String(await readFile(secondLedger,"utf8")).includes('"purpose":"classification"'),"Shared profile reuse imported classification billing")
  result.secondProjectClassificationCalls=0;result.secondProjectImportedClassificationReceipts=0;result.secondProjectWorkerSucceeded=true
  await qa.stop();models.push({id:"coding-b",context:32000});await writeFile(modelFile,JSON.stringify(models));await pool();client=await qa.start()
  await until(async()=>classification().length,count=>count===beforeRestart+1,"new model classification")
  assert.deepEqual(classifiedIDs(classification().at(-1)!),["coding-b"]);await persisted("coding-b",32000);result.newModelOnly=true
  await qa.stop();models=models.map(row=>row.id==="coding-a"?{...row,context:64000}:row);await writeFile(modelFile,JSON.stringify(models));client=await qa.start()
  await until(async()=>classification().length,count=>count===beforeRestart+2,"changed source classification")
  assert.deepEqual(classifiedIDs(classification().at(-1)!),["coding-a"]);await persisted("coding-a",64000);result.sourceChangeOnly=true
  await qa.capture();assert.equal(mockError,undefined);assert.equal(createHash("sha256").update(await readFile(entry)).digest("hex"),result.bundleSHA256,"Built plugin changed during probe")
  result.sourceHashesAfter=await sourceHashes();assert.deepEqual(result.sourceHashesAfter,result.sourceHashesBefore,"Native source/bundle changed during proof")
  result.routingStages=routing.length;result.classificationCalls=classification().length;result.status="passed"
} catch(error){result.status="failed";result.error=String(error)} finally {
  try{result.cleanup=await qa.cleanup()}catch(error){result.status="failed";result.cleanupError=String(error)}
  server.stop(true)
  await writeFile(join(evidence,"requests.json"),JSON.stringify({requests,executions,sourceRequests},null,2))
  await writeFile(join(evidence,"summary.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.status!=="passed")process.exitCode=1
}
