import Link from "next/link";
import { getGroceryGroups } from "@/lib/groceries";
import { GroceriesList } from "./groceries-list";

// Reads live DB — must render per request (see the force-dynamic gotcha).
export const dynamic = "force-dynamic";

export default async function GroceriesPage() {
  const groups = await getGroceryGroups();
  return (
    <main className="app groceries">
      <div className="gro-top">
        <div>
          <div className="gro-title">Groceries</div>
          <div className="gro-kicker">Your source of truth</div>
        </div>
        <Link href="/" className="gro-back">‹ Today</Link>
      </div>
      <GroceriesList groups={groups} />
    </main>
  );
}
