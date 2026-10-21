// MODIFIED: deterministic provider and routing responses for native tool-contract QA.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import type { JevRequest } from "./momo-native-job-classification-fixture"

export interface ContractRequest {
  model: string
  messages: { role: string; content?: unknown }[]
  tools?: { function?: { name?: string; parameters?: unknown } }[]
}
export function contractReply(request: JevRequest) {
  const answers = Object.fromEntries(Object.entries(request.questions).map(([key, question]) => {
    const keys = Object.keys(question.criteria)
    const choice = key === "jobClass" ? "coding" : key === "role" ? keys.includes("advisor") ? "advisor" : "worker" :
      key === "candidate" ? keys.find(value => value === "worker|contract/worker") ?? keys.find(value => value === "advisor|contract/advisor") :
      key === "lane" ? "direct" : keys.includes("suitable") ? "suitable" : keys[0]
    assert(choice && keys.includes(choice), `No valid fixture answer for ${key}`)
    return [key, { type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } }]
  }))
  return { answers, usage: { input_tokens: 17, output_tokens: 11 } }
}
export function contractResponse(model: string, value: { text: string } | { code: string } | { tool: { name: string; arguments: unknown } }): Response {
  const call = !("text" in value)
  const selected = "code" in value ? { name: "execute", arguments: { code: value.code } } : "tool" in value ? value.tool : undefined
  const delta = selected ? { tool_calls: [{ index: 0, id: "call_" + crypto.randomUUID().replaceAll("-", ""), type: "function", function: { name: selected.name, arguments: JSON.stringify(selected.arguments) } }] } : { content: "text" in value ? value.text : "" }
  const chunk = (payload: unknown, finish: unknown) => ({ id: "contract-qa", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta: payload, finish_reason: finish }] })
  return new Response(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, call ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
}
export function requestSummary(request: ContractRequest) {
  const encode = (value: unknown) => JSON.stringify(value)
  const tools = encode(request.tools ?? []), system = encode(request.messages.filter(message => message.role === "system" || message.role === "developer"))
  const hash = (text: string) => createHash("sha256").update(text).digest("hex")
  return { model: request.model, toolNames: request.tools?.map(tool => tool.function?.name), toolSchemaBytes: Buffer.byteLength(tools), toolSchemaSHA256: hash(tools), systemBytes: Buffer.byteLength(system), systemSHA256: hash(system), messageCount: request.messages.length }
}
const parse = `const task = async input => JSON.parse(await tools.momo_task(input)); const consult = async input => JSON.parse(await tools.momo_consult(input)); const check = (value, label) => { if (!value) throw new Error(label); };`
export const emptyCode = `${parse}
const help = await task({action:'help',operation:'answer'}); const caps = await task({action:'capabilities'});
check(help.inputSchema.properties.questionID && help.inputSchema.properties.answer,'answer schema missing');
let rejected=false;try{await task({action:'create',prompt:'INVALID_FORGED_MODEL',modelID:'forged'});}catch(error){rejected=true;}
check(rejected && (await task({action:'list'})).total===0,'strict handler accepted invented model binding');
check(!caps.consultation.enabled && caps.consultation.reason==='advisor_pool_empty','empty advisor pool not explained');
return {proof:'EMPTY_CONTRACT_PASSED',version:help.contractVersion,capabilities:caps};`
export const createCode = `${parse}
const caps = await task({action:'capabilities'});check(caps.consultation.enabled && caps.consultation.eligibleCount===1,'advisor not available');
const help = await task({action:'help',operation:'create'});check(help.inputSchema.properties.prompt,'create schema missing');
const created = await task({action:'create',prompt:'CONTRACT_WORKER',scope:'Ask advisor, then request missing fixture input.',acceptance:'Same child completes after advice and root answer.',view:'brief'});
const full = await task({action:'status',taskID:created.id}); const brief = await task({action:'status',taskID:created.id,view:'brief'});
check(full.id===brief.id && typeof brief.state==='string','brief changed identity or omitted state');check(JSON.stringify(brief).length<JSON.stringify(full).length,'brief not smaller');
return {proof:'ROOT_CREATED',taskID:created.id,fullBytes:JSON.stringify(full).length,briefBytes:JSON.stringify(brief).length};`
export const workerCode = `${parse}
const help = await consult({action:'help',operation:'start'}); const caps = await consult({action:'capabilities'});
check(help.inputSchema.properties.prompt && caps.consultation.enabled && caps.questions.supported,'worker capabilities missing');
const advice = await consult({action:'start',prompt:'CONTRACT_ADVISOR: give one concise recommendation.',waitMs:60000,view:'brief'});
check(advice.state==='succeeded' && advice.model.id==='advisor','distinct advisor did not complete');
return {proof:'WORKER_CONSULTED',advisorTaskID:advice.id,model:advice.model};`
export const answerCode = `${parse}
const listed = await task({action:'list'}); const worker = listed.tasks.find(row=>row.prompt==='CONTRACT_WORKER');check(worker,'worker not found');
const detail = await task({action:'detail',taskID:worker.id});
if(detail.state!=='waiting_question')return {proof:'QUESTION_ALREADY_HANDLED',state:detail.state};
check(detail.question.id && detail.questionFields.length>0,'question not forwarded');
const values=Object.fromEntries(detail.questionFields.map(field=>[field.key,field.options?.[0]?.value??'fixture-input']));
const answered = await task({action:'answer',taskID:worker.id,questionID:detail.question.id,answer:values,view:'brief'});
return {proof:'ROOT_ANSWERED',taskID:worker.id,questionID:detail.question.id,state:answered.state};`
export function contractFixture(entry: string, url: string): string {
  return `import momo from ${JSON.stringify(entry)};
export default{id:'oh-my-openagent',async setup(ctx){
const names=['root','worker','advisor'];const baseURL=${JSON.stringify(url)}+'/contract/v1';
const metadata={contract:{api:baseURL,npm:'@ai-sdk/openai-compatible',models:Object.fromEntries(names.map(id=>[id,{id,name:id,description:'Controlled contract QA model.',cost:{input:1,output:1}}]))}};
const original=globalThis.fetch;globalThis.fetch=Object.assign((input,init)=>{const target=typeof input==='string'?input:input instanceof URL?input.href:input.url;return target==='https://models.dev/api.json'?Promise.resolve(Response.json(metadata)):original(input,init)},{preconnect:original.preconnect});
await ctx.provider.transform(editor=>{for(const row of editor.list())editor.remove(row.provider.id);
editor.add({info:{id:'contract',name:'Contract QA',activation:'enabled',package:'aisdk:@ai-sdk/openai-compatible',settings:{baseURL,apiKey:'isolated-only'}},models:names.map(id=>({id,modelID:id,providerID:'contract',name:id,capabilities:{tools:true,input:['text'],output:['text']},variants:[],time:{released:0},cost:[{input:1,output:1,cache:{read:0,write:0}}],status:'active',enabled:true,limit:{context:32000,output:8192}}))});});await ctx.provider.reload();return momo.setup(ctx)}};`
}

interface QuestionSchema { type?: string; const?: unknown; enum?: unknown[]; properties?: Record<string, QuestionSchema>; required?: string[]; items?: QuestionSchema; anyOf?: QuestionSchema[]; oneOf?: QuestionSchema[] }
export function questionArguments(schema: unknown, depth = 0): unknown {
  assert(schema && typeof schema === "object" && depth < 12, "Unsupported question schema")
  const input = schema as QuestionSchema
  if (input.const !== undefined) return input.const
  if (input.enum?.length) return input.enum[0]
  const variants = input.anyOf ?? input.oneOf
  if (variants?.length) return questionArguments(variants[0], depth + 1)
  if (input.type === "array") return [questionArguments(input.items, depth + 1)]
  if (input.type === "object" || input.properties) return Object.fromEntries((input.required ?? Object.keys(input.properties ?? {})).map(key => [key, questionArguments(input.properties?.[key], depth + 1)]))
  return input.type === "boolean" ? true : input.type === "number" || input.type === "integer" ? 1 : "Continue"
}
