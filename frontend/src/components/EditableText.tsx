import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  value: string;
  onChange: (value: string) => void;
  renderDisplay?: (value: string) => ReactNode;
  renderEditor?: (
    value: string,
    setValue: (value: string) => void,
    finish: () => void,
  ) => ReactNode;
  className?: string;
  textClassName?: string;
}

export default function EditableText({
  value,
  onChange,
  renderDisplay,
  renderEditor,
  className = '',
  textClassName = '',
}: Props) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const finish = () => {
    setEditing(false);
    onChange(local);
  };
  return (
    <span
      className={`inline-flex items-center gap-1 leading-none ${className}`}
    >
      {editing ? (
        renderEditor ? (
          renderEditor(local, setLocal, finish)
        ) : (
          <input
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={finish}
            className={`px-1 border-b border-gray-300 bg-transparent focus:outline-none ${textClassName}`}
          />
        )
      ) : (
        <span className={`px-1 ${textClassName}`}>
          {renderDisplay ? renderDisplay(value) : value}
        </span>
      )}
      <Pencil
        className="w-3.5 h-3.5 -translate-y-0.5 text-gray-500 cursor-pointer shrink-0"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (editing) {
            setEditing(false);
            setLocal(value);
          } else {
            setEditing(true);
          }
        }}
      />
    </span>
  );
}
