import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

declare global {
  interface Window {
    __bgCanvas?: HTMLCanvasElement;
  }
}

interface LiquidGlassCardProps {
  tint: 0 | 25 | 50 | 75;
  label?: string;
}

const TINT_COLORS = {
  0: "rgba(0, 0, 0, 0)",
  25: "rgba(0, 0, 0, 0.25)",
  50: "rgba(0, 0, 0, 0.50)",
  75: "rgba(0, 0, 0, 0.75)",
};

export function LiquidGlassCard({ tint, label }: LiquidGlassCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const card = cardRef.current;
    const canvas = canvasRef.current;
    if (!card || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;

    // Find background canvas
    const findBackgroundCanvas = (): HTMLCanvasElement | null => {
      if (typeof window !== "undefined" && window.__bgCanvas) {
        return window.__bgCanvas;
      }

      const bgCanvas = document.querySelector(
        "canvas[style*='position: fixed']"
      ) as HTMLCanvasElement;
      if (bgCanvas) return bgCanvas;

      const allCanvases = Array.from(document.querySelectorAll("canvas"));
      for (const c of allCanvases) {
        const style = window.getComputedStyle(c);
        if (style.position === "fixed") return c as HTMLCanvasElement;
      }

      return null;
    };

    const resize = () => {
      const rect = card.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(dpr, dpr);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(card);

    let time = Math.random() * 1000;

    const draw = () => {
      const bgCanvas = findBackgroundCanvas();
      if (!bgCanvas) {
        animationRef.current = requestAnimationFrame(draw);
        return;
      }

      const rect = card.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      ctx.clearRect(0, 0, width, height);

      // Draw background with distortion for liquid glass effect
      ctx.save();

      // Create displacement effect through layered transforms
      const bgWidth = bgCanvas.width / dpr;
      const bgHeight = bgCanvas.height / dpr;

      // Layer 1: Base layer with slight distortion
      ctx.save();
      ctx.globalAlpha = 0.6;
      const offsetX1 = Math.sin(time * 0.5) * 8 + Math.cos(time * 0.3) * 4;
      const offsetY1 = Math.cos(time * 0.4) * 6 + Math.sin(time * 0.6) * 3;
      const rotation1 = Math.sin(time * 0.2) * 0.02;

      ctx.translate(width / 2 + offsetX1, height / 2 + offsetY1);
      ctx.rotate(rotation1);
      ctx.translate(-width / 2, -height / 2);

      ctx.drawImage(
        bgCanvas,
        rect.left - offsetX1 * 0.5,
        rect.top - offsetY1 * 0.5,
        width + offsetX1,
        height + offsetY1,
        0,
        0,
        width,
        height
      );
      ctx.restore();

      // Layer 2: Slightly more distorted with different timing
      ctx.save();
      ctx.globalAlpha = 0.3;
      const offsetX2 = Math.sin(time * 0.7 + 1) * 6 + Math.cos(time * 0.5 + 0.5) * 3;
      const offsetY2 = Math.cos(time * 0.6 + 1) * 4 + Math.sin(time * 0.8 + 0.5) * 2;
      const rotation2 = Math.cos(time * 0.3) * 0.015;

      ctx.translate(width / 2 + offsetX2, height / 2 + offsetY2);
      ctx.rotate(rotation2);
      ctx.translate(-width / 2, -height / 2);

      ctx.drawImage(
        bgCanvas,
        rect.left - offsetX2 * 0.7,
        rect.top - offsetY2 * 0.7,
        width + offsetX2 * 1.5,
        height + offsetY2 * 1.5,
        0,
        0,
        width,
        height
      );
      ctx.restore();

      // Layer 3: Subtle highlight layer
      ctx.save();
      ctx.globalAlpha = 0.15;
      const offsetX3 = Math.sin(time * 0.9 + 2) * 4;
      const offsetY3 = Math.cos(time * 0.7 + 2) * 3;
      const rotation3 = Math.sin(time * 0.4) * 0.01;

      ctx.translate(width / 2 + offsetX3, height / 2 + offsetY3);
      ctx.rotate(rotation3);
      ctx.translate(-width / 2, -height / 2);

      ctx.drawImage(
        bgCanvas,
        rect.left - offsetX3,
        rect.top - offsetY3,
        width + offsetX3 * 2,
        height + offsetY3 * 2,
        0,
        0,
        width,
        height
      );
      ctx.restore();

      ctx.restore();

      // Add tint based on tint level
      if (tint > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "multiply";
        ctx.fillStyle = `rgba(0, 0, 0, ${tint / 120})`;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      // Add subtle edge glow/refraction
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = 0.08;
      const gradient = ctx.createRadialGradient(
        width * 0.3,
        height * 0.3,
        0,
        width / 2,
        height / 2,
        Math.max(width, height) * 0.7
      );
      gradient.addColorStop(0, "rgba(255, 255, 255, 0.4)");
      gradient.addColorStop(0.4, "rgba(255, 255, 255, 0.2)");
      gradient.addColorStop(0.7, "rgba(255, 255, 255, 0.05)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0.05)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      time += 0.012;
      animationRef.current = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      resizeObserver.disconnect();
    };
  }, [tint]);

  return (
    <div
      ref={cardRef}
      className="liquid-glass-card"
      data-tint={String(tint)}
      style={{
        "--styles-glass-tint": TINT_COLORS[tint],
      } as CSSProperties}
    >
      <canvas
        ref={canvasRef}
        className="liquid-glass-card__canvas"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          borderRadius: "inherit",
          pointerEvents: "none",
          zIndex: 1,
        }}
      />
      {label && (
        <span className="liquid-glass-card__label">{label}</span>
      )}
    </div>
  );
}
