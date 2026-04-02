import type { ReactNode } from "react";

interface MeetingControlButtonProps {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  type?: "button" | "submit";
}

export function MeetingControlButton(props: MeetingControlButtonProps) {
  const className = [
    "meeting-control-button",
    props.active ? " meeting-control-button--active" : "",
    props.danger ? " meeting-control-button--danger" : "",
  ].join("");

  return (
    <button
      aria-label={props.label}
      className={className}
      disabled={props.disabled}
      onClick={props.onClick}
      type={props.type ?? "button"}
    >
      <span className="meeting-control-button__icon">{props.icon}</span>
      <span className="meeting-control-button__label">{props.label}</span>
    </button>
  );
}
