import Button from './Button';
import Modal from './Modal';
import { useTranslation } from '../../lib/i18n';

interface Props {
  open: boolean;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: 'primary' | 'secondary' | 'danger' | 'link';
}

export default function ConfirmDialog({
  open,
  message,
  onConfirm,
  onCancel,
  confirmText,
  cancelText,
  confirmVariant = 'primary',
}: Props) {
  const t = useTranslation();
  const confirmLabel = confirmText ?? t('confirm');
  const cancelLabel = cancelText ?? t('cancel');
  return (
    <Modal open={open} onClose={onCancel}>
      <p className="mb-4">{message}</p>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
