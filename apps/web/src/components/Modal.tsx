import type { MouseEvent, PropsWithChildren, ReactNode } from "react";

interface ModalProps extends PropsWithChildren {
  actions?: ReactNode;
  description?: string;
  onClose(): void;
  open: boolean;
  title: string;
}

export function Modal(props: ModalProps) {
  if (!props.open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={props.onClose} role="presentation">
      <div
        aria-modal="true"
        className="modal"
        onClick={(event: MouseEvent<HTMLDivElement>) => {
          event.stopPropagation();
        }}
        role="dialog"
      >
        <div className="modal__header">
          <div>
            <div className="eyebrow">Opsuimeets</div>
            <h2 className="modal__title">{props.title}</h2>
            {props.description ? <p className="modal__description">{props.description}</p> : null}
          </div>
          <button
            aria-label="Close dialog"
            className="icon-button icon-button--small"
            onClick={props.onClose}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className="modal__body">{props.children}</div>
        {props.actions ? <div className="modal__actions">{props.actions}</div> : null}
      </div>
    </div>
  );
}
