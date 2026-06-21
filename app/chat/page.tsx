import { CHAT_MODEL } from "@/lib/anthropic";
import { Chat } from "./chat";

export default function ChatPage() {
  return <Chat model={CHAT_MODEL} />;
}
