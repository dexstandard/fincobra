import TokenSelect from './forms/TokenSelect';
import TextInput from './forms/TextInput';
import SelectInput from './forms/SelectInput';
import FormField from './forms/FormField';
import {
  tokens,
  riskOptions,
  reviewIntervalOptions,
  stableCoins,
} from '../lib/constants';
import { useTranslation } from '../lib/i18n';

interface StrategyData {
  tokens: { token: string; minAllocation: number }[];
  risk: string;
  reviewInterval: string;
}

interface Props {
  data: StrategyData;
  onChange: <K extends keyof StrategyData>(
    key: K,
    value: StrategyData[K],
  ) => void;
  disabled?: boolean;
}

export default function StrategyForm({
  data,
  onChange,
  disabled = false,
}: Props) {
  const t = useTranslation();
  const { tokens: tokenData, risk, reviewInterval } = data;
  const token1 = tokenData[0];
  const token2 = tokenData[1];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('token1')} htmlFor="token1">
          <TokenSelect
            id="token1"
            value={token1.token}
            onChange={(v) =>
              onChange('tokens', [{ ...token1, token: v }, token2])
            }
            options={tokens.filter(
              (t) =>
                t.value === token1.token ||
                (t.value !== token2.token &&
                  !(
                    stableCoins.includes(t.value) &&
                    stableCoins.includes(token2.token)
                  )),
            )}
            disabled={disabled}
          />
        </FormField>
        <FormField label={t('token2')} htmlFor="token2">
          <TokenSelect
            id="token2"
            value={token2.token}
            onChange={(v) =>
              onChange('tokens', [token1, { ...token2, token: v }])
            }
            options={tokens.filter(
              (t) =>
                t.value === token2.token ||
                (t.value !== token1.token &&
                  !(
                    stableCoins.includes(t.value) &&
                    stableCoins.includes(token1.token)
                  )),
            )}
            disabled={disabled}
          />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t('min_token_allocation').replace(
            '{token}',
            token1.token.toUpperCase(),
          )}
          htmlFor="minToken1Allocation"
        >
          <TextInput
            id="minToken1Allocation"
            type="number"
            min={0}
            max={95}
            value={token1.minAllocation}
            onChange={(e) =>
              onChange('tokens', [
                { ...token1, minAllocation: Number(e.target.value) },
                token2,
              ])
            }
            disabled={disabled}
          />
        </FormField>
        <FormField
          label={t('min_token_allocation').replace(
            '{token}',
            token2.token.toUpperCase(),
          )}
          htmlFor="minToken2Allocation"
        >
          <TextInput
            id="minToken2Allocation"
            type="number"
            min={0}
            max={95}
            value={token2.minAllocation}
            onChange={(e) =>
              onChange('tokens', [
                token1,
                { ...token2, minAllocation: Number(e.target.value) },
              ])
            }
            disabled={disabled}
          />
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <FormField label={t('risk_tolerance')} htmlFor="risk">
          <SelectInput
            id="risk"
            value={risk}
            onChange={(v) => onChange('risk', v)}
            options={riskOptions}
            disabled={disabled}
          />
        </FormField>
        <FormField
          label={t('review_interval')}
          htmlFor="reviewInterval"
          tooltip={t('review_interval_tooltip')}
        >
          <SelectInput
            id="reviewInterval"
            value={reviewInterval}
            onChange={(v) => onChange('reviewInterval', v)}
            options={reviewIntervalOptions(t)}
            disabled={disabled}
          />
        </FormField>
      </div>
    </div>
  );
}
