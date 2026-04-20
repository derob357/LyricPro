/**
 * Celebration Component — 3-level audiovisual celebration
 *
 * Level 1 (1 correct): Subtle floating particles + chime
 * Level 2 (2 correct): Confetti shower + applause
 * Level 3 (3 correct): Full-screen fireworks + fanfare
 *
 * Audio is generated via Web Audio API (no external files needed).
 * Mute state is persisted in localStorage under "lyricpro_muted".
 */

import { useEffect, useRef, useCallback } from "react";

export type CelebrationLevel = 0 | 1 | 2 | 3;

interface CelebrationProps {
  level: CelebrationLevel;
  /** Called when the animation finishes OR when the user dismisses early */
  onComplete?: () => void;
  /** Duration in ms. Defaults: L1=3000, L2=4000, L3=5000 */
  duration?: number;
  muted: boolean;
}

// ── Particle / confetti / firework types ─────────────────────────────────────
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
  gravity: number;
  spin?: number;
  spinSpeed?: number;
  shape: "circle" | "rect" | "star";
  width?: number;
  height?: number;
}

const COLORS_L1 = ["#a78bfa", "#818cf8", "#38bdf8", "#34d399"];
const COLORS_L2 = ["#f472b6", "#fb923c", "#facc15", "#4ade80", "#60a5fa", "#c084fc", "#f87171"];
const COLORS_L3 = ["#ff0", "#f0f", "#0ff", "#ff6600", "#00ff88", "#ff3366", "#ffffff"];

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function randomColor(palette: string[]) {
  return palette[Math.floor(Math.random() * palette.length)];
}

// ── Web Audio helpers ─────────────────────────────────────────────────────────
function createAudioContext(): AudioContext | null {
  try {
    return new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  } catch {
    return null;
  }
}

/** Level 1: gentle ascending chime */
function playChime(ctx: AudioContext) {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = ctx.currentTime + i * 0.18;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.25, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}

/** Level 2: short applause-like burst using filtered noise */
function playApplause(ctx: AudioContext) {
  // Noise burst
  const bufferSize = ctx.sampleRate * 1.5;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1200;
  filter.Q.value = 0.5;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.1);
  gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.6);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start();

  // Chime on top
  playChime(ctx);
}

/** Level 3: triumphant fanfare */
function playFanfare(ctx: AudioContext) {
  // Fanfare chord progression: C major → G major → C major
  const chords = [
    [261.63, 329.63, 392.0],   // C4 E4 G4
    [392.0, 493.88, 587.33],   // G4 B4 D5
    [523.25, 659.25, 783.99],  // C5 E5 G5
  ];
  chords.forEach((chord, ci) => {
    chord.forEach(freq => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = ci === 2 ? "triangle" : "sawtooth";
      osc.frequency.value = freq;
      const t = ctx.currentTime + ci * 0.28;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.18, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  });
  // Noise burst underneath
  playApplause(ctx);
}

// ── Particle factories ────────────────────────────────────────────────────────
function makeLevel1Particles(count: number, w: number, h: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: randomBetween(w * 0.2, w * 0.8),
    y: randomBetween(h * 0.3, h * 0.7),
    vx: randomBetween(-0.8, 0.8),
    vy: randomBetween(-2, -0.5),
    radius: randomBetween(3, 7),
    color: randomColor(COLORS_L1),
    alpha: 1,
    decay: randomBetween(0.012, 0.02),
    gravity: 0.02,
    shape: "circle" as const,
  }));
}

function makeConfettiParticles(count: number, w: number): Particle[] {
  return Array.from({ length: count }, () => ({
    x: randomBetween(0, w),
    y: randomBetween(-20, -5),
    vx: randomBetween(-2, 2),
    vy: randomBetween(3, 7),
    radius: 0,
    width: randomBetween(6, 12),
    height: randomBetween(4, 8),
    color: randomColor(COLORS_L2),
    alpha: 1,
    decay: randomBetween(0.006, 0.012),
    gravity: 0.12,
    spin: randomBetween(0, Math.PI * 2),
    spinSpeed: randomBetween(-0.15, 0.15),
    shape: "rect" as const,
  }));
}

