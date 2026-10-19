#!/usr/bin/env bun
// MODIFIED: momo native classification and routing share one input-only budget.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { fixture, type JevRequest, type Row } from "./momo-native-job-classification-fixture"
import { harness, until } from "./momo-native-job-classification-harness"
const scenario=process.env.MOMO_NATIVE_JOB_CLASS_BILLING??"paid"
assert(scenario==="paid"||scenario==="unknown","Expected paid or unknown billing scenario")
const worktree=process.cwd(), evidence=process.env.MOMO_NATIVE_EVIDENCE_DIR??join(worktree,".omo/evidence/20261018-job-classification-billing-"+scenario)
const cost=100*0.042/1_000_000
function ledger(text:string):Row[] {
  const nodes=new Map<string,Row>(), latest=new Map<string,Row>()
  function atom(value:unknown):unknown {
    if(value===null||typeof value!=="object")return value
    assert(!Array.isArray(value)&&Object.keys(value).length===1&&typeof (value as Row).ref==="string","Invalid ledger atom")
    return decode((value as {ref:string}).ref)
  }
  function decode(hash:string):unknown {
    const node=nodes.get(hash);assert(node,"Missing ledger content node")
    if(node.kind==="array"){assert(Array.isArray(node.items));return node.items.map(atom)}
    assert(node.kind==="object"&&node.fields&&typeof node.fields==="object")
    return Object.fromEntries(Object.entries(node.fields as Row).map(([key,value])=>[key,atom(value)]))
  }
  for(const line of text.trim().split("\n")){
    if(!line)continue
    const row=JSON.parse(line) as Row
    if(row.version===2&&row.type==="content") {
      assert.equal(createHash("sha256").update(JSON.stringify(row.node)).digest("hex"),row.hash,"Ledger content digest mismatch")
      nodes.set(row.hash as string,row.node as Row);continue
    }
    const record=(row.version===2&&row.type==="record"?decode(row.ref as string):row) as Row
    const identity=record.type==="jev_call"?record.callId:record.type==="decision"?record.decisionId:record.type
    latest.set(String(record.type)+":"+String(identity),record)
  }
  return [...latest.values()]
}
function verifyPaid(rows:Row[], mode:string=scenario) {
  const paid=rows.filter(row=>row.type==="jev_call"&&row.purpose==="classification")
  assert.equal(paid.length,1,"Exactly one canonical classifier call must own paid response")
  assert.equal(paid[0]!.status,"complete")
  const usage=paid[0]!.usage as Row|undefined
  if(mode==="paid") {assert(usage);assert.equal(usage.inputTokens,100);assert.equal(usage.outputTokens,999);assert.equal(usage.costUsd,cost,"Only input usage may determine spend")}
  else {assert.equal(usage?.inputTokens,undefined);assert.equal(usage?.costUsd,undefined,"Missing input usage must not invent free or output-only cost");assert.equal(usage?.outputTokens,999)}
  const routing=rows.filter(row=>row.type==="jev_call"&&row.purpose==="routing")
  assert(routing.every(row=>row.status==="not_sent"&&row.usage===undefined),"Blocked routing must have no billed HTTP")
  return paid[0]!
}
async function sourceHashes(){
  const paths=["dist/index.js","script/qa/momo-native-job-classification-billing.ts","script/qa/momo-native-job-classification-harness.ts","script/qa/momo-native-job-classification-fixture.ts",...[
    "native-runtime/task-tools.ts","native-runtime/catalog-job-routing.ts","native-runtime/job-classifier.ts","native-routing/jev-accountant.ts","native-routing/router.ts","native-catalog/job-classification-codec.ts","native-catalog/job-classification-executor.ts",
  ].map(path=>"packages/omo-opencode/src/"+path)]
  return Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash("sha256").update(await readFile(join(worktree,path))).digest("hex")])))
}
if(process.argv.includes("--self-test")){
  const paid={version:1,type:"jev_call",callId:"classification:fixture",purpose:"classification",status:"complete",usage:{inputTokens:100,outputTokens:999,costUsd:cost}}
  assert.equal(verifyPaid(ledger(JSON.stringify(paid)),"paid").callId,paid.callId)
  assert.throws(()=>verifyPaid([{...paid,usage:{...paid.usage,costUsd:0}}],"paid"),/Only input/)
  assert.throws(()=>verifyPaid([paid,{type:"jev_call",purpose:"routing",status:"complete",usage:{costUsd:0}}],"paid"),/Blocked routing/)
  assert.throws(()=>ledger(JSON.stringify({version:2,type:"content",hash:"wrong",node:{kind:"object",fields:{}}})),/digest mismatch/)
  assert.equal(verifyPaid([{...paid,usage:{outputTokens:999}}],"unknown").callId,paid.callId)
  assert.throws(()=>verifyPaid([{...paid,usage:{outputTokens:999,costUsd:0}}],"unknown"),/Missing input usage/)
  console.log("classification billing fixture self-test passed; no native process started");process.exit(0)
}
const binary=process.env.MOMO_NATIVE_OPENCODE_BIN
assert(binary&&isAbsolute(binary)&&existsSync(binary),"Set absolute native executable MOMO_NATIVE_OPENCODE_BIN")
const entry=join(worktree,"dist/index.js");assert(existsSync(entry),"Build plugin first")
await mkdir(evidence,{recursive:true})
const qa=await harness(binary,evidence), requests:JevRequest[]=[], models=[{id:"coding-a",context:32000},{id:"research-a",context:32000}], executions:Row[]=[]
const dataRoot=join(qa.env.HOME!,".omo/native/projects",createHash("sha256").update(qa.project).digest("hex").slice(0,24))
const ledgerPath=join(dataRoot,"routing-ledger.jsonl"), modelFile=join(qa.root,"models.json")
let mockError:string|undefined
const result:Row={status:"running",scenario,budgetCapUsd:cost,uncovered:[]}
const server=Bun.serve({port:0,async fetch(request){
  try{
    const path=new URL(request.url).pathname
    if(path.endsWith("/models"))return Response.json({data:models.map(model=>({id:model.id,object:"model"}))})
    const body=await request.json() as Row
    if(path.startsWith("/jev/")){
      const payload=body as unknown as JevRequest;requests.push(structuredClone(payload))
      assert.equal(requests.length,1,"Shared exhausted budget allowed extra Jev HTTP")
      const state=JSON.parse(payload.state) as {models?:unknown[]};assert(Array.isArray(state.models),"Initial paid call was not classifier")
      assert(state.models.length<=4&&Object.keys(payload.questions).length<=32);assert(Buffer.byteLength(payload.state,"utf8")<=24000)
      return Response.json({answers:{},usage:scenario==="paid"?{input_tokens:100,output_tokens:999}:{output_tokens:999}})
    }
    assert(path.startsWith("/class-root/")&&path.endsWith("/chat/completions"),"No child model may execute while shared budget exhausted")
    const messages=body.messages as {role:string;content:unknown}[], text=JSON.stringify(messages)
    executions.push({path,model:body.model,text})
    const marker=text.includes("BILLING_AFTER_RESTART")?"BILLING_AFTER_RESTART":"BILLING_BEFORE_RESTART"
    const call=!messages.some(message=>message.role==="tool")&&(body.tools as {function?:{name?:string}}[]|undefined)?.some(tool=>tool.function?.name==="execute")
    const delta=call?{tool_calls:[{index:0,id:"call_"+crypto.randomUUID().replaceAll("-",""),type:"function",function:{name:"execute",arguments:JSON.stringify({code:`return JSON.parse(await tools.momo_task({action:'create',prompt:'${marker}_CHILD'}))`})}}]}:{content:"BILLING_ROOT_COMPLETE"}
    const chunk=(value:unknown,finish:unknown)=>({id:"billing-qa",object:"chat.completion.chunk",created:1,model:body.model,choices:[{index:0,delta:value,finish_reason:finish}]})
    return new Response(`data: ${JSON.stringify(chunk(delta,null))}\n\ndata: ${JSON.stringify(chunk({},call?"tool_calls":"stop"))}\n\ndata: [DONE]\n\n`,{headers:{"content-type":"text/event-stream"}})
  }catch(error){mockError=String(error);return Response.json({error:mockError},{status:500})}
}})
async function records(){try{return ledger(await readFile(ledgerPath,"utf8"))}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT"||error instanceof SyntaxError)return [];throw error}}
try{
  result.sourceHashesBefore=await sourceHashes()
  await writeFile(modelFile,JSON.stringify(models));await writeFile(join(qa.plugin,"package.json"),JSON.stringify({name:"job-class-billing-qa",type:"module",exports:{".":"./index.js"}}))
  const source=fixture(entry,`http://127.0.0.1:${server.port}`,modelFile);await writeFile(join(qa.plugin,"index.js"),source);await writeFile(join(evidence,"fixture.js"),source)
  await writeFile(join(qa.env.HOME!,".omo/model-pool.json"),JSON.stringify({version:1,allowed:models.map(model=>({providerID:"class-workers",modelID:model.id})),updatedAt:new Date().toISOString()}))
  await writeFile(join(qa.env.HOME!,".omo/provider-toggles.json"),JSON.stringify({version:1,disabled:["class-passive"],updatedAt:new Date().toISOString()}))
  await writeFile(join(qa.project,".omo/omo.jsonc"),JSON.stringify({"[opencode]":{catalog:{job_classes:[{id:"coding",description:"Implement software"},{id:"research",description:"Verify information"}]},manager:{jev:{provider_id:"class-manager",base_url:`http://127.0.0.1:${server.port}/jev/v1`,max_attempts:1,budget:{monthly_cap_usd:cost,warn_at_usd:cost}}}}}))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!,"opencode.json"),JSON.stringify({plugins:[`file:${qa.plugin}`],model:"class-root/root",agent:"momo-orchestrator"}));await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!,"service.json"),JSON.stringify({password:"local-qa"}))
  let client=await qa.start();result.version=(await client.server.info()).version
  await until(records,rows=>rows.some(row=>row.type==="jev_call"&&row.purpose==="classification"&&row.status==="complete"),"durable paid malformed classification receipt")
  result.initialPaidReceipt=verifyPaid(await records())
  const decisions:string[]=[]
  async function blockedTask(marker:string){
    const session=await client.session.create({location:{directory:qa.project},agent:"momo-orchestrator",model:{providerID:"class-root",id:"root"}})
    await client.session.prompt({sessionID:session.id,text:marker})
    const tasks=await until(async()=>{
      const response=await client.rpc.call({rpcID:"momo.native",method:"tasks",input:{rootSessionID:session.id},location:{directory:qa.project}})
      return (((response as {output?:unknown}).output??response) as {tasks:Row[]}).tasks
    },rows=>rows.some(row=>row.prompt===marker+"_CHILD"&&row.state==="awaiting_selection"),marker+" caller choice",45000)
    await client.session.wait({sessionID:session.id});assert.equal(requests.length,1)
    const task=tasks.find(row=>row.prompt===marker+"_CHILD")!;assert(!task.sessionID,"Budget-blocked child allocated a native session")
    const rows=await until(records,items=>items.some(row=>row.type==="decision"&&row.decisionId===task.decisionId),marker+" durable routing decision")
    const decision=rows.find(row=>row.type==="decision"&&row.decisionId===task.decisionId)!;assert.equal(((decision.request as Row).input as Row).prompt,marker+"_CHILD");assert.equal(decision.jevAttempted,false);assert.equal(decision.jevUsage,undefined)
    assert((scenario==="paid"?/budget cap/i:/monthly spend is unknown/i).test(String(decision.reason)),"Caller choice did not preserve actual budget admission reason")
    decisions.push(String(decision.decisionId));return {task,decision}
  }
  result.beforeRestart=await blockedTask("BILLING_BEFORE_RESTART")
  await qa.stop();client=await qa.start();await Bun.sleep(1500);assert.equal(requests.length,1,"Restart reissued failed classification")
  result.afterRestart=await blockedTask("BILLING_AFTER_RESTART");assert.equal(new Set(decisions).size,2,"Restart must exercise a fresh routing decision")
  const final=await records();result.finalPaidReceipt=verifyPaid(final);assert.deepEqual(result.finalPaidReceipt,result.initialPaidReceipt,"Paid canonical receipt changed or duplicated across restart")
  result.classifierMaintenance=JSON.parse(await readFile(join(dataRoot,"job-classification-maintenance.json"),"utf8"))
  await qa.capture();assert.equal(mockError,undefined);result.sourceHashesAfter=await sourceHashes();assert.deepEqual(result.sourceHashesAfter,result.sourceHashesBefore,"Source/bundle changed during proof")
  await writeFile(join(evidence,"ledger.json"),JSON.stringify(final,null,2));result.totalJevHTTP=1;result.status="passed"
}catch(error){result.status="failed";result.error=String(error)}finally{
  try{await writeFile(join(evidence,"ledger-final.json"),JSON.stringify(await records(),null,2))}catch(error){result.diagnosticLedgerError=String(error)}
  try{result.cleanup=await qa.cleanup()}catch(error){result.status="failed";result.cleanupError=String(error)}server.stop(true)
  await writeFile(join(evidence,"requests.json"),JSON.stringify({requests,executions},null,2));await writeFile(join(evidence,"summary.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.status!=="passed")process.exitCode=1
}
