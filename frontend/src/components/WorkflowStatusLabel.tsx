interface Props {
  status: 'active' | 'inactive' | 'retired';
}

export default function WorkflowStatusLabel({ status }: Props) {
  const base = 'px-2 py-1 rounded text-xs font-medium';
  if (status === 'active') {
    return (
      <span className={`${base} bg-green-100 text-green-800`}>Active</span>
    );
  }
  if (status === 'inactive') {
    return (
      <span className={`${base} bg-gray-200 text-gray-800`}>Inactive</span>
    );
  }
  return (
    <span className={`${base} bg-yellow-100 text-yellow-800`}>Retired</span>
  );
}
