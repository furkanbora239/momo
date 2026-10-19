// MODIFIED: controlled HTTP fixtures for real native shared-catalog QA.
import assert from "node:assert/strict"
import type { JevRequest } from "./momo-native-job-classification-fixture"

export const researchedSummary = "QA researched model supports coding, research and planning with cited documentation."
export const researchEntry = { providerID: "qa-new", id: "unresearched-v1", summary: researchedSummary,
  strengths: ["source-backed research", "code editing"], limitations: ["controlled QA model"], sources: ["https://example.test/models/unresearched-v1"] }
export interface FixtureModel { providerID: string; id: string; price: number }
export function classificationReply(body: JevRequest) {
  const state = JSON.parse(body.state) as { models?: { model: { providerID: string; id: string }; evidence: unknown[] }[] }
  assert(state.models && state.models.length <= 4, "Only bounded classification requests are expected")
  assert(!JSON.stringify(body).includes("qa-disabled"), "Disabled provider leaked to Jev")
  const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
    assert(Object.hasOwn(question.criteria, "suitable"))
    return [key, { type: "choice", choice: "suitable", confidence: 1, probabilities: { suitable: 1 } }]
  }))
  return { answers, usage: { input_tokens: 23, output_tokens: 40 } }
}

export function researchResponse(body: { model: string; messages: { role: string }[]; tools?: { function?: { name?: string } }[] }): Response {
  const direct = body.tools?.some(tool => tool.function?.name === "momo_catalog_enrich")
  const call = !body.messages.some(message => message.role === "tool")
  assert(!call || direct || body.tools?.some(tool => tool.function?.name === "execute"), "Research enrichment tool unavailable")
  const args = direct ? researchEntry : { code: `return await tools.momo_catalog_enrich(${JSON.stringify(researchEntry)})` }
  const delta = call ? { tool_calls: [{ index: 0, id: "call_" + crypto.randomUUID().replaceAll("-", ""), type: "function", function: {
    name: direct ? "momo_catalog_enrich" : "execute", arguments: JSON.stringify(args),
  } }] } : { content: "Source-backed model research saved." }
  const chunk = (value: unknown, finish: unknown) => ({ id: "shared-catalog-qa", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: value, finish_reason: finish }] })
  return new Response(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, call ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
}

export function sharedCatalogFixture(entry: string, baseURL: string, modelFile: string): string {
  return `import momo from ${JSON.stringify(entry)};import{readFileSync}from'node:fs';
export default{id:'oh-my-openagent',async setup(ctx){
 const rows=JSON.parse(readFileSync(${JSON.stringify(modelFile)},'utf8'));
 const metadata=Object.fromEntries(rows.map(row=>[row.providerID,{api:${JSON.stringify(baseURL)}+'/'+row.providerID+'/v1',npm:'@ai-sdk/openai-compatible',models:{[row.id]:{id:row.id,name:row.id,description:'Controlled QA published metadata.',cost:{input:row.price,output:row.price}}}}]));
 const original=globalThis.fetch;globalThis.fetch=Object.assign((input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;return url==='https://models.dev/api.json'?Promise.resolve(Response.json(metadata)):original(input,init)},{preconnect:original.preconnect});
 await ctx.provider.transform(editor=>{for(const row of editor.list())editor.remove(row.provider.id);
 for(const row of [...rows,{providerID:'qa-manager',id:'manager',price:1}])editor.add({info:{id:row.providerID,name:row.providerID,activation:'enabled',package:'aisdk:@ai-sdk/openai-compatible',settings:{baseURL:${JSON.stringify(baseURL)}+'/'+row.providerID+'/v1',apiKey:'isolated-fixture-only'}},models:row.providerID==='qa-manager'?[]:[{id:row.id,modelID:row.id,providerID:row.providerID,name:row.id,capabilities:{tools:true,input:['text'],output:['text']},variants:[],time:{released:0},cost:[{input:row.price,output:row.price,cache:{read:0,write:0}}],status:'active',enabled:true,limit:{context:32000,output:4096}}]});
 });await ctx.provider.reload();return momo.setup(ctx)}};`
}
