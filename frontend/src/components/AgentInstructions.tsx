import { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useTranslation } from '../lib/i18n';

interface Props {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}

const PREVIEW_LINE_LIMIT = 5;

export default function AgentInstructions({
  value,
  onChange,
  maxLength = 2000,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const t = useTranslation();

  const trimmedValue = value.trimEnd();
  const valueLines = trimmedValue ? trimmedValue.split(/\r?\n/) : [];
  const previewLines = valueLines.slice(0, PREVIEW_LINE_LIMIT);
  const hasMoreLines = valueLines.length > PREVIEW_LINE_LIMIT;
  const previewText = hasMoreLines
    ? `${previewLines.join('\n')}${previewLines.length ? '\n' : ''}…`
    : trimmedValue;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-1 mb-2">
        <h2 className="text-md font-bold flex-1">
          {t('trading_instructions')}
        </h2>
        <Pencil
          className="w-4 h-4 text-gray-500 cursor-pointer"
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
      </div>
      {editing ? (
        <>
          <textarea
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={() => {
              setEditing(false);
              onChange(local);
            }}
            maxLength={maxLength}
            rows={6}
            className="w-full border rounded p-2"
          />
          <div className="text-right text-sm text-gray-500 mt-1">
            {local.length} / {maxLength}
          </div>
        </>
      ) : (
        <pre className="whitespace-pre-wrap">
          {previewLines.length || hasMoreLines ? previewText : value}
        </pre>
      )}
    </div>
  );
}
