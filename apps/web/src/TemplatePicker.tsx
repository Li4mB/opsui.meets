import type { TemplateSummary } from "@opsui/shared-types";

interface TemplatePickerProps {
  templates: TemplateSummary[];
  value: string;
  onChange: (value: string) => void;
}

export function TemplatePicker(props: TemplatePickerProps) {
  return (
    <label style={{ display: "grid", gap: 8 }}>
      <span style={{ fontSize: 13, textTransform: "uppercase", color: "#4d6f61" }}>Template</span>
      <select
        value={props.value}
        onChange={(event) => {
          props.onChange(event.target.value);
        }}
        style={{
          borderRadius: 12,
          border: "1px solid rgba(17,32,24,0.12)",
          padding: "12px 14px",
          background: "#f6faf7",
          color: "#112018",
        }}
      >
        {props.templates.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name}
          </option>
        ))}
      </select>
    </label>
  );
}
