export type Inline = { kind: "text" | "bold" | "italic" | "code"; text: string };
export type Block =
  | { kind: "text"; inline: Inline[] }
  | { kind: "list"; items: Inline[][] };

const isSpace = (ch: string | undefined) => ch !== undefined && /\s/.test(ch);
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
// `4*95` is multiplication, not an italic marker.
const isMathStar = (src: string, k: number) => isWordChar(src[k - 1]) && isWordChar(src[k + 1]);

// A marker with no valid closing partner stays literal, so a reply cut off
// mid-marker while streaming reads as plain text until the close arrives.
function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const emit = (kind: Inline["kind"], body: string) => {
    if (text) out.push({ kind: "text", text });
    text = "";
    out.push({ kind, text: body });
  };

  let i = 0;
  while (i < src.length) {
    if (src[i] === "`") {
      const j = src.indexOf("`", i + 1);
      if (j > i + 1) {
        emit("code", src.slice(i + 1, j));
        i = j + 1;
        continue;
      }
    } else if (src.startsWith("**", i)) {
      const j = src.indexOf("**", i + 2);
      const body = j === -1 ? "" : src.slice(i + 2, j);
      if (body && !isSpace(body[0]) && !isSpace(body[body.length - 1])) {
        emit("bold", body);
        i = j + 2;
        continue;
      }
      text += "**";
      i += 2;
      continue;
    } else if (src[i] === "*" && src[i + 1] !== undefined && !isSpace(src[i + 1]) && !isMathStar(src, i)) {
      let j = i + 1;
      while (j < src.length) {
        const single = src[j] === "*" && src[j - 1] !== "*" && src[j + 1] !== "*";
        if (single && !isSpace(src[j - 1]) && !isMathStar(src, j)) break;
        j++;
      }
      if (j < src.length) {
        emit("italic", src.slice(i + 1, j));
        i = j + 1;
        continue;
      }
    }
    text += src[i];
    i++;
  }
  if (text) out.push({ kind: "text", text });
  return out;
}

export function parseChatMarkdown(src: string): Block[] {
  if (!src) return [];
  const blocks: Block[] = [];
  let lines: string[] = [];

  const flushText = (beforeList: boolean) => {
    if (beforeList) while (lines.length && lines[lines.length - 1] === "") lines.pop();
    if (lines.length) blocks.push({ kind: "text", inline: parseInline(lines.join("\n")) });
    lines = [];
  };

  for (const line of src.split("\n")) {
    const last = blocks[blocks.length - 1];
    if (line.startsWith("- ")) {
      flushText(true);
      const item = parseInline(line.slice(2));
      const tail = blocks[blocks.length - 1];
      if (tail?.kind === "list") tail.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
    } else if (line === "" && lines.length === 0 && last?.kind === "list") {
      continue;
    } else {
      lines.push(line);
    }
  }
  flushText(false);
  return blocks;
}
