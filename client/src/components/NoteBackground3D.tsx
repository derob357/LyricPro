import { useEffect, useRef } from "react";

// Fixed, full-bleed, blown-up golden note that floats with a subtle 3D tilt
// and mouse parallax. Decorative only (aria-hidden, pointer-events-none) and
// sits behind page content. Honors prefers-reduced-motion: no float/parallax.
export function NoteBackground3D() {
  const noteRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = noteRef.current;
    if (!el) return;
    const mql = window.matchMedia?.("(prefers-reduced-motion: reduce)");

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

    // Enable parallax only when the user hasn't asked to reduce motion.
    // Re-sync if they toggle the OS setting while the page is open.
    const sync = () => {
      if (mql?.matches) {
        window.removeEventListener("mousemove", onMove);
        cancelAnimationFrame(raf);
        for (const v of ["--px", "--py", "--rx", "--ry"]) el.style.removeProperty(v);
      } else {
        window.addEventListener("mousemove", onMove);
      }
    };
    sync();
    mql?.addEventListener?.("change", sync);

    return () => {
      mql?.removeEventListener?.("change", sync);
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
      {/* The 3D tilt + centering live on `transform` (inline). The gentle vertical
          float lives on the independent CSS `translate` property (see .note-bg-float
          in index.css) so the two never overwrite each other on `transform`. */}
      <div
        ref={noteRef}
        className="note-bg-float absolute left-1/2 top-1/2 h-[88vmin] w-[88vmin] opacity-[0.45]"
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
