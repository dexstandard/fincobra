import { useEffect, useRef, useState } from 'react';
import TokenDisplay from '../TokenDisplay';

interface Option {
  value: string;
}

export default function TokenSelect({
  value,
  onChange,
  options,
  id,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  id: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((o) => o.value === value);
  const filtered = options.filter((o) =>
    o.value.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen(!open);
          setQuery('');
        }}
        className="w-full border rounded px-2 py-1 flex items-center justify-between"
      >
        {selected ? (
          <TokenDisplay token={selected.value} />
        ) : (
          <span className="text-gray-500">Select a token</span>
        )}
        <span className="ml-2">▾</span>
      </button>
      {open && !disabled && (
        <div className="absolute z-10 w-full bg-white border rounded mt-1">
          {options.length >= 5 && (
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="w-full px-2 py-1 border-b"
              autoFocus
            />
          )}
          <ul className="max-h-40 overflow-auto">
            {filtered.map((opt) => (
              <li key={opt.value}>
                <button
                  type="button"
                  className="w-full text-left px-2 py-1 hover:bg-gray-100 flex items-center"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <TokenDisplay token={opt.value} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
