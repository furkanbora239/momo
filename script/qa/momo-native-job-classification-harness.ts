// MODIFIED: momo real-native isolation, descriptor and cleanup evidence.
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"
export async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, stage: string, timeout = 30000): Promise<T> {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await read(); if (ready(value)) return value; await Bun.sleep(100) }
  throw new Error("Timed out: " + stage)
}
export function isolatedEnv(root: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(root,"home"), USERPROFILE: join(root,"home"), OPENCODE_TEST_HOME: join(root,"home"), TMPDIR: join(root,"tmp"), TMP: join(root,"tmp"), TEMP: join(root,"tmp"), XDG_DATA_HOME: join(root,"data"), XDG_CONFIG_HOME: join(root,"config"), XDG_STATE_HOME: join(root,"state"), XDG_CACHE_HOME: join(root,"cache"), OPENCODE_CONFIG_DIR: join(root,"config/opencode"), OPENCODE_DISABLE_AUTOUPDATE:"1", OPENCODE_DISABLE_MODELS_FETCH:"1", NO_COLOR:"1" }
}
export async function harness(binary: string, evidence: string, options: { allowConcurrentMessageWrites?: boolean } = {}) {
  const realDB = join(process.env.HOME ?? "", ".local/share/opencode/opencode.db")
  const counts = () => execFileSync("sqlite3", ["-readonly", realDB,"select 'session',count(*) from session union all select 'session_v2',count(*) from session_v2 union all select 'session_message',count(*) from session_message"], {encoding:"utf8"}).trim()
  const before = counts(), root = await mkdtemp(join(tmpdir(),"momo-job-class-")), env = isolatedEnv(root)
  const project = join(root,"project"), plugin = join(root,"plugin"), groups: number[] = [], databases = new Set<string>()
  for(const path of [project,plugin,env.OPENCODE_CONFIG_DIR!,env.TMPDIR!,join(env.HOME!,".omo"),join(project,".omo"),evidence]) await mkdir(path,{recursive:true})
  let proc: ReturnType<typeof spawn> | undefined, output = ""
  const deadline = AbortSignal.timeout(180_000)
  async function capture() {
    for(const row of execFileSync("ps",["-Ao","pid=,pgid="],{encoding:"utf8"}).split("\n")) {
      const [pid,group] = row.trim().split(/\s+/).map(Number); if(!groups.includes(group!)) continue
      let fds: string[]
      try { fds = await readdir(`/proc/${pid}/fd`) } catch(error) { if((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error }
      for(const fd of fds) try { const target = await readlink(`/proc/${pid}/fd/${fd}`); if(/\.db(?:-(?:wal|shm))?$/.test(target)) { assert(target.startsWith(root+"/"),"Non-isolated native DB: "+target); databases.add(target) } }
      catch(error) { if((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    }
  }
  async function stop() {
    if(!proc?.pid) return
    try { process.kill(-proc.pid,"SIGTERM") } catch(error) { if((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
    await Promise.race([new Promise(resolve=>proc!.once("exit",resolve)),Bun.sleep(3000)])
    if(proc.exitCode===null&&proc.signalCode===null) { process.kill(-proc.pid,"SIGKILL"); await new Promise(resolve=>proc!.once("exit",resolve)) }
    proc = undefined
    const alive = () => execFileSync("ps",["-Ao","pgid="],{encoding:"utf8"}).split("\n").map(Number)
    for(const group of groups) if(alive().includes(group)) {
      try { process.kill(-group,"SIGKILL") } catch(error) { if((error as NodeJS.ErrnoException).code !== "ESRCH") throw error }
    }
    await until(async()=>groups.every(group=>!alive().includes(group)),Boolean,"owned native process group shutdown",3000)
  }
  async function start(directory = project) {
    const reserve = Bun.serve({port:0,fetch:()=>new Response("")}), port = reserve.port; reserve.stop(true); assert(port)
    proc = spawn(binary,["serve","--service","--hostname","127.0.0.1","--port",String(port)],{cwd:directory,env,detached:true,stdio:["ignore","pipe","pipe"]}); assert(proc.pid); groups.push(proc.pid)
    proc.stdout?.on("data",value=>output+=value);proc.stderr?.on("data",value=>output+=value)
    const client = OpenCode.make({fetch: Object.assign((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      fetch(url, { ...init, signal: AbortSignal.any([deadline, ...(init?.signal ? [init.signal] : [])]) }), { preconnect: fetch.preconnect }), baseUrl:`http://127.0.0.1:${port}`,headers:{authorization:"Basic "+Buffer.from("opencode:local-qa").toString("base64")}})
    await until(async()=>{try{return (await client.plugin.list({location:{directory}})).data.some(row=>row.id==="oh-my-openagent"&&row.state.status==="active")}catch(error){return false}},Boolean,"native plugin activation")
    await capture();assert(databases.size>0,"No actual opened DB descriptor observed")
    return client
  }
  async function cleanup() {
    let failure: unknown
    try { await stop() } catch(error) { failure=error }
    const after=counts(), alive=execFileSync("ps",["-Ao","pgid="],{encoding:"utf8"}).split("\n").map(Number)
    await writeFile(join(evidence,"service.log"),output)
    const groupsGone = groups.every(group=>!alive.includes(group))
    // Preserve the isolated files if a native process still owns them.
    if(groupsGone) await rm(root,{recursive:true,force:true})
    const unchangedSessions = before.split("\n").slice(0,2).join("\n") === after.split("\n").slice(0,2).join("\n")
    const receipt={before,after,unchanged:before===after,unchangedSessions,concurrentMessageWritesAllowed:options.allowConcurrentMessageWrites===true,groups,groupsGone,openedDatabases:[...databases],disposableRootRemoved:!existsSync(root),...(failure?{error:String(failure)}:{})}
    assert((receipt.unchanged || options.allowConcurrentMessageWrites && unchangedSessions && databases.size>0)&&receipt.groupsGone&&receipt.disposableRootRemoved&&!failure,"Native QA cleanup failed: "+JSON.stringify(receipt))
    return receipt
  }
  return {root,env,project,plugin,start,stop,capture,cleanup}
}
