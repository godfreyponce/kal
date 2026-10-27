import { currentChatModel } from "@/lib/spend";
import { Chat } from "./chat";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  return <Chat model={await currentChatModel()} />;
}
