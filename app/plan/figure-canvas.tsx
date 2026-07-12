// app/plan/figure-canvas.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// Ported from design/plan-figure.html lines 797-1016 (three.js mannequin scene) plus
// 952-1003 (chip rail + projected leader lines). This component renders the canvas (or the
// WebGL-unavailable fallback text), the chip rail (plain DOM — must render regardless of
// WebGL success, per the fallback contract), and the leaders SVG whose lines/pins are
// projected from the scene's hotspot markers every frame. Height rule, photos pill, and
// note have no per-frame dependency and stay in profile-section.tsx (Task 6 controller
// adjustment).
type Region = "head" | "chest" | "waist" | "legs";
type ClayMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
const REGIONS: Region[] = ["head", "chest", "waist", "legs"];

type SceneHandles = {
  tintRegion: (region: Region) => void;
  markers: Record<Region, THREE.Object3D>;
};

export default function FigureCanvas({
  chips,
  selectedRegion,
  onSelectRegion,
}: {
  chips: { region: Region; kicker: string; value: string; top: number }[];
  selectedRegion: Region;
  onSelectRegion: (region: Region) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneHandles | null>(null);
  const onSelectRegionRef = useRef(onSelectRegion);
  const [failed, setFailed] = useState(false);

  // Leader-line DOM refs (chip buttons, svg, and its line/circle children) — keyed by
  // region via ref callbacks. Read/written imperatively by the RAF projection loop below;
  // React only ever manages `className` on these nodes (active/on state), never the
  // per-frame x1/y1/x2/y2/cx/cy attributes or opacity, so the two never fight over the
  // same DOM property.
  const leadersElRef = useRef<SVGSVGElement>(null);
  const chipElsRef = useRef<Partial<Record<Region, HTMLButtonElement>>>({});
  const lineElsRef = useRef<Partial<Record<Region, SVGLineElement>>>({});
  const dotElsRef = useRef<Partial<Record<Region, SVGCircleElement>>>({});

  // Keep the "latest" callback ref current without mutating it during render.
  useEffect(() => {
    onSelectRegionRef.current = onSelectRegion;
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      // One-time synchronous capability check (no WebGL context), not an external
      // subscription — the cascading-render concern the rule guards against doesn't apply.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(wrap.clientWidth, wrap.clientHeight);
    wrap.prepend(renderer.domElement);

    const RAIL_SHIFT = -34; // render the scene shifted right, leaving room for the callout rail
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, wrap.clientWidth / wrap.clientHeight, 0.1, 20);
    camera.position.set(0, 1.0, 3.25);
    camera.setViewOffset(wrap.clientWidth, wrap.clientHeight, RAIL_SHIFT, 0, wrap.clientWidth, wrap.clientHeight);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c4, 1.05));
    const key = new THREE.DirectionalLight(0xfff4ea, 1.25);
    key.position.set(2, 3, 2);
    scene.add(key);

    // ---- drawing-mannequin figure: capsule segments + visible ball joints ----
    const CLAY = 0xd6cdbd,
      JOINT = 0xc6bcab,
      TINT = 0xd97757;
    const group = new THREE.Group();
    scene.add(group);
    const meshesByRegion: Record<Region, ClayMesh[]> = { head: [], chest: [], waist: [], legs: [] };
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    function part(
      parent: THREE.Object3D,
      geo: THREE.BufferGeometry,
      region: Region,
      x: number,
      y: number,
      z: number,
      color: number = CLAY,
      sx = 1,
      sy = 1,
      sz = 1
    ): ClayMesh {
      geometries.push(geo);
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0 });
      materials.push(mat);
      const m: ClayMesh = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.userData.region = region;
      meshesByRegion[region].push(m);
      parent.add(m);
      return m;
    }

    // head + neck
    part(group, new THREE.SphereGeometry(0.115, 24, 20), "head", 0, 1.575, 0, CLAY, 1, 1.08, 1);
    part(group, new THREE.CylinderGeometry(0.042, 0.05, 0.1, 16), "head", 0, 1.45, 0);
    // torso (shoulders wider, flattened front-back)
    part(group, new THREE.CapsuleGeometry(0.15, 0.3, 6, 20), "chest", 0, 1.17, 0, CLAY, 1.18, 1, 0.74);
    // waist ball + pelvis block
    part(group, new THREE.SphereGeometry(0.1, 18, 14), "waist", 0, 0.92, 0, JOINT, 1.05, 0.85, 0.9);
    part(group, new THREE.CapsuleGeometry(0.13, 0.1, 6, 18), "waist", 0, 0.8, 0, CLAY, 1.2, 0.8, 0.85);
    // arms: pivot group at the shoulder so every segment stays connected
    for (const s of [-1, 1]) {
      part(group, new THREE.SphereGeometry(0.055, 16, 12), "chest", s * 0.21, 1.395, 0, JOINT);
      const arm = new THREE.Group();
      arm.position.set(s * 0.24, 1.39, 0);
      arm.rotation.z = s * 0.17;
      group.add(arm);
      part(arm, new THREE.CapsuleGeometry(0.045, 0.24, 4, 14), "chest", 0, -0.17, 0);
      part(arm, new THREE.SphereGeometry(0.047, 14, 10), "chest", 0, -0.335, 0, JOINT);
      part(arm, new THREE.CapsuleGeometry(0.04, 0.22, 4, 14), "chest", 0, -0.49, 0);
      part(arm, new THREE.SphereGeometry(0.05, 14, 12), "chest", 0, -0.645, 0);
    }
    // legs: pivot group at the hip
    for (const s of [-1, 1]) {
      part(group, new THREE.SphereGeometry(0.062, 16, 12), "legs", s * 0.1, 0.73, 0, JOINT);
      const leg = new THREE.Group();
      leg.position.set(s * 0.1, 0.72, 0);
      leg.rotation.z = s * 0.03;
      group.add(leg);
      part(leg, new THREE.CapsuleGeometry(0.062, 0.26, 4, 14), "legs", 0, -0.185, 0);
      part(leg, new THREE.SphereGeometry(0.055, 14, 10), "legs", 0, -0.375, 0, JOINT);
      part(leg, new THREE.CapsuleGeometry(0.048, 0.24, 4, 14), "legs", 0, -0.545, 0);
      part(leg, new THREE.BoxGeometry(0.09, 0.05, 0.18), "legs", 0, -0.695, 0.04);
    }

    // soft blob shadow
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext("2d")!;
    const rg = sctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    rg.addColorStop(0, "rgba(45,42,36,0.22)");
    rg.addColorStop(1, "rgba(45,42,36,0)");
    sctx.fillStyle = rg;
    sctx.fillRect(0, 0, 128, 128);
    const shTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowGeo = new THREE.CircleGeometry(0.52, 32);
    const shadowMat = new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    scene.add(shadow);

    // hotspot anchors (local coords on the group) — projected onto the leader-line pins below
    const anchorPositions: Record<Region, THREE.Vector3> = {
      head: new THREE.Vector3(0, 1.575, 0.125),
      chest: new THREE.Vector3(0, 1.19, 0.15),
      waist: new THREE.Vector3(0, 0.87, 0.15),
      legs: new THREE.Vector3(0.105, 0.5, 0.11),
    };
    const markers = {} as Record<Region, THREE.Object3D>;
    for (const r of Object.keys(anchorPositions) as Region[]) {
      const anchor = new THREE.Object3D();
      anchor.position.copy(anchorPositions[r]);
      group.add(anchor);
      markers[r] = anchor;
    }

    const controls = new OrbitControls(camera, renderer.domElement);
    // OrbitControls.connect() sets touch-action: none — override AFTER construction so vertical swipes scroll the page
    renderer.domElement.style.touchAction = "pan-y";
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0.88, 0);
    controls.minPolarAngle = Math.PI * 0.36;
    controls.maxPolarAngle = Math.PI * 0.56;

    // region tinting — prop-driven (design's window.__tintRegion global, lines 929-933)
    let tinted: ClayMesh[] = [];
    function tintRegion(r: Region) {
      tinted.forEach((m) => m.material.emissive.setHex(0x000000));
      tinted = meshesByRegion[r];
      tinted.forEach((m) => {
        m.material.emissive.setHex(TINT);
        m.material.emissiveIntensity = 0.16;
      });
    }
    sceneRef.current = { tintRegion, markers };

    // raycast tap-to-select (distinguish click from drag, design lines 936-950)
    const ray = new THREE.Raycaster();
    const ptr = new THREE.Vector2();
    let downAt: [number, number] | null = null;
    function onPointerDown(e: PointerEvent) {
      downAt = [e.clientX, e.clientY];
    }
    function onPointerUp(e: PointerEvent) {
      if (!downAt) return;
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
      downAt = null;
      if (moved > 6) return;
      const b = renderer.domElement.getBoundingClientRect();
      ptr.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      const hit = ray.intersectObjects(group.children, true)[0];
      const region = hit?.object.userData.region as Region | undefined;
      if (region) onSelectRegionRef.current(region);
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    // idle rotation (gated by drag-in-progress + prefers-reduced-motion) + offscreen render pause
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let interacting = false;
    let onScreen = true;
    function onStart() {
      interacting = true;
    }
    function onEnd() {
      interacting = false;
    }
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);

    const io = new IntersectionObserver((entries) => {
      onScreen = entries[0].isIntersecting;
    });
    io.observe(wrap);

    // leader lines: fixed callout chips on the rail → projected pins on the body
    // (design lines 952-1003). Chip geometry (x1/y1, from the chip's own offsetLeft/Top)
    // is static — measured once, and again whenever the ResizeObserver below fires.
    const leadersEl = leadersElRef.current;
    const chipEls = chipElsRef.current;
    const lineEls = lineElsRef.current;
    const dotEls = dotElsRef.current;
    const wv = new THREE.Vector3(),
      camDir = new THREE.Vector3(),
      outward = new THREE.Vector3(),
      axis = new THREE.Vector3();

    type ChipMeta = { c: HTMLButtonElement; line: SVGLineElement; dot: SVGCircleElement; marker: THREE.Object3D };
    let chipMeta: ChipMeta[] | null = null;
    let W = wrap.clientWidth;
    let H = wrap.clientHeight;

    function measureChips() {
      chipMeta = REGIONS.map((r) => {
        const c = chipEls[r]!;
        const line = lineEls[r]!;
        const dot = dotEls[r]!;
        line.setAttribute("x1", String(c.offsetLeft + c.offsetWidth + 3));
        line.setAttribute("y1", String(c.offsetTop + c.offsetHeight / 2));
        return { c, line, dot, marker: markers[r] };
      });
    }

    let raf = 0;
    function tick() {
      raf = requestAnimationFrame(tick);
      if (!onScreen) return;
      if (!interacting && !reduced) group.rotation.y += 0.0035;
      controls.update();
      renderer.render(scene, camera);

      if (!chipMeta) {
        measureChips();
        leadersEl?.classList.add("live");
      }
      for (const m of chipMeta!) {
        m.marker.getWorldPosition(wv);
        axis.set(0, wv.y, 0);
        outward.copy(wv).sub(axis).normalize();
        camDir.copy(camera.position).sub(axis).normalize();
        const facing = outward.dot(camDir);
        wv.project(camera);
        const px = ((wv.x + 1) / 2) * W;
        const py = ((-wv.y + 1) / 2) * H;
        const away = facing < -0.15;
        m.line.setAttribute("x2", String(px));
        m.line.setAttribute("y2", String(py));
        m.dot.setAttribute("cx", String(px));
        m.dot.setAttribute("cy", String(py));
        // Written directly (never via classList) — React owns each element's className
        // (active/on state) and would clobber a class-based away-fade on re-render.
        m.line.style.opacity = away ? "0.15" : "0.8";
        m.dot.style.opacity = away ? "0.15" : "1";
        m.c.style.opacity = away ? "0.35" : "1";
      }
    }
    tick();

    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.setViewOffset(w, h, RAIL_SHIFT, 0, w, h);
      camera.updateProjectionMatrix();
      W = w;
      H = h;
      chipMeta = null;
    });
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      controls.dispose();
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      shadowGeo.dispose();
      shadowMat.dispose();
      shTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === wrap) wrap.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.tintRegion(selectedRegion);
  }, [selectedRegion]);

  return (
    <>
      {failed ? (
        <div className="plan-fig-fallback">3d unavailable — needs webgl</div>
      ) : (
        <div ref={wrapRef} className="plan-fig-canvas" />
      )}
      <svg ref={leadersElRef} className="plan-fig-leaders">
        {REGIONS.map((r) => (
          <line
            key={`line-${r}`}
            ref={(el) => {
              lineElsRef.current[r] = el ?? undefined;
            }}
            data-region={r}
          />
        ))}
        {REGIONS.map((r) => (
          <circle
            key={`dot-${r}`}
            ref={(el) => {
              dotElsRef.current[r] = el ?? undefined;
            }}
            data-region={r}
            r={3.5}
            className={selectedRegion === r ? "on" : undefined}
          />
        ))}
      </svg>
      {chips.map((chip) => (
        <button
          key={chip.region}
          type="button"
          ref={(el) => {
            chipElsRef.current[chip.region] = el ?? undefined;
          }}
          className={`plan-fig-chip${selectedRegion === chip.region ? " active" : ""}`}
          style={{ top: chip.top }}
          onClick={() => onSelectRegion(chip.region)}
        >
          <span className="plan-fig-chip-k">{chip.kicker}</span>
          <span className="plan-fig-chip-v">{chip.value}</span>
        </button>
      ))}
    </>
  );
}
