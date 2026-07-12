// app/plan/profile-section.tsx
"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ProfileView } from "@/lib/profile";
import type { WeighInView } from "@/lib/weigh-ins";
import { WeightTrend } from "./weight-trend";

// Phase 2: the flat form (profile-form.tsx, deleted) becomes a 3D figure + chip rail +
// one swapping region editor card. The mannequin scene (Task 5) mounts into .plan-fig3d;
// chips are DOM siblings and already work — Task 6 moves them onto the figure itself.
const FigureCanvas = dynamic(() => import("./figure-canvas"), {
  ssr: false,
  loading: () => <div className="plan-fig-loading" />,
});

type Region = "head" | "chest" | "waist" | "legs";

export function ProfileSection({ profile, weighIns }: { profile: ProfileView; weighIns: WeighInView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [region, setRegion] = useState<Region>("chest");
  // Scopes in-flight state to the card that sent the PATCH: `pending` alone is
  // shared, so switching cards during the post-save RSC refresh would render the
  // untouched card as "Saving…" with a disabled button. Never cleared explicitly —
  // the `pending &&` derivation below makes it inert once the transition ends.
  const [savingRegion, setSavingRegion] = useState<Region | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [form, setForm] = useState({
    weightLb: String(profile.weightLb),
    goalWeightLb: profile.goalWeightLb === null ? "" : String(profile.goalWeightLb),
    heightCm: String(profile.heightCm),
    age: String(profile.age),
    sex: profile.sex,
    bodyFatPct: profile.bodyFatPct === null ? "" : String(profile.bodyFatPct),
    activityLevel: profile.activityLevel ?? "",
  });

  function selectRegion(r: Region) {
    setRegion(r);
    setError(null);
    setSaved(false);
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setSaved(false);
  };

  async function patch(body: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const resBody = await res.json().catch(() => ({}));
        setError(resBody.error ?? "save failed");
        return;
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError("network error — try again");
    }
  }

  function saveHead() {
    const age = Number(form.age);
    if (Number.isNaN(age)) {
      setError("check the number fields — something isn't a number");
      return;
    }
    setSavingRegion("head");
    patch({ age, sex: form.sex });
  }

  function saveChest() {
    const weightLb = Number(form.weightLb);
    const goalWeightLb = form.goalWeightLb === "" ? null : Number(form.goalWeightLb);
    if (Number.isNaN(weightLb) || (goalWeightLb !== null && Number.isNaN(goalWeightLb))) {
      setError("check the number fields — something isn't a number");
      return;
    }
    setSavingRegion("chest");
    patch({ weightLb, goalWeightLb });
  }

  function saveWaist() {
    const heightCm = Number(form.heightCm);
    const bodyFatPct = form.bodyFatPct === "" ? null : Number(form.bodyFatPct);
    if (Number.isNaN(heightCm) || (bodyFatPct !== null && Number.isNaN(bodyFatPct))) {
      setError("check the number fields — something isn't a number");
      return;
    }
    setSavingRegion("waist");
    patch({ heightCm, bodyFatPct });
  }

  function saveLegs() {
    setSavingRegion("legs");
    patch({ activityLevel: form.activityLevel || null });
  }

  // Per-card in-flight derivation — each card's disabled prop and "Saving…" label
  // use its own region, so only the card that sent the PATCH shows as busy.
  const cardPending = (r: Region) => pending && savingRegion === r;
  const saveLabel = (r: Region) => (saved ? "Saved ✓" : cardPending(r) ? "Saving…" : "Save profile");

  // Chip values live here (they're derived from `profile`, refreshed via router.refresh()
  // after each save); the chips themselves — and the leader lines that track them onto the
  // body — render inside FigureCanvas (Task 6), which has no other reason to know about
  // profile fields.
  const chips: { region: Region; kicker: string; value: string; top: number }[] = [
    {
      region: "head",
      kicker: "AGE, SEX",
      value: `${profile.age} ${profile.sex.charAt(0).toUpperCase()}`,
      top: 34,
    },
    { region: "chest", kicker: "WEIGHT", value: `${profile.weightLb} lb`, top: 116 },
    {
      region: "waist",
      kicker: "BODY FAT",
      value: profile.bodyFatPct === null ? "—" : `${profile.bodyFatPct} %`,
      top: 198,
    },
    { region: "legs", kicker: "ACTIVITY", value: profile.activityLevel ?? "—", top: 280 },
  ];

  return (
    <div>
      <div className="plan-fig3d">
        <FigureCanvas chips={chips} selectedRegion={region} onSelectRegion={selectRegion} />
        <div className="plan-fig-dim">
          <span className="plan-fig-dim-label">HEIGHT {profile.heightCm} CM</span>
        </div>
        <button type="button" className="plan-fig-mkme" onClick={() => setNoteOpen(!noteOpen)}>
          use my photos →
        </button>
      </div>
      {noteOpen && (
        <div className="plan-fig-mkme-note">
          send a few photos (front-facing, arms slightly out) — an image-to-3d pass turns them into your model.
          stored privately on blob storage, never in the public repo. the mannequin stands in until then.
        </div>
      )}

      {error && <div className="gr-error">{error}</div>}

      {region === "head" && (
        <div className="plan-ed">
          <div className="plan-ed-k">Editing: age &amp; sex</div>
          <div className="plan-ed-frow">
            <div className="plan-ed-fld">
              <div className="plan-ed-lbl">Age</div>
              <input className="plan-ed-inp" inputMode="numeric" value={form.age} onChange={set("age")} />
            </div>
            <div className="plan-ed-fld">
              <div className="plan-ed-lbl">Sex</div>
              <input className="plan-ed-inp" value={form.sex} onChange={set("sex")} />
            </div>
          </div>
          <button className="btn-dark plan-ed-save" onClick={saveHead} disabled={cardPending("head")}>
            {saveLabel("head")}
          </button>
        </div>
      )}

      {region === "chest" && (
        <div className="plan-ed">
          <div className="plan-ed-k">Editing: weight &amp; goal</div>
          <div className="plan-ed-frow">
            <div className="plan-ed-fld">
              <div className="plan-ed-lbl">Weight (lb)</div>
              <input
                className="plan-ed-inp"
                inputMode="decimal"
                value={form.weightLb}
                onChange={set("weightLb")}
              />
            </div>
            <div className="plan-ed-fld">
              <div className="plan-ed-lbl">Goal (lb)</div>
              <input
                className="plan-ed-inp"
                inputMode="decimal"
                value={form.goalWeightLb}
                onChange={set("goalWeightLb")}
              />
            </div>
          </div>
          <WeightTrend entries={weighIns} goalWeightLb={profile.goalWeightLb} />
          <div className="plan-ed-hint">
            every weigh-in you log lands here — no deadline on the goal, the line just keeps heading there
          </div>
          <button className="btn-dark plan-ed-save" onClick={saveChest} disabled={cardPending("chest")}>
            {saveLabel("chest")}
          </button>
        </div>
      )}

      {region === "waist" && (
        <div className="plan-ed">
          <div className="plan-ed-k">Editing: body fat &amp; height</div>
          <div className="plan-ed-frow">
            <div className="plan-ed-fld">
              <div className="plan-ed-lbl">Body fat (%)</div>
              <input
                className="plan-ed-inp"
                inputMode="decimal"
                value={form.bodyFatPct}
                onChange={set("bodyFatPct")}
              />
            </div>
            <div className="plan-ed-fld">
              <div className="plan-ed-lbl">Height (cm)</div>
              <input
                className="plan-ed-inp"
                inputMode="numeric"
                value={form.heightCm}
                onChange={set("heightCm")}
              />
            </div>
          </div>
          <button className="btn-dark plan-ed-save" onClick={saveWaist} disabled={cardPending("waist")}>
            {saveLabel("waist")}
          </button>
        </div>
      )}

      {region === "legs" && (
        <div className="plan-ed">
          <div className="plan-ed-k">Editing: activity</div>
          <div className="plan-ed-frow">
            <div className="plan-ed-fld">
              <div className="plan-ed-lbl">Activity level</div>
              <input className="plan-ed-inp" value={form.activityLevel} onChange={set("activityLevel")} />
            </div>
          </div>
          <div className="plan-ed-hint">soccer tue/thu — kal reads this for coaching tone, not math</div>
          <button className="btn-dark plan-ed-save" onClick={saveLegs} disabled={cardPending("legs")}>
            {saveLabel("legs")}
          </button>
        </div>
      )}

      <div className="plan-targets">
        <span className="plan-lbl">Daily targets derived from the meal plan</span>
        <span className="plan-targets-v">
          {profile.targetKcal} kcal&ensp;
          <b className="mac-p">P {profile.targetProteinG}</b>&ensp;
          <b className="mac-c">C {profile.targetCarbsG}</b>&ensp;
          <b className="mac-f">F {profile.targetFatG}</b>
        </span>
      </div>
    </div>
  );
}
