import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearParsedRuleCache, createRuleInjectionProcessor } from "./injector";
import { capRuleBodyToLineLimit, RULE_LINE_CAP } from "./rule-line-cap";

const RULE_RELATIVE_PATH = ".github/instructions/typescript.instructions.md";

function createOutput(): { title: string; output: string; metadata: unknown } {
	return { title: "tool", output: "", metadata: {} };
}

function createVerboseGateProcessor(
	projectRoot: string,
	homeRoot: string,
	verboseRules?: boolean,
) {
	return createRuleInjectionProcessor({
		workspaceDirectory: projectRoot,
		truncator: {
			truncate: async (_sessionID: string, content: string) => ({
				result: content,
				truncated: false,
			}),
		},
		getSessionCache: () => ({
			contentHashes: new Set<string>(),
			realPaths: new Set<string>(),
		}),
		homedir: () => homeRoot,
		shouldApplyRule: () => ({ applies: true, reason: "matched" }),
		isDuplicateByRealPath: (realPath: string, cache: ReadonlySet<string>) =>
			cache.has(realPath),
		createContentHash: (content: string) => `hash:${content}`,
		isDuplicateByContentHash: (hash: string, cache: ReadonlySet<string>) =>
			cache.has(hash),
		saveInjectedRules: () => undefined,
		verboseRules,
	});
}

function createLineNumberBody(lineCount: number): string {
	return `${Array.from({ length: lineCount }, (_, index) => `line-${index + 1}`).join("\n")}\n`;
}

describe("capRuleBodyToLineLimit", () => {
	it("#given a body above the line cap #when capped #then keeps the first capped lines and appends a one-line marker", () => {
		// given
		const body = createLineNumberBody(45);

		// when
		const capped = capRuleBodyToLineLimit(body, "rules/big.md");

		// then
		const cappedLines = capped.split("\n");
		expect(cappedLines).toHaveLength(RULE_LINE_CAP + 1);
		expect(cappedLines[RULE_LINE_CAP - 1]).toBe("line-30");
		expect(cappedLines[RULE_LINE_CAP]).toBe(
			"[... 15 more lines omitted; read rules/big.md for the full rule]",
		);
	});

	it("#given a body with one line past the cap #when capped #then reports a single omitted line", () => {
		// given
		const body = createLineNumberBody(31);

		// when
		const capped = capRuleBodyToLineLimit(body, "rules/edge.md");

		// then
		const cappedLines = capped.split("\n");
		expect(cappedLines).toHaveLength(RULE_LINE_CAP + 1);
		expect(cappedLines[RULE_LINE_CAP]).toBe(
			"[... 1 more line omitted; read rules/edge.md for the full rule]",
		);
	});

	it("#given a body at or below the line cap #when capped #then returns the body unchanged", () => {
		// given
		const atCap = createLineNumberBody(RULE_LINE_CAP);
		const belowCap = "only-rule\n";

		// when
		const cappedAtCap = capRuleBodyToLineLimit(atCap, "rules/at.md");
		const cappedBelowCap = capRuleBodyToLineLimit(belowCap, "rules/small.md");

		// then
		expect(cappedAtCap).toBe(atCap);
		expect(cappedBelowCap).toBe(belowCap);
	});
});

describe("rulesInjector verbose gate", () => {
	let testRoot: string;
	let projectRoot: string;
	let homeRoot: string;
	let targetFile: string;

	beforeEach(() => {
		clearParsedRuleCache();
		testRoot = join(tmpdir(), `rules-injector-verbose-${Date.now()}`);
		projectRoot = join(testRoot, "project");
		homeRoot = join(testRoot, "home");
		targetFile = join(projectRoot, "src", "index.ts");

		mkdirSync(join(projectRoot, ".git"), { recursive: true });
		mkdirSync(join(projectRoot, "src"), { recursive: true });
		mkdirSync(join(projectRoot, ".github", "instructions"), {
			recursive: true,
		});
		mkdirSync(homeRoot, { recursive: true });

		writeFileSync(targetFile, "export const value = 1;\n");
		writeFileSync(
			join(projectRoot, RULE_RELATIVE_PATH),
			createLineNumberBody(45),
		);
	});

	afterEach(() => {
		clearParsedRuleCache();
		if (fs.existsSync(testRoot)) {
			rmSync(testRoot, { recursive: true, force: true });
		}
	});

	it("#given verboseRules=false #when a 45-line rule matches #then injected content is capped at 30 lines with a truncation marker", async () => {
		// given
		const processor = createVerboseGateProcessor(projectRoot, homeRoot, false);

		// when
		const output = createOutput();
		await processor.processFilePathForInjection(
			targetFile,
			`verbose-off-${Date.now()}`,
			output,
		);

		// then
		expect(output.output).toContain(`[Rule: ${RULE_RELATIVE_PATH}]`);
		expect(output.output).toContain("line-30");
		expect(output.output).not.toContain("line-31");
		expect(output.output).toContain("[... 15 more lines omitted");
		expect(output.output).toContain("for the full rule]");
	});

	it("#given verboseRules=true #when a 45-line rule matches #then the full rule body is injected", async () => {
		// given
		const processor = createVerboseGateProcessor(projectRoot, homeRoot, true);

		// when
		const output = createOutput();
		await processor.processFilePathForInjection(
			targetFile,
			`verbose-on-${Date.now()}`,
			output,
		);

		// then
		expect(output.output).toContain(`[Rule: ${RULE_RELATIVE_PATH}]`);
		expect(output.output).toContain("line-45");
		expect(output.output).not.toContain("[... 15 more lines omitted");
	});

	it("#given verboseRules omitted #when a 45-line rule matches #then injection defaults to the capped form", async () => {
		// given
		const processor = createVerboseGateProcessor(projectRoot, homeRoot);

		// when
		const output = createOutput();
		await processor.processFilePathForInjection(
			targetFile,
			`verbose-default-${Date.now()}`,
			output,
		);

		// then
		expect(output.output).toContain("line-30");
		expect(output.output).not.toContain("line-31");
		expect(output.output).toContain("[... 15 more lines omitted");
	});
});
