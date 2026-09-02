export const RULE_LINE_CAP = 30;

export function capRuleBodyToLineLimit(
	body: string,
	relativePath: string,
): string {
	const lines = body.split("\n");
	const realLineCount =
		lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
	if (realLineCount <= RULE_LINE_CAP) return body;
	const omittedLines = realLineCount - RULE_LINE_CAP;
	const plural = omittedLines === 1 ? "" : "s";
	return `${lines.slice(0, RULE_LINE_CAP).join("\n")}\n[... ${omittedLines} more line${plural} omitted; read ${relativePath} for the full rule]`;
}
