// MODIFIED: momo isolated native classification QA protocol fixtures.
import assert from "node:assert/strict"
export type Row = Record<string, unknown>
export type Questions = Record<string, { criteria: Record<string, string>; instructions?: string }>
export interface JevRequest { state: string; questions: Questions }
export function reply(body: JevRequest) {
  const state = JSON.parse(body.state) as { models?: { model: { providerID: string; id: string }; evidence: unknown[] }[]; brief?: { prompt?: string }; jobClass?: string }
  const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
    let choice: string | undefined
    if (state.models) {
      const match = /^m(\d+)c(\d+)$/.exec(key); assert(match)
      const model = state.models[Number(match[1])]!; assert(model.evidence.length > 0, "Missing source facts before classification")
      const classId = question.instructions?.split("class ")[1]?.replace(/\.$/, "")
      choice = model.model.id.startsWith(classId ?? "missing") ? "suitable" : "unsuitable"
    } else if (key === "jobClass") choice = state.brief?.prompt?.includes("RESEARCH") ? "research" : "coding"
    else if (key === "role") choice = "worker"
    else if (key === "lane") choice = "direct"
    else if (key === "candidate") choice = Object.keys(question.criteria).find(value => value === `worker|class-workers/${state.jobClass}-a`)
    assert(choice && Object.hasOwn(question.criteria, choice), "Unsupported fixture question: " + key)
    return [key, { type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } }]
  }))
  return { answers, usage: { input_tokens: 23, output_tokens: 5000 } }
}
export function assertRouting(requests: JevRequest[], modelIDs: string[], taskCount = 2) {
  assert.equal(requests.length, taskCount * 3, "Each task requires three routing HTTP stages")
  for (let index = 0; index < requests.length; index += 3) {
    const [job, role, model] = requests.slice(index, index + 3)
    assert(job && role && model)
    assert.deepEqual(Object.keys(job.questions), ["jobClass"])
    assert.deepEqual(Object.keys(role.questions).sort(), ["role"])
    for (const body of [job, role]) for (const id of modelIDs) assert(!JSON.stringify(body).includes(id), "Early routing stage leaked model identity")
    assert.deepEqual(Object.keys(model.questions), ["candidate"])
    const jobClass = (JSON.parse(model.state) as { jobClass: string }).jobClass
    assert(Object.keys(model.questions.candidate!.criteria).every(key => key.startsWith(`worker|class-workers/${jobClass}-`)), "Model stage leaked another class or role")
  }
}
export function fixture(entry: string, modelURL: string, modelFile: string) {
  return `import momo from ${JSON.stringify(entry)};import {readFileSync} from 'node:fs';
export default {id:'oh-my-openagent',async setup(ctx){
 const models=JSON.parse(readFileSync(${JSON.stringify(modelFile)},'utf8'));
 await ctx.provider.transform(editor=>{for(const [id,rows] of [['class-root',[{id:'root',context:32000}]],['class-workers',models],['class-passive',[{id:'passive-model',context:32000}]],['class-manager',[]]]){
 editor.add({info:{id,name:id,activation:'enabled',package:'aisdk:@ai-sdk/openai-compatible',settings:{baseURL:${JSON.stringify(modelURL)}+'/'+id+'/v1',apiKey:'local-only'}},models:rows.map(row=>({id:row.id,modelID:row.id,providerID:id,name:row.id,capabilities:{tools:true,input:['text'],output:['text']},variants:[],time:{released:0},cost:[{input:1,output:1,cache:{read:0,write:0}}],status:'active',enabled:true,limit:{context:row.context,output:4096}}))});
 }});await ctx.provider.reload();return momo.setup(ctx)}};`
}
