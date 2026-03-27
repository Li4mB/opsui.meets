import type { TemplateSummary } from "@opsui/shared-types";

interface TemplatesPanelProps {
  templates: TemplateSummary[];
}

export function TemplatesPanel(props: TemplatesPanelProps) {
  return (
    <div
      style={{
        borderRadius: 20,
        background: "#fff",
        border: "1px solid rgba(19,33,25,0.08)",
        padding: 24,
        boxShadow: "0 12px 30px rgba(19,33,25,0.06)",
      }}
    >
      <div style={{ fontSize: 13, textTransform: "uppercase", color: "#547163", marginBottom: 8 }}>
        Template Library
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {props.templates.map((template) => (
          <div
            key={template.id}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: "#f6faf7",
              border: "1px solid rgba(19,33,25,0.08)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <strong>{template.name}</strong>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#5d786a", textTransform: "capitalize" }}>{template.templateType}</span>
                <span
                  style={{
                    borderRadius: 999,
                    padding: "4px 8px",
                    background: template.isSystem ? "#dfece4" : "#10231b",
                    color: template.isSystem ? "#335043" : "#edf5f0",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {template.isSystem ? "System" : "Workspace"}
                </span>
              </div>
            </div>
            <div style={{ marginTop: 6, color: "#5d786a", fontSize: 14 }}>{template.description}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
