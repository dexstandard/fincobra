interface Props {
  date: string | number | Date;
}

export default function FormattedDate({ date }: Props) {
  const d = new Date(date);
  const short = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
    .format(d)
    .replace(/,\s*/g, ' ');
  const full = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
    .format(d)
    .replace(', ', ' ');
  return <span title={full}>{short}</span>;
}
