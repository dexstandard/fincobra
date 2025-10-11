import { describe, it, expect, vi } from 'vitest';
import {
  NEWS_AGENT_EVENT_TYPES,
  newsAgentInstructions,
  newsAgentResponseSchema,
  buildNewsAgentUserContent,
  parseNewsAgentContent,
  runNewsAgent,
} from '../src/agents/news-analyst.js';

const SAMPLE_RESPONSE = {
  category: 'Hack',
  category_confidence: 0.9,
  sentiment: 'bearish',
  sentiment_confidence: 0.7,
  severity: 0.85,
  novelty: 0.6,
  time_sensitivity: 0.8,
  priority: 4,
  reasoning: 'Bridge exploit impacts user funds.',
  risk_notes: 'Monitor for follow-up disclosures.',
  tags: ['ETH', 'L2'],
};

describe('news agent helpers', () => {
  it('builds user content with sanitized tokens', () => {
    const input = {
      headline: 'Binance halts withdrawals amid outage',
      tokens: ['btc', 'eth', 'btc', ' '],
      summary: null,
      domain: 'coindesk.com',
      publishedAt: '2025-01-01T00:00:00Z',
    };
    const content = buildNewsAgentUserContent(input);
    const parsed = JSON.parse(content) as Record<string, unknown>;

    expect(parsed.referenced_symbols).toEqual(['BTC', 'ETH']);
    expect(parsed.headline).toBe(input.headline);
    expect(parsed.domain).toBe(input.domain);
  });

  it('parses news agent content with normalization', () => {
    const analysis = parseNewsAgentContent(
      JSON.stringify({
        ...SAMPLE_RESPONSE,
        category: 'hack',
        severity: 1.2,
        novelty: -0.2,
        time_sensitivity: 2,
        priority: 6,
        tags: ['eth', 'ETH', '', 42, 'Layer2'],
      }),
    );

    expect(analysis.category).toBe('Hack');
    expect(analysis.severity).toBeCloseTo(1);
    expect(analysis.novelty).toBe(0);
    expect(analysis.timeSensitivity).toBeCloseTo(1);
    expect(analysis.priority).toBe(5);
    expect(analysis.tags).toEqual(['eth', 'Layer2']);
    expect(analysis.raw).toBeDefined();
  });

  it('invokes groq client with json schema response format', async () => {
    const input = {
      headline: 'Bridge hacked for $10M',
      tokens: ['eth', 'usdt'],
      summary: 'Large exploit on cross-chain bridge.',
    };
    const expectedUserContent = buildNewsAgentUserContent(input);

    const createMock = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify(SAMPLE_RESPONSE),
          },
        },
      ],
    });
    const client = {
      chat: {
        completions: {
          create: createMock,
        },
      },
    };

    const result = await runNewsAgent(input, {
      client: client as any,
      temperature: 0.1,
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith({
      model: 'groq/compound',
      messages: [
        { role: 'system', content: newsAgentInstructions },
        { role: 'user', content: expectedUserContent },
      ],
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'news_agent_response',
          strict: true,
          schema: newsAgentResponseSchema,
        },
      },
    });

    expect(result.category).toBe('Hack');
    expect(result.categoryConfidence).toBeCloseTo(0.9);
    expect(result.tags).toEqual(['ETH', 'L2']);
  });

  it('includes all categories in the instruction header', () => {
    for (const category of NEWS_AGENT_EVENT_TYPES) {
      expect(newsAgentInstructions).toContain(category);
    }
  });
});

