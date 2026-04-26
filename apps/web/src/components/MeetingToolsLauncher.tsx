import { MeetingControlButton } from "./MeetingControlButton";
import { ToolsIcon, WhiteboardIcon } from "./MeetingRoomIcons";

interface MeetingToolsLauncherProps {
  activeTool: "whiteboard" | null;
  onSelectWhiteboard(): void;
  onToggleOpen(): void;
  open: boolean;
}

export function MeetingToolsLauncher(props: MeetingToolsLauncherProps) {
  return (
    <div className={`meeting-tools-launcher${props.open ? " is-open" : ""}`}>
      <div
        aria-hidden={!props.open}
        className={`meeting-tools-launcher__panel${props.open ? " is-open" : ""}`}
      >
        <button
          className={`meeting-tools-launcher__item${props.activeTool === "whiteboard" ? " is-active" : ""}`}
          onClick={props.onSelectWhiteboard}
          type="button"
        >
          <span className="meeting-tools-launcher__item-icon">
            <WhiteboardIcon />
          </span>
          <span>Whiteboard</span>
        </button>
      </div>
      <MeetingControlButton
        active={props.open || props.activeTool !== null}
        icon={<ToolsIcon />}
        label="Tools"
        onClick={props.onToggleOpen}
      />
    </div>
  );
}
