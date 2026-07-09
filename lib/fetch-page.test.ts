import { describe, it, expect } from "vitest";
import { htmlToText, urlGuardError } from "./fetch-page";

describe("htmlToText", () => {
  it("strips tags, scripts, styles, comments; collapses whitespace", () => {
    const html = `<html><head><style>.x{color:red}</style><script>var a=1;</script></head>
      <body><!-- nav --><h1>Menu</h1><p>Chicken bowl  <b>650</b> kcal</p></body></html>`;
    expect(htmlToText(html)).toBe("Menu Chicken bowl 650 kcal");
  });

  it("decodes basic entities", () => {
    expect(htmlToText("<p>Mac &amp; cheese &gt; 500 kcal</p>")).toBe("Mac & cheese > 500 kcal");
  });

  it("caps output at 20000 chars", () => {
    expect(htmlToText(`<p>${"a".repeat(30000)}</p>`).length).toBe(20000);
  });
});

describe("urlGuardError", () => {
  it("accepts public http(s) URLs", () => {
    expect(urlGuardError("https://www.chipotle.com/nutrition-calculator")).toBeNull();
    expect(urlGuardError("http://example.com/menu.html")).toBeNull();
  });

  it.each([
    "notaurl",
    "ftp://example.com/x",
    "file:///etc/passwd",
    "http://localhost:3100/",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.1.1/",
    "http://[::1]/",
  ])("rejects %s", (u) => {
    expect(urlGuardError(u)).not.toBeNull();
  });
});
