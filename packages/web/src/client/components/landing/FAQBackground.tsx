import { useEffect, useRef } from 'react';

const ACCENT = [200, 255, 50]; // #c8ff32
const PARTICLE_COUNT = 50;
const CONNECTION_DIST = 120;
const PARTICLE_RADIUS = 1.5;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
}

export function FAQBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;

    const particles: Particle[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio, 2);
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const init = () => {
      resize();
      particles.length = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          phase: Math.random() * Math.PI * 2,
        });
      }
    };

    init();
    window.addEventListener('resize', resize);

    let raf = 0;

    const draw = (time: number) => {
      const t = time / 1000;
      ctx.clearRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx + Math.sin(t * 0.5 + p.phase) * 0.15;
        p.y += p.vy + Math.cos(t * 0.4 + p.phase) * 0.15;

        if (p.x < -20) p.x = w + 20;
        if (p.x > w + 20) p.x = -20;
        if (p.y < -20) p.y = h + 20;
        if (p.y > h + 20) p.y = -20;
      }

      // draw connections
      for (let i = 0; i < particles.length; i++) {
        const a = particles[i]!;
        for (let j = i + 1; j < particles.length; j++) {
          const b = particles[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECTION_DIST) {
            const alpha = (1 - dist / CONNECTION_DIST) * 0.15;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.strokeStyle = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${alpha})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // draw particles
      for (const p of particles) {
        const glow = 0.4 + 0.2 * Math.sin(t + p.phase);
        ctx.beginPath();
        ctx.arc(p.x, p.y, PARTICLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ACCENT[0]},${ACCENT[1]},${ACCENT[2]},${glow})`;
        ctx.fill();
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
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    />
  );
}
