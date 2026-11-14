// MODIFIED: isolated MCP lifecycle and in-flight completion fixture, no credentials.
import { createInterface } from 'node:readline'
import { appendFileSync } from 'node:fs'
const [log, label] = process.argv.slice(2)
const record = event => appendFileSync(log, JSON.stringify({ event, label, cwd: process.cwd(), pid: process.pid, nativeEnvironmentResolved: process.env.MOMO_QA_NATIVE_ENV === "qa_native_env" }) + '\n')
record('started')
const lines = createInterface({ input: process.stdin })
lines.on('line', async line => {
  const request = JSON.parse(line)
  if (request.id === undefined) return
  const send = result => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n')
  if (request.method === 'initialize') return send({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: label, version: '1' } })
  if (request.method === 'tools/list') return send({ tools: [{ name: 'echo', description: 'Controlled QA echo', inputSchema: { type: 'object', properties: { value: { type: 'string' }, delayMs: { type: 'number' } }, required: ['value'], additionalProperties: false } }] })
  if (request.method === 'tools/call') {
    record('entered')
    await new Promise(resolve => setTimeout(resolve, request.params.arguments.delayMs ?? 0))
    record('completed')
    return send({ content: [{ type: 'text', text: 'MCP_ECHO:' + request.params.arguments.value }] })
  }
  send({})
})
lines.on('close', () => process.exit(0))
