import Link from "next/link";
import { getGroceryGroups } from "@/lib/groceries";
import { GroceriesList } from "./groceries-list";

// Reads live DB — must render per request (see the force-dynamic gotcha).
export const dynamic = "force-dynamic";

export default async function GroceriesPage() {
  const groups = await getGroceryGroups();
  return (
    <main className="app groceries">
      <div className="head-row">
        <div>
          <h1 className="head-title">Groceries</h1>
          <div className="head-date">YOUR SOURCE OF TRUTH</div>
        </div>
        <Link href="/" className="chat-link">‹ Today</Link>
      </div>
      <div className="rule" />
      <GroceriesList groups={groups} />
    </main>
  );
}
