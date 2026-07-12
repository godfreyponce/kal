// app/plan/profile-section.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ProfileView } from "@/lib/profile";
import type { WeighInView } from "@/lib/weigh-ins";
import { WeightTrend } from "./weight-trend";

// Phase 2: the flat form (profile-form.tsx, deleted) becomes a figure placeholder +
// chip rail + one swapping region editor card. The 3D canvas itself is Task 5/6 —
// .plan-fig3d here is a plain placeholder div; chips are DOM and already work.
type Region = "head" | "chest" | "waist" | "legs";

export function ProfileSection({ profile, weighIns }: { profile: ProfileView; weighIns: WeighInView[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [region, setRegion] = useState<Region>("chest");
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
    patch({ age, sex: form.sex });
  }

  function saveChest() {
    const weightLb = Number(form.weightLb);
    const goalWeightLb = form.goalWeightLb === "" ? null : Number(form.goalWeightLb);
    if (Number.isNaN(weightLb) || (goalWeightLb !== null && Number.isNaN(goalWeightLb))) {
      setError("check the number fields — something isn't a number");
      return;
    }
    patch({ weightLb, goalWeightLb });
  }

  function saveWaist() {
    const heightCm = Number(form.heightCm);
    const bodyFatPct = form.bodyFatPct === "" ? null : Number(form.bodyFatPct);
    if (Number.isNaN(heightCm) || (bodyFatPct !== null && Number.isNaN(bodyFatPct))) {
      setError("check the number fields — something isn't a number");
      return;
    }
    patch({ heightCm, bodyFatPct });
  }

  function saveLegs() {
    patch({ activityLevel: form.activityLevel || null });
  }

  const saveLabel = saved ? "Saved ✓" : pending ? "Saving…" : "Save profile";

  return (
    <div>
      <div className="plan-fig3d">
        <div className="plan-fig-placeholder">figure loads in a later task</div>
        <div className="plan-fig-dim">
          <span className="plan-fig-dim-label">HEIGHT {profile.heightCm} CM</span>
        </div>
        <button
          type="button"
          className={`plan-fig-chip${region === "head" ? " active" : ""}`}
          style={{ top: 34 }}
          onClick={() => selectRegion("head")}
        >
          <span className="plan-fig-chip-k">AGE, SEX</span>
          <span className="plan-fig-chip-v">
            {profile.age} {profile.sex.charAt(0).toUpperCase()}
          </span>
        </button>
        <button
          type="button"
          className={`plan-fig-chip${region === "chest" ? " active" : ""}`}
          style={{ top: 116 }}
          onClick={() => selectRegion("chest")}
        >
          <span className="plan-fig-chip-k">WEIGHT</span>
          <span className="plan-fig-chip-v">{profile.weightLb} lb</span>
        </button>
        <button
          type="button"
          className={`plan-fig-chip${region === "waist" ? " active" : ""}`}
          style={{ top: 198 }}
          onClick={() => selectRegion("waist")}
        >
          <span className="plan-fig-chip-k">BODY FAT</span>
          <span className="plan-fig-chip-v">{profile.bodyFatPct === null ? "—" : `${profile.bodyFatPct} %`}</span>
        </button>
        <button
          type="button"
          className={`plan-fig-chip${region === "legs" ? " active" : ""}`}
          style={{ top: 280 }}
          onClick={() => selectRegion("legs")}
        >
          <span className="plan-fig-chip-k">ACTIVITY</span>
          <span className="plan-fig-chip-v">{profile.activityLevel ?? "—"}</span>
        </button>
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
          <button className="btn-dark plan-ed-save" onClick={saveHead} disabled={pending}>
            {saveLabel}
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
          <button className="btn-dark plan-ed-save" onClick={saveChest} disabled={pending}>
            {saveLabel}
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
          <button className="btn-dark plan-ed-save" onClick={saveWaist} disabled={pending}>
            {saveLabel}
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
          <button className="btn-dark plan-ed-save" onClick={saveLegs} disabled={pending}>
            {saveLabel}
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
