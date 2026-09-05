import { describe, expect, it } from "bun:test"
import { findSlashCommandTokens } from "./detector"

describe("findSlashCommandTokens", () => {
  it("finds a token in the middle of text", () => {
    // given text with a command after prose
    const text = "read the file first /git-master"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then the command is found with original-text indices
    expect(tokens).toEqual([{ command: "git-master", tokenStart: 20, tokenEnd: 31 }])
  })

  it("finds a parenthesized token", () => {
    // given a command wrapped in parentheses
    const text = "(/quick)"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then the command is found inside the parentheses
    expect(tokens).toEqual([{ command: "quick", tokenStart: 1, tokenEnd: 7 }])
  })

  it("finds a token at the end of the prompt", () => {
    // given a command at the end of text
    const text = "run /quick"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then the command is found at the end
    expect(tokens).toEqual([{ command: "quick", tokenStart: 4, tokenEnd: 10 }])
  })

  it("finds a token at the start of the prompt", () => {
    // given a command at the start of text
    const text = "/quick"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then the command is found at the start
    expect(tokens).toEqual([{ command: "quick", tokenStart: 0, tokenEnd: 6 }])
  })

  it("does not match slashes inside URLs", () => {
    // given a URL followed by a real command
    const text = "see https://x.com/a or /quick"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then only the real command is found
    expect(tokens).toEqual([{ command: "quick", tokenStart: 23, tokenEnd: 29 }])
  })

  it("does not match content inside fenced code blocks", () => {
    // given a command inside a code fence
    const text = "```sh\n/quick\n```"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then no tokens are found
    expect(tokens).toEqual([])
  })

  it("matches tokens around a code fence but not inside it", () => {
    // given commands before and after a fenced block
    const text = "run /quick\n```sh\n/nope\n```\nand /git-master"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then only the outside commands are found in order
    expect(tokens).toEqual([
      { command: "quick", tokenStart: 4, tokenEnd: 10 },
      { command: "git-master", tokenStart: 31, tokenEnd: 42 },
    ])
  })

  it("drops excluded commands", () => {
    // given an excluded command next to a real one
    const text = "/ralph-loop and /goal"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then the excluded command is dropped
    expect(tokens).toEqual([{ command: "goal", tokenStart: 16, tokenEnd: 21 }])
  })

  it("returns multiple tokens ordered by position", () => {
    // given several commands in one prompt
    const text = "a /quick /git-master"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then tokens are returned in position order
    expect(tokens).toEqual([
      { command: "quick", tokenStart: 2, tokenEnd: 8 },
      { command: "git-master", tokenStart: 9, tokenEnd: 20 },
    ])
  })

  it("lowercases command names", () => {
    // given an uppercase command
    const text = "run /Quick"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then the command is lowercased
    expect(tokens).toEqual([{ command: "quick", tokenStart: 4, tokenEnd: 10 }])
  })

  it("keeps indices valid on the original text", () => {
    // given text with multiple commands
    const text = "first\n/quick then /git-master"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then each token slices back to its own command text
    for (const token of tokens) {
      expect(text.slice(token.tokenStart, token.tokenEnd)).toBe(`/${token.command}`)
    }
  })

  it("returns no tokens for plain text", () => {
    // given text without any slash command
    const text = "just regular prose"

    // when scanning for tokens
    const tokens = findSlashCommandTokens(text)

    // then no tokens are found
    expect(tokens).toEqual([])
  })
})