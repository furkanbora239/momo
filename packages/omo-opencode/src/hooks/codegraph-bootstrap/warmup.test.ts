/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { warmupCodegraphMcp } from "./warmup"

describe("warmupCodegraphMcp", () => {
  it("completes MCP handshake and synthetic status query successfully", async () => {
    // given a mock MCP server script that responds to initialize and tools/call
    const mockScript = `
      process.stdin.setEncoding("utf8");
      let buf = "";
      process.stdin.on("data", (chunk) => {
        buf += chunk;
        let lines = buf.split("\\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line);
          if (msg.method === "initialize") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { tools: {} } } }) + "\\n");
          } else if (msg.method === "tools/call") {
            process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "warm" }] } }) + "\\n");
          }
        }
      });
    `

    // when
    const result = await warmupCodegraphMcp({
      command: process.execPath,
      argsPrefix: ["-e", mockScript],
      projectRoot: process.cwd(),
      env: {},
      timeoutMs: 5000,
    })

    // then
    expect(result.success).toBe(true)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.timedOut).toBeUndefined()
  })

  it("handles timeout gracefully when server never answers tool call", async () => {
    // given a hanging server script
    const mockScript = `
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", () => {});
    `

    // when
    const result = await warmupCodegraphMcp({
      command: process.execPath,
      argsPrefix: ["-e", mockScript],
      projectRoot: process.cwd(),
      env: {},
      timeoutMs: 150,
    })

    // then
    expect(result.success).toBe(false)
    expect(result.timedOut).toBe(true)
  })

  it("returns error when projectRoot does not exist", async () => {
    // when
    const result = await warmupCodegraphMcp({
      command: process.execPath,
      projectRoot: "/nonexistent/directory/for/momo-test",
      env: {},
      timeoutMs: 1000,
    })

    // then
    expect(result.success).toBe(false)
    expect(result.error).toContain("projectRoot does not exist")
  })

  it("handles spawn failure without throwing", async () => {
    // when
    const result = await warmupCodegraphMcp({
      command: "/nonexistent/binary/path",
      projectRoot: process.cwd(),
      env: {},
      timeoutMs: 1000,
    })

    // then
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })
})
