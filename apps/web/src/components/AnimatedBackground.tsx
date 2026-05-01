import { useEffect, useRef } from "react";

/**
 * Animated canvas background with sweeping curved white lines and subtle radial glows.
 * Extracted from the OpsUI Meets front-page design for reuse across pages.
 */
export function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };

    resize();
    window.addEventListener("resize", resize);

    interface Line {
      yBase: number;
      amplitude: number;
      frequency: number;
      phase: number;
      speed: number;
      opacity: number;
      width: number;
    }

    const lines: Line[] = [];

    // Generate sweeping curved lines inspired by the banner
    for (let i = 0; i < 26; i++) {
      lines.push({
        yBase: (i / 26) * 1.3 - 0.15,
        amplitude: 0.025 + Math.random() * 0.09,
        frequency: 0.6 + Math.random() * 1.8,
        phase: Math.random() * Math.PI * 2,
        speed: 0.1 + Math.random() * 0.35,
        opacity: 0.03 + Math.random() * 0.09,
        width: 0.3 + Math.random() * 1.5,
      });
    }

    // A few brighter accent lines
    for (let i = 0; i < 4; i++) {
      lines.push({
        yBase: 0.2 + Math.random() * 0.6,
        amplitude: 0.04 + Math.random() * 0.06,
        frequency: 0.5 + Math.random() * 1.2,
        phase: Math.random() * Math.PI * 2,
        speed: 0.2 + Math.random() * 0.2,
        opacity: 0.12 + Math.random() * 0.06,
        width: 0.4 + Math.random() * 0.6,
      });
    }

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      time += 0.003;

      for (const line of lines) {
        ctx.beginPath();
        ctx.lineWidth = Math.max(1, line.width * dpr);
        ctx.lineCap = "round";

        const yBase = line.yBase * h;

        for (let x = 0; x <= w; x += 1) {
          const xNorm = x / w;
          const wave1 =
            Math.sin(xNorm * line.frequency * Math.PI + time * line.speed + line.phase) * line.amplitude;
          const wave2 =
            Math.sin(
              xNorm * line.frequency * 0.5 * Math.PI + time * line.speed * 0.7 + line.phase + 1,
            ) *
            line.amplitude *
            0.5;
          const y = yBase + (wave1 + wave2) * h;

          if (x === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        // Apply edge fade via gradient
        const gradient = ctx.createLinearGradient(0, 0, w, 0);
        gradient.addColorStop(0, `rgba(255, 255, 255, 0)`);
        gradient.addColorStop(0.1, `rgba(255, 255, 255, ${line.opacity})`);
        gradient.addColorStop(0.5, `rgba(255, 255, 255, ${line.opacity * 1.2})`);
        gradient.addColorStop(0.9, `rgba(255, 255, 255, ${line.opacity})`);
        gradient.addColorStop(1, `rgba(255, 255, 255, 0)`);
        ctx.strokeStyle = gradient;

        ctx.stroke();
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      {/* Subtle radial glows */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "33%",
            left: "25%",
            width: 600,
            height: 400,
            background: "rgba(255, 255, 255, 0.01)",
            borderRadius: "50%",
            filter: "blur(150px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "25%",
            right: "33%",
            width: 400,
            height: 400,
            background: "rgba(255, 255, 255, 0.008)",
            borderRadius: "50%",
            filter: "blur(120px)",
          }}
        />
      </div>
    </>
  );
}