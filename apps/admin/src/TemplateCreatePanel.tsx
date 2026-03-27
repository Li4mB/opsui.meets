import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { CreateTemplateInput, TemplateSummary } from "@opsui/shared-types";
import { createTemplate } from "./lib/commands";

interface TemplateCreatePanelProps {
  onCreated(template: TemplateSummary): void;
  onActivity(message: string): void;
}

const TEMPLATE_TYPE_OPTIONS: Array<{
  value: CreateTemplateInput["templateType"];
  label: string;
}> = [
  { value: "standup", label: "Standup" },
  { value: "sales_demo", label: "Sales Demo" },
  { value: "training", label: "Training" },
  { value: "lecture", label: "Lecture" },
  { value: "webinar", label: "Webinar" },
];

export function TemplateCreatePanel(props: TemplateCreatePanelProps) {
  const [name, setName] = useState("Moderated Webinar");
  const [templateType, setTemplateType] = useState<CreateTemplateInput["templateType"]>("webinar");
  const [description, setDescription] = useState(
    "High-control room with muted entrants, moderated chat, and presenter-led screen sharing.",
  );
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleCreate() {
    setIsSaving(true);
    setStatus(null);

    try {
      const template = await createTemplate({
        name,
        templateType,
        description,
      });
      props.onCreated(template);
      props.onActivity(template.name);
      setStatus("Template created.");
      setName("");
      setDescription("");
      setTemplateType("standup");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Template creation failed.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div
      style={{
        borderRadius: 20,
        background: "#fff",
        border: "1px solid rgba(19,33,25,0.08)",
        padding: 24,
        boxShadow: "0 12px 30px rgba(19,33,25,0.06)",
        display: "grid",
        gap: 14,
      }}
    >
      <div>
        <div style={{ fontSize: 13, textTransform: "uppercase", color: "#547163", marginBottom: 8 }}>
          Create Template
        </div>
        <h3 style={{ margin: 0 }}>Operational presets for repeatable meeting patterns</h3>
      </div>

      <Field label="Template name">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Training Session"
          style={inputStyle}
        />
      </Field>

      <Field label="Template type">
        <select
          value={templateType}
          onChange={(event) => setTemplateType(event.target.value as CreateTemplateInput["templateType"])}
          style={inputStyle}
        >
          {TEMPLATE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={4}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span style={{ color: "#5d786a", fontSize: 14 }}>
          {status ?? "System templates stay separate from workspace-created templates."}
        </span>
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={isSaving || !name.trim() || !description.trim()}
          style={buttonStyle}
        >
          {isSaving ? "Saving..." : "Create template"}
        </button>
      </div>
    </div>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 8 }}>
      <span style={{ fontSize: 13, color: "#547163", textTransform: "uppercase" }}>{props.label}</span>
      {props.children}
    </label>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  borderRadius: 12,
  border: "1px solid rgba(19,33,25,0.14)",
  padding: "12px 14px",
  background: "#f8fbf9",
  color: "#132119",
  font: "inherit",
};

const buttonStyle: CSSProperties = {
  border: "none",
  borderRadius: 999,
  padding: "12px 18px",
  background: "#10231b",
  color: "#edf5f0",
  fontWeight: 700,
  cursor: "pointer",
};
