import { parseChatMarkdown, type Inline } from "@/lib/chat-markdown";

function Runs({ inline }: { inline: Inline[] }) {
  return inline.map((seg, i) => {
    if (seg.kind === "bold") return <strong key={i}>{seg.text}</strong>;
    if (seg.kind === "italic") return <em key={i}>{seg.text}</em>;
    if (seg.kind === "code") return <code key={i}>{seg.text}</code>;
    return seg.text;
  });
}

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseChatMarkdown(text).map((block, i) =>
        block.kind === "list" ? (
          <ul key={i}>
            {block.items.map((item, j) => (
              <li key={j}><Runs inline={item} /></li>
            ))}
          </ul>
        ) : (
          <div key={i}><Runs inline={block.inline} /></div>
        ),
      )}
    </>
  );
}
