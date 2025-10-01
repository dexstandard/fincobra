import { useTranslation } from '../lib/i18n';

export default function RiskDisplay({
  risk,
  className = '',
}: {
  risk: string;
  className?: string;
}) {
  const t = useTranslation();
  const key = risk.toLowerCase();
  const colors: Record<string, string> = {
    low: '#16a34a',
    medium: '#d97706',
    mid: '#d97706',
    high: '#dc2626',
  };

  const labels: Record<string, string> = {
    low: t('risk_low'),
    medium: t('risk_medium'),
    mid: t('risk_medium'),
    high: t('risk_high'),
  };

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: colors[key] || colors.low }}
      />
      <span className="capitalize">{labels[key] || key}</span>
    </span>
  );
}
