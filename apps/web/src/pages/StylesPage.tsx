import { AnimatedBackground } from "../components/AnimatedBackground";
import { LiquidGlassCard } from "../components/LiquidGlassCard";

const TINT_LEVELS = [0, 25, 50, 75] as const;

export function StylesPage() {
  return (
    <>
      <AnimatedBackground />
      <section className="page page--styles" aria-label="Styles">
        <div className="styles-glass-grid">
          {TINT_LEVELS.map((tint) => (
            <LiquidGlassCard key={tint} tint={tint} label={`${tint}%`} />
          ))}
        </div>
      </section>
    </>
  );
}
