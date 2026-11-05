import { Button } from "./index";
import { Modal } from "./index";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={() => !busy && onClose()}
      width="sm"
    >
      <div className="modal-actions modal-actions--dialog">
        <Button variant="secondary" type="button" disabled={busy} onClick={onClose}>
          {cancelLabel}
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          type="button"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? "Please wait…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
