import { useEffect, useRef } from 'react';

const ACCENT = [200, 255, 50]; // #c8ff32
const SEGMENTS = 16;
const MAX_PULSES = 6;
const MIN_PULSES = 3;
const SPAWN_INTERVAL = 0.4;

const CLUSTERS = [
  { cx: 0.65, cy: 0.4, gap: 60 },
  { cx: 0.3, cy: 0.7, gap: 45 },
  { cx: 0.15, cy: 0.2, gap: 55 },
];

interface Ring {
  cx: number;
  cy: number;
  radius: number;
}

interface Pulse {
  ring: Ring;
  angle: number;
  speed: number;
  arcLength: number;
  maxLife: number;
  age: number;
  direction: 1 | -1;
}

function buildRings(w: number, h: number): Ring[] {
  const rings: Ring[] = [];
  const maxR = Math.hypot(w, h);
  for (const c of CLUSTERS) {
    const cx = c.cx * w;
    const cy = c.cy * h;
    for (let r = c.gap; r < maxR; r += c.gap) {
      rings.push({ cx, cy, radius: r });
    }
  }
  return rings;
}

function spawnPulse(rings: Ring[]): Pulse {
  const ring = rings[Math.floor(Math.random() * rings.length)]!;
  return {
    ring,
    angle: Math.random() * Math.PI * 2,
    speed: 0.4 + Math.random() * 0.8,
    arcLength: Math.PI / 6 + Math.random() * (Math.PI / 6),
    maxLife: 1.5 + Math.random() * 2,
    age: 0,
    direction: Math.random() < 0.5 ? 1 : -1,
  };
}

function pulseAlpha(p: Pulse): number {
  const fadeIn = 0.3;
  const fadeOut = 0.5;
  if (p.age < fadeIn) return p.age / fadeIn;
  if (p.age > p.maxLife - fadeOut) return (p.maxLife - p.age) / fadeOut;
  return 1;
}

export function TopoNeurons() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let rings: Ring[] = [];
    const pulses: Pulse[] = [];
    let spawnTimer = 0;
    let lastTime = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rings = buildRings(w, h);
    };

    resize();
    window.addEventListener('resize', resize);

    // seed initial pulses
    for (let i = 0; i < MIN_PULSES; i++) {
      const p = spawnPulse(rings);
      p.age = Math.random() * p.maxLife * 0.5;
      pulses.push(p);
    }

    let raf = 0;

    const draw = (time: number) => {
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 0.016;
      lastTime = time;

      ctx.clearRect(0, 0, w, h);

      // spawn
      spawnTimer += dt;
      if (spawnTimer >= SPAWN_INTERVAL && pulses.length < MAX_PULSES && rings.length) {
        pulses.push(spawnPulse(rings));
        spawnTimer = 0;
      }

      // update & draw
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]!;
        p.age += dt;
        if (p.age >= p.maxLife) {
          pulses.splice(i, 1);
          continue;
        }
        p.angle += p.speed * dt * p.direction;

        const alpha = pulseAlpha(p);
        const { cx, cy, radius } = p.ring;

        // draw arc segments (tail → head)
        for (let s = 0; s < SEGMENTS; s++) {
          const t = s / SEGMENTS; // 0 = tail, 1 = head
          const segAlpha = alpha * t * t; // quadratic falloff
          const segStart = p.angle - p.arcLength * (1 - s / SEGMENTS);
          const segEnd = p.angle - p.arcLength * (1 - (s + 1) / SEGMENTS);

          ctx.beginPath();
          ctx.arc(cx, cy, radius, segStart, segEnd);
          ctx.strokeStyle = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${segAlpha * 0.7})`;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }

        // head glow
        const headX = cx + radius * Math.cos(p.angle);
        const headY = cy + radius * Math.sin(p.angle);
        ctx.save();
        ctx.shadowColor = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${alpha})`;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(headX, headY, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${alpha * 0.9})`;
        ctx.fill();
        ctx.restore();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="fixed inset-0 w-screen h-screen pointer-events-none z-0" />
  );
}
