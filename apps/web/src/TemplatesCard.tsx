import type { TemplateSummary } from "@opsui/shared-types";

interface TemplatesCardProps {
  templates: TemplateSummary[];
}

export function TemplatesCard(props: TemplatesCardProps) {
  return (
    <section
      style={{
        background: "#fff",
        borderRadius: 18,
        border: "1px solid rgba(17,32,24,0.08)",
        padding: 20,
        boxShadow: "0 12px 24px rgba(17,32,24,0.08)",
      }}
    >
      <div style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61", marginBottom: 8 }}>
        Templates
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 24 }}>Room presets by operating mode</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {props.templates.map((template) => (
          <div
            key={template.id}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: "#f6faf7",
              border: "1px solid rgba(17,32,24,0.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <strong>{template.name}</strong>
              <span style={{ textTransform: "capitalize", color: "#567567" }}>{template.templateType}</span>
            </div>
            <div style={{ marginTop: 6, color: "#567567", fontSize: 14 }}>{template.description}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