function makeFireworkBurst(cx: number, cy: number, count: number): Particle[] {
  return Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2;
    const speed = randomBetween(2, 9);
    return {
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: randomBetween(2, 5),
      color: randomColor(COLORS_L3),
      alpha: 1,
      decay: randomBetween(0.018, 0.03),
      gravity: 0.08,
      shape: (Math.random() > 0.5 ? "circle" : "star") as "circle" | "star",
    };
  });
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
function drawStar(ctx2d: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const spikes = 5;
  const outerR = r;
  const innerR = r * 0.4;
  let rot = (Math.PI / 2) * 3;
  const step = Math.PI / spikes;
  ctx2d.beginPath();
  ctx2d.moveTo(x, y - outerR);
  for (let i = 0; i < spikes; i++) {
    ctx2d.lineTo(x + Math.cos(rot) * outerR, y + Math.sin(rot) * outerR);
    rot += step;
    ctx2d.lineTo(x + Math.cos(rot) * innerR, y + Math.sin(rot) * innerR);
    rot += step;
  }
  ctx2d.lineTo(x, y - outerR);
  ctx2d.closePath();
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Celebration({ level, onComplete, duration, muted }: CelebrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const startTimeRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const defaultDuration = level === 1 ? 3000 : level === 2 ? 4000 : 5000;
  const totalDuration = duration ?? defaultDuration;

  // Dismiss handler — can be called by click or auto-timer
  const dismiss = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx2d = canvas.getContext("2d");
      ctx2d?.clearRect(0, 0, canvas.width, canvas.height);
    }
    onComplete?.();
  }, [onComplete]);

  const playSound = useCallback(() => {
    if (muted) return;
    if (!audioCtxRef.current) {
      audioCtxRef.current = createAudioContext();
    }
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    if (level === 1) playChime(ctx);
    else if (level === 2) playApplause(ctx);
    else if (level === 3) playFanfare(ctx);
  }, [level, muted]);

  useEffect(() => {
    if (level === 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const W = canvas.width = window.innerWidth;
    const H = canvas.height = window.innerHeight;

    // Seed initial particles
    if (level === 1) {
      particlesRef.current = makeLevel1Particles(40, W, H);
    } else if (level === 2) {
      particlesRef.current = makeConfettiParticles(120, W);
    } else {
      // Level 3: seed 3 initial bursts
      particlesRef.current = [
        ...makeFireworkBurst(W * 0.3, H * 0.3, 50),
        ...makeFireworkBurst(W * 0.7, H * 0.25, 50),
        ...makeFireworkBurst(W * 0.5, H * 0.4, 60),
      ];
    }

    startTimeRef.current = performance.now();
    playSound();

    let lastBurst = 0;

    function tick(now: number) {
      const elapsed = now - startTimeRef.current;
      if (elapsed >= totalDuration) {
        ctx2d!.clearRect(0, 0, W, H);
        dismiss();
        return;
      }

      ctx2d!.clearRect(0, 0, W, H);

      // Level 3: spawn new firework bursts periodically
      if (level === 3 && now - lastBurst > 600 && elapsed < totalDuration * 0.75) {
        lastBurst = now;
        particlesRef.current.push(
          ...makeFireworkBurst(
            randomBetween(W * 0.15, W * 0.85),
            randomBetween(H * 0.1, H * 0.55),
            45
          )
        );
      }

      // Level 2: keep spawning confetti from top
      if (level === 2 && elapsed < totalDuration * 0.6 && particlesRef.current.length < 200) {
        for (let i = 0; i < 4; i++) {
          particlesRef.current.push(...makeConfettiParticles(1, W));
        }
      }

      particlesRef.current = particlesRef.current.filter(p => p.alpha > 0.01);

      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.alpha -= p.decay;
        if (p.spin !== undefined && p.spinSpeed !== undefined) p.spin += p.spinSpeed;

        ctx2d!.save();
        ctx2d!.globalAlpha = Math.max(0, p.alpha);
        ctx2d!.fillStyle = p.color;

        if (p.shape === "rect" && p.width && p.height) {
          ctx2d!.translate(p.x, p.y);
          ctx2d!.rotate(p.spin ?? 0);
          ctx2d!.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
        } else if (p.shape === "star") {
          drawStar(ctx2d!, p.x, p.y, p.radius);
          ctx2d!.fill();
        } else {
          ctx2d!.beginPath();
          ctx2d!.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx2d!.fill();
        }
        ctx2d!.restore();
      }

      animRef.current = requestAnimationFrame(tick);
    }

    animRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animRef.current);
      ctx2d.clearRect(0, 0, W, H);
    };
  }, [level, totalDuration, playSound, dismiss]);

  if (level === 0) return null;

  const label = level === 3 ? "🎆 Amazing!" : level === 2 ? "🎉 Great job!" : "✨ Nice!";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-end pb-24"
      style={{ cursor: "pointer" }}
      onClick={dismiss}
    >
      {/* Canvas sits behind the overlay text but above the game */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: "100vw", height: "100vh" }}
      />
      {/* Score label */}
      <div className="relative z-10 flex flex-col items-center gap-3 select-none">
        <span
          className="text-3xl font-bold gradient-text drop-shadow-lg"
          style={{ textShadow: "0 0 24px rgba(139,92,246,0.8)" }}
        >
          {label}
        </span>
        <span className="text-sm text-white/70 bg-black/40 backdrop-blur-sm px-4 py-1.5 rounded-full border border-white/10 animate-pulse">
          Tap anywhere to continue
        </span>
      </div>
    </div>
  );
}
