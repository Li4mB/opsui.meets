import { useEffect, useRef, useState } from "react";

interface MeetingJoinLoaderProps {
  active: boolean;
  className?: string;
  meetingCode: string;
  onCancel(): void;
}

const QUIRKY_LINES = [
  "Warming up the pixels...",
  "Teaching the servers to share...",
  "Fluffing the digital pillows...",
  "Checking if everyone's camera is off yet...",
  "Adjusting the virtual chairs...",
  "Convincing the Wi-Fi to cooperate...",
  "Sharpening the pixels...",
  "Asking the cloud nicely...",
  "Making sure the mute button works...",
  "Untangling the audio cables...",
  "Finding the best lighting angle...",
  "Testing the echo... echo... echo...",
  "Charging the virtual handshake...",
  "Making sure time zones agree...",
  "Polishing the loading screen...",
  "Aligning the meeting stars...",
  "Brewing a fresh connection...",
  "Counting to infinite... almost there...",
  "Consulting the meeting oracle...",
  "Giving the routers a pep talk...",
];

export function MeetingJoinLoader(props: MeetingJoinLoaderProps) {
  const progressRef = useRef(0);
  const lineTimeoutRef = useRef<number | null>(null);
  const [isEntered, setIsEntered] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const [lineVisible, setLineVisible] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setIsEntered(true);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLineVisible(false);
      if (lineTimeoutRef.current) {
        window.clearTimeout(lineTimeoutRef.current);
      }
      lineTimeoutRef.current = window.setTimeout(() => {
        setLineIndex((current) => (current + 1) % QUIRKY_LINES.length);
        setLineVisible(true);
        lineTimeoutRef.current = null;
      }, 400);
    }, 3_000);

    return () => {
      if (lineTimeoutRef.current) {
        window.clearTimeout(lineTimeoutRef.current);
      }
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let frameId = 0;

    const tick = () => {
      const target = props.active ? 94 : 100;
      const remaining = target - progressRef.current;
      if (remaining <= 0.15) {
        progressRef.current = target;
        setProgress(target);
        return;
      }

      const increment = props.active
        ? Math.max(0.12, remaining * 0.018)
        : Math.max(0.8, remaining * 0.22);
      progressRef.current = Math.min(target, progressRef.current + increment);
      setProgress(progressRef.current);
      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [props.active]);

  return (
    <div
      className={[
        "meeting-entry-loader",
        props.className ?? "",
        isEntered ? "is-entered" : "",
        props.active ? "is-active" : "is-completing",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="meeting-entry-loader"
    >
      <div aria-hidden="true" className="meeting-entry-loader__glow meeting-entry-loader__glow--primary" />
      <div aria-hidden="true" className="meeting-entry-loader__glow meeting-entry-loader__glow--secondary" />

      <div className="meeting-entry-loader__content">
        <div aria-hidden="true" className="meeting-entry-loader__ring">
          <div className="meeting-entry-loader__ring-track" />
          <div className="meeting-entry-loader__ring-spin meeting-entry-loader__ring-spin--outer" />
          <div className="meeting-entry-loader__ring-spin meeting-entry-loader__ring-spin--inner" />
          <div className="meeting-entry-loader__ring-center">
            <div className="meeting-entry-loader__ring-dot" />
          </div>
          <div className="meeting-entry-loader__ring-glow" />
        </div>

        <div className="meeting-entry-loader__copy">
          <h1 className="meeting-entry-loader__title">Joining meeting</h1>

          <div className="meeting-entry-loader__code-pill">
            <svg
              aria-hidden="true"
              className="meeting-entry-loader__code-icon"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2Z"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
              />
            </svg>
            <span>{props.meetingCode}</span>
          </div>

          <div className="meeting-entry-loader__progress">
            <div className="meeting-entry-loader__progress-meta">
              <span>Connecting</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="meeting-entry-loader__progress-track">
              <div
                className="meeting-entry-loader__progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="meeting-entry-loader__line-wrap">
            <p className={`meeting-entry-loader__line${lineVisible ? " is-visible" : ""}`}>
              {QUIRKY_LINES[lineIndex]}
            </p>
          </div>

          <button
            className="meeting-entry-loader__cancel"
            onClick={props.onCancel}
            type="button"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
