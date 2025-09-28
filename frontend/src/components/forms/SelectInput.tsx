import { useState, type ReactNode } from 'react';

interface Option {
  value: string;
  label: ReactNode;
}

export default function SelectInput({
  value,
  onChange,
  options,
  id,
  className = '',
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  id: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <div className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        className={`w-full border rounded px-2 py-1 flex items-center justify-between ${className}`}
      >
        <span
          className={`${selected ? '' : 'text-gray-500'} flex items-center gap-1`}
        >
          {selected ? selected.label : 'Select'}
        </span>
        <span className="ml-2">▾</span>
      </button>
      {open && !disabled && (
        <ul className="absolute z-10 w-full bg-white border rounded mt-1 max-h-40 overflow-auto">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                className="w-full text-left px-2 py-1 hover:bg-gray-100"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
