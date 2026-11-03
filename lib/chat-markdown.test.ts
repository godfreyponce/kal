// DB-free: imports only ./chat-markdown. No `import "../db/env"` needed.
import { describe, expect, it } from "vitest";
import { parseChatMarkdown, type Block, type Inline } from "./chat-markdown";

const t = (text: string): Inline => ({ kind: "text", text });
const b = (text: string): Inline => ({ kind: "bold", text });
const i = (text: string): Inline => ({ kind: "italic", text });
const c = (text: string): Inline => ({ kind: "code", text });
const para = (...inline: Inline[]): Block => ({ kind: "text", inline });

describe("parseChatMarkdown", () => {
  it("empty string", () => {
    expect(parseChatMarkdown("")).toEqual([]);
  });

  it("plain text", () => {
    expect(parseChatMarkdown("Hi there")).toEqual([para(t("Hi there"))]);
  });

  it("ticket reply", () => {
    expect(
      parseChatMarkdown("Done. **Logged: Raising Cane's Caniac combo — 2000 kcal / 95P / 210C / 95F.**"),
    ).toEqual([para(t("Done. "), b("Logged: Raising Cane's Caniac combo — 2000 kcal / 95P / 210C / 95F."))]);
  });

  it("italic and code", () => {
    expect(parseChatMarkdown("a *b* `c` d")).toEqual([para(t("a "), i("b"), t(" "), c("c"), t(" d"))]);
  });

  it("cut off mid-bold (streaming)", () => {
    expect(parseChatMarkdown("Done. **Logged: Rai")).toEqual([para(t("Done. **Logged: Rai"))]);
    expect(parseChatMarkdown("**Logged*")).toEqual([para(t("**Logged*"))]);
    expect(parseChatMarkdown("**")).toEqual([para(t("**"))]);
  });

  it("bold completes when its close arrives", () => {
    expect(parseChatMarkdown("**Logged**")).toEqual([para(b("Logged"))]);
  });

  it("cut off mid-code", () => {
    expect(parseChatMarkdown("use `kcal")).toEqual([para(t("use `kcal"))]);
  });

  it("lone and spaced asterisks stay literal", () => {
    for (const s of ["2 * 3 = 6", "5*2", "* item"]) {
      expect(parseChatMarkdown(s)).toEqual([para(t(s))]);
    }
  });

  it("two multiplications in one reply stay literal", () => {
    for (const s of ["4*95 = 380 kcal, 9*95 = 855 kcal", "Protein 4*40\nCarbs 4*50"]) {
      expect(parseChatMarkdown(s)).toEqual([para(t(s))]);
    }
  });

  it("html stays text", () => {
    expect(parseChatMarkdown("<b>hi</b>")).toEqual([para(t("<b>hi</b>"))]);
  });

  it("newlines stay inside one text block", () => {
    expect(parseChatMarkdown("one\ntwo\n\nthree")).toEqual([para(t("one\ntwo\n\nthree"))]);
  });

  it("list between prose", () => {
    expect(parseChatMarkdown("Here:\n- **a**\n- b\nDone")).toEqual([
      para(t("Here:")),
      { kind: "list", items: [[b("a")], [t("b")]] },
      para(t("Done")),
    ]);
    expect(parseChatMarkdown("Here:\n\n- a\n\nDone")).toEqual([
      para(t("Here:")),
      { kind: "list", items: [[t("a")]] },
      para(t("Done")),
    ]);
  });
});
