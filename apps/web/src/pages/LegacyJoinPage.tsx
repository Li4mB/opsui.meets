import { useEffect } from "react";

interface LegacyJoinPageProps {
  meetingCode: string | null;
  onNavigate(pathname: string, replace?: boolean): void;
}

export function LegacyJoinPage(props: LegacyJoinPageProps) {
  useEffect(() => {
    props.onNavigate(props.meetingCode ? `/${props.meetingCode}` : "/", true);
  }, [props.meetingCode, props.onNavigate]);

  return (
    <section className="page page--centered">
      <div className="status-card">
        <div className="eyebrow">Redirecting</div>
        <h1 className="status-card__title">Opening your meeting...</h1>
      </div>
    </section>
  );
}
