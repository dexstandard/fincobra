import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

export default function Modal({ open, onClose, children, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      const input = containerRef.current?.querySelector('input');
      input?.focus();
      input?.select();
    }
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black bg-opacity-50 p-4">
      <div
        ref={containerRef}
        className={`bg-white text-gray-900 p-4 rounded shadow max-w-lg w-full relative ${className ?? ''}`}
      >
        {children}
        <button
          type="button"
          className="absolute top-2 right-2 mr-2 text-gray-600"
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </div>
  );
}
