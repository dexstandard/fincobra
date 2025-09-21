import EditableText from './EditableText';

interface Props {
  name: string;
  onChange: (value: string) => void;
  className?: string;
}

export default function WorkflowName({
  name,
  onChange,
  className = 'text-xl font-bold mb-2',
}: Props) {
  return <EditableText value={name} onChange={onChange} className={className} />;
}

