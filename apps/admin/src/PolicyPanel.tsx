import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { UpdateWorkspacePolicyInput, WorkspacePolicy } from "@opsui/shared-types";
import { testPostMeetingHook, updateWorkspacePolicy } from "./lib/commands";

interface PolicyPanelProps {
  policy: WorkspacePolicy | null;
  onActivity(message: string): void;
  onUpdated(policy: WorkspacePolicy): void;
}

export function PolicyPanel(props: PolicyPanelProps) {
  const policy = props.policy;
  const [guestJoinMode, setGuestJoinMode] = useState<WorkspacePolicy["guestJoinMode"]>("restricted");
  const [recordingAccess, setRecordingAccess] = useState<WorkspacePolicy["recordingAccess"]>("owner_host_only");
  const [chatMode, setChatMode] = useState<WorkspacePolicy["defaultRoomPolicy"]["chatMode"]>("open");
  const [screenShareMode, setScreenShareMode] = useState<WorkspacePolicy["defaultRoomPolicy"]["screenShareMode"]>("presenters");
  const [lobbyEnabled, setLobbyEnabled] = useState(true);
  const [mutedOnEntry, setMutedOnEntry] = useState(true);
  const [postMeetingHookEnabled, setPostMeetingHookEnabled] = useState(false);
  const [postMeetingHookDeliveryMode, setPostMeetingHookDeliveryMode] =
    useState<WorkspacePolicy["postMeetingHook"]["deliveryMode"]>("manual");
  const [postMeetingHookTargetUrl, setPostMeetingHookTargetUrl] = useState("");
  const [postMeetingHookSecret, setPostMeetingHookSecret] = useState("");
  const [postMeetingHookHasSecret, setPostMeetingHookHasSecret] = useState(false);
  const [postMeetingHookClearSecret, setPostMeetingHookClearSecret] = useState(false);
  const [postMeetingHookIncludeAttendance, setPostMeetingHookIncludeAttendance] = useState(true);
  const [postMeetingHookIncludeActionItems, setPostMeetingHookIncludeActionItems] = useState(true);
  const [postMeetingHookIncludeRecording, setPostMeetingHookIncludeRecording] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingHook, setIsTestingHook] = useState(false);

  useEffect(() => {
    if (!policy) {
      return;
    }

    setGuestJoinMode(policy.guestJoinMode);
    setRecordingAccess(policy.recordingAccess);
    setChatMode(policy.defaultRoomPolicy.chatMode);
    setScreenShareMode(policy.defaultRoomPolicy.screenShareMode);
    setLobbyEnabled(policy.defaultRoomPolicy.lobbyEnabled);
    setMutedOnEntry(policy.defaultRoomPolicy.mutedOnEntry);
    setPostMeetingHookEnabled(policy.postMeetingHook.enabled);
    setPostMeetingHookDeliveryMode(policy.postMeetingHook.deliveryMode);
    setPostMeetingHookTargetUrl(policy.postMeetingHook.targetUrl);
    setPostMeetingHookSecret("");
    setPostMeetingHookHasSecret(policy.postMeetingHook.hasSecret);
    setPostMeetingHookClearSecret(false);
    setPostMeetingHookIncludeAttendance(policy.postMeetingHook.includeAttendance);
    setPostMeetingHookIncludeActionItems(policy.postMeetingHook.includeActionItems);
    setPostMeetingHookIncludeRecording(policy.postMeetingHook.includeRecording);
  }, [policy]);

  if (!policy) {
    return null;
  }

  async function handleSave() {
    const input: UpdateWorkspacePolicyInput = {
      guestJoinMode,
      recordingAccess,
      chatMode,
      screenShareMode,
      lobbyEnabled,
      mutedOnEntry,
      postMeetingHookEnabled,
      postMeetingHookDeliveryMode,
      postMeetingHookTargetUrl,
      postMeetingHookSecret: postMeetingHookSecret.trim() ? postMeetingHookSecret : undefined,
      postMeetingHookClearSecret,
      postMeetingHookIncludeAttendance,
      postMeetingHookIncludeActionItems,
      postMeetingHookIncludeRecording,
    };

    setIsSaving(true);
    setStatus(null);

    try {
      const updated = await updateWorkspacePolicy(input);
      props.onUpdated(updated);
      setPostMeetingHookSecret("");
      setPostMeetingHookHasSecret(updated.postMeetingHook.hasSecret);
      setPostMeetingHookClearSecret(false);
      props.onActivity(
        `Guest join ${updated.guestJoinMode}, recording access ${updated.recordingAccess}, post-meeting hook ${updated.postMeetingHook.enabled ? "enabled" : "disabled"}.`,
      );
      setStatus("Workspace policy saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Workspace policy update failed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTestHook() {
    setIsTestingHook(true);
    setStatus(null);

    try {
      const result = await testPostMeetingHook({
        postMeetingHookEnabled,
        postMeetingHookDeliveryMode,
        postMeetingHookTargetUrl,
        postMeetingHookSecret: postMeetingHookSecret.trim() ? postMeetingHookSecret : undefined,
        postMeetingHookClearSecret,
        postMeetingHookIncludeAttendance,
        postMeetingHookIncludeActionItems,
        postMeetingHookIncludeRecording,
      });
      props.onActivity(
        `Post-meeting hook test ${result.ok ? "passed" : "failed"} for ${result.targetUrl}.`,
      );
      setStatus(
        result.ok
          ? `Hook test succeeded with status ${result.status}.`
          : `Hook test failed with status ${result.status}.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Post-meeting hook test failed.");
    } finally {
      setIsTestingHook(false);
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
      }}
    >
      <div style={{ fontSize: 13, textTransform: "uppercase", color: "#547163", marginBottom: 8 }}>
        Workspace Policy
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <SelectRow
          label="Guest join"
          value={guestJoinMode}
          onChange={(value) => setGuestJoinMode(value as WorkspacePolicy["guestJoinMode"])}
          options={[
            { value: "open", label: "Open" },
            { value: "restricted", label: "Restricted" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
        <SelectRow
          label="Recording access"
          value={recordingAccess}
          onChange={(value) => setRecordingAccess(value as WorkspacePolicy["recordingAccess"])}
          options={[
            { value: "owner_host_only", label: "Owner and host only" },
            { value: "workspace_admins", label: "Workspace admins" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
        <SelectRow
          label="Chat mode"
          value={chatMode}
          onChange={(value) => setChatMode(value as WorkspacePolicy["defaultRoomPolicy"]["chatMode"])}
          options={[
            { value: "open", label: "Open" },
            { value: "host_only", label: "Host only" },
            { value: "moderated", label: "Moderated" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
        <SelectRow
          label="Screen share"
          value={screenShareMode}
          onChange={(value) =>
            setScreenShareMode(value as WorkspacePolicy["defaultRoomPolicy"]["screenShareMode"])
          }
          options={[
            { value: "hosts_only", label: "Hosts only" },
            { value: "presenters", label: "Presenters" },
            { value: "everyone", label: "Everyone" },
          ]}
        />
        <ToggleRow label="Lobby enabled" checked={lobbyEnabled} onChange={setLobbyEnabled} />
        <ToggleRow label="Muted on entry" checked={mutedOnEntry} onChange={setMutedOnEntry} />
        <div
          style={{
            padding: "14px 16px",
            borderRadius: 14,
            background: "#eef5f1",
            border: "1px solid rgba(19,33,25,0.08)",
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 12, textTransform: "uppercase", color: "#547163" }}>
            Post-Meeting Hook
          </div>
          <ToggleRow
            label="Hook enabled"
            checked={postMeetingHookEnabled}
            onChange={setPostMeetingHookEnabled}
          />
          <SelectRow
            label="Delivery mode"
            value={postMeetingHookDeliveryMode}
            onChange={(value) =>
              setPostMeetingHookDeliveryMode(value as WorkspacePolicy["postMeetingHook"]["deliveryMode"])
            }
            options={[
              { value: "manual", label: "Manual dispatch" },
              { value: "on_end", label: "Auto on end" },
            ]}
          />
          <InputRow
            label="Target URL"
            value={postMeetingHookTargetUrl}
            onChange={setPostMeetingHookTargetUrl}
            placeholder="https://ops.example.com/hooks/meet-follow-up"
          />
          <InputRow
            label="Signing secret"
            value={postMeetingHookSecret}
            onChange={setPostMeetingHookSecret}
            placeholder={
              postMeetingHookHasSecret ? "Leave blank to keep existing secret" : "shared-secret-for-hmac"
            }
          />
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => {
                setPostMeetingHookSecret(generateHookSecret());
                setPostMeetingHookClearSecret(false);
              }}
              style={secondaryButtonStyle}
            >
              Generate secret
            </button>
          </div>
          <ToggleRow
            label="Clear existing secret"
            checked={postMeetingHookClearSecret}
            onChange={setPostMeetingHookClearSecret}
          />
          <div style={{ color: "#5d786a", fontSize: 13 }}>
            {postMeetingHookHasSecret
              ? postMeetingHookClearSecret
                ? "The current secret will be removed on save. Leave hook disabled or set a replacement secret before enabling delivery."
                : "A signing secret is already configured. Enter a new value only if you want to rotate it."
              : "No signing secret configured yet. Set one to enable signed delivery."}
          </div>
          <ToggleRow
            label="Include attendance"
            checked={postMeetingHookIncludeAttendance}
            onChange={setPostMeetingHookIncludeAttendance}
          />
          <ToggleRow
            label="Include action items"
            checked={postMeetingHookIncludeActionItems}
            onChange={setPostMeetingHookIncludeActionItems}
          />
          <ToggleRow
            label="Include recording"
            checked={postMeetingHookIncludeRecording}
            onChange={setPostMeetingHookIncludeRecording}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginTop: 16,
        }}
      >
        <span style={{ color: "#5d786a", fontSize: 14 }}>
          {status ?? "These defaults apply to new rooms and templates unless explicitly overridden."}
        </span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => void handleTestHook()}
            disabled={isTestingHook || isSaving}
            style={buttonStyle}
          >
            {isTestingHook ? "Testing..." : "Test hook"}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || isTestingHook}
            style={buttonStyle}
          >
            {isSaving ? "Saving..." : "Save policy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SelectRow(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 14px",
        borderRadius: 12,
        background: "#f6faf7",
        border: "1px solid rgba(19,33,25,0.08)",
        alignItems: "center",
      }}
    >
      <span style={{ color: "#5d786a" }}>{props.label}</span>
      <select
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        style={inputStyle}
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleRow(props: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return (
    <label
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 14px",
        borderRadius: 12,
        background: "#f6faf7",
        border: "1px solid rgba(19,33,25,0.08)",
        alignItems: "center",
      }}
    >
      <span style={{ color: "#5d786a" }}>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        style={{ width: 18, height: 18 }}
      />
    </label>
  );
}

function InputRow(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  placeholder?: string;
}) {
  return (
    <label
      style={{
        display: "grid",
        gap: 8,
        padding: "12px 14px",
        borderRadius: 12,
        background: "#f6faf7",
        border: "1px solid rgba(19,33,25,0.08)",
      }}
    >
      <span style={{ color: "#5d786a" }}>{props.label}</span>
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        style={{ ...inputStyle, minWidth: 0 }}
      />
    </label>
  );
}

const inputStyle: CSSProperties = {
  minWidth: 180,
  borderRadius: 10,
  border: "1px solid rgba(19,33,25,0.12)",
  padding: "8px 10px",
  background: "#fff",
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

const secondaryButtonStyle: CSSProperties = {
  border: "1px solid rgba(19,33,25,0.12)",
  borderRadius: 999,
  padding: "10px 14px",
  background: "#f6faf7",
  color: "#132119",
  fontWeight: 700,
  cursor: "pointer",
};

function generateHookSecret(): string {
  const parts = Array.from({ length: 3 }, () => crypto.randomUUID().replace(/-/g, ""));
  return parts.join("");
}
