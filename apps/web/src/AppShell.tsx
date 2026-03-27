import type { PropsWithChildren } from "react";

export function AppShell(props: PropsWithChildren) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(31, 95, 81, 0.18), transparent 35%), linear-gradient(180deg, #f4f7f2 0%, #e8efe6 100%)",
        color: "#112018",
        fontFamily: '"Segoe UI", sans-serif',
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px 48px" }}>{props.children}</div>
    </main>
  );
}
