import { useEffect, useState } from "react";
import type { TemplateSummary } from "@opsui/shared-types";
import { TemplatePicker } from "./TemplatePicker";
import { createInstantMeeting, createRoom } from "./lib/commands";

interface CreateNowCardProps {
  templates: TemplateSummary[];
  onCreated(meetingInstanceId: string): void;
}

export function CreateNowCard(props: CreateNowCardProps) {
  const [state, setState] = useState<{
    status: "idle" | "creating" | "created";
    roomName?: string;
    joinUrl?: string;
    message?: string;
  }>({ status: "idle" });
  const [selectedTemplateId, setSelectedTemplateId] = useState("");

  useEffect(() => {
    if (!selectedTemplateId && props.templates[0]?.id) {
      setSelectedTemplateId(props.templates[0].id);
    }
  }, [props.templates, selectedTemplateId]);

  async function handleCreate() {
    setState({ status: "creating" });
    const selectedTemplate = props.templates.find((template) => template.id === selectedTemplateId);
    const roomName = selectedTemplate ? `${selectedTemplate.name} Room` : "Instant OpsUI Room";
    const room = await createRoom({
      name: roomName,
      templateId: selectedTemplate?.id,
      roomType: "instant",
      isPersistent: false,
    });

    if (!room) {
      setState({
        status: "idle",
        message: "Room creation failed.",
      });
      return;
    }

    const meeting = await createInstantMeeting({
      roomId: room.id,
      title: selectedTemplate ? `${selectedTemplate.name} Session` : "Instant OpsUI Meeting",
      startsAt: new Date().toISOString(),
    });

    setState({
      status: meeting ? "created" : "idle",
      roomName,
      joinUrl: meeting?.joinUrl,
      message: meeting ? "Instant room launched." : "Meeting creation failed.",
    });

    if (meeting) {
      props.onCreated(meeting.id);
    }
  }

  const selectedTemplate = props.templates.find((template) => template.id === selectedTemplateId) ?? null;
  const templatePreview = buildTemplatePreview(selectedTemplate?.templateType);

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
        Create Now
      </div>
      <h2 style={{ margin: "0 0 10px", fontSize: 24 }}>Spin up a room in one action</h2>
      <p style={{ margin: "0 0 16px", color: "#567567", lineHeight: 1.6 }}>
        This now creates a fresh instant room first, then schedules the meeting against that room so
        the dashboard behaves like an actual command surface.
      </p>
      {props.templates.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <TemplatePicker
            templates={props.templates}
            value={selectedTemplateId}
            onChange={setSelectedTemplateId}
          />
        </div>
      ) : null}
      {selectedTemplate ? (
        <div
          style={{
            marginBottom: 16,
            padding: "12px 14px",
            borderRadius: 12,
            background: "#f6faf7",
            border: "1px solid rgba(17,32,24,0.08)",
          }}
        >
          <div style={{ fontSize: 12, textTransform: "uppercase", color: "#4d6f61", marginBottom: 6 }}>
            Launch preview
          </div>
          <div style={{ fontWeight: 700 }}>{selectedTemplate.name}</div>
          <div style={{ marginTop: 6, color: "#567567", fontSize: 14 }}>{templatePreview}</div>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => {
          void handleCreate();
        }}
        style={{
          border: 0,
          borderRadius: 999,
          background: "#123326",
          color: "#f4f7f2",
          padding: "12px 16px",
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {state.status === "creating" ? "Creating..." : "Create instant meeting"}
      </button>
      {state.joinUrl ? (
        <div style={{ marginTop: 14, color: "#567567", fontSize: 14 }}>
          Room: {state.roomName ?? "Instant room"} | Join URL: {state.joinUrl}
        </div>
      ) : null}
      {state.message ? (
        <div style={{ marginTop: 10, color: "#567567", fontSize: 14 }}>{state.message}</div>
      ) : null}
    </section>
  );
}

function buildTemplatePreview(templateType: TemplateSummary["templateType"] | undefined): string {
  switch (templateType) {
    case "standup":
      return "Fast room: no lobby, muted entry, presenter-led sharing.";
    case "sales_demo":
      return "Guest-friendly room: lobby on, open chat, presenter-led sharing.";
    case "training":
      return "Instructor room: lobby on, muted entry, moderated chat.";
    case "lecture":
      return "Lecture room: lobby on, muted entry, host-led sharing and chat.";
    case "webinar":
      return "High-control room: lobby on, muted entry, host-led chat.";
    default:
      return "Instant room with workspace-default controls.";
  }
}
