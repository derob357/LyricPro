import { useEffect, useRef } from "react";

// Fixed, full-bleed, blown-up golden note that floats with a subtle 3D tilt
// and mouse parallax. Decorative only (aria-hidden, pointer-events-none) and
// sits behind page content. Honors prefers-reduced-motion: no float/parallax.
export function NoteBackground3D() {
  const noteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const dx = (e.clientX / window.innerWidth - 0.5) * 2;  // -1..1
        const dy = (e.clientY / window.innerHeight - 0.5) * 2; // -1..1
        el.style.setProperty("--px", `${dx * 18}px`);
        el.style.setProperty("--py", `${dy * 18}px`);
        el.style.setProperty("--rx", `${dy * -6}deg`);
        el.style.setProperty("--ry", `${dx * 6}deg`);
      });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      data-testid="note-bg-root"
      aria-hidden="true"
      className="fixed inset-0 -z-10 overflow-hidden pointer-events-none select-none"
    >
      {/* glow halo */}
      <div className="absolute left-1/2 top-1/2 h-[70vmin] w-[70vmin] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
        style={{ background: "radial-gradient(circle, oklch(0.78 0.18 75 / 0.20), oklch(0.65 0.28 290 / 0.08) 55%, transparent 75%)" }} />
      {/* blown-up note with 3D tilt + float */}
      <div
        ref={noteRef}
        className="note-bg-float absolute left-1/2 top-1/2 h-[88vmin] w-[88vmin] -translate-x-1/2 -translate-y-1/2 opacity-[0.45]"
        style={{
          transform:
            "translate(calc(-50% + var(--px, 0px)), calc(-50% + var(--py, 0px))) perspective(1200px) rotate3d(1, 0.5, 0, calc(16deg + var(--rx, 0deg))) rotateY(var(--ry, 0deg))",
          filter: "drop-shadow(0 0 80px oklch(0.78 0.18 75 / 0.35))",
          transition: "transform 0.18s ease-out",
        }}
      >
        <img
          data-testid="note-bg-img"
          src="/brand/golden-note.svg"
          alt=""
          aria-hidden="true"
          className="h-full w-full object-contain"
          draggable={false}
        />
      </div>
    </div>
  );
}
