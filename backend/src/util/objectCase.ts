import camelCase from 'lodash/camelCase.js';
import isPlainObject from 'lodash/isPlainObject.js';
import snakeCase from 'lodash/snakeCase.js';

type KeyConverter = (value: string) => string;

function convertKeys<T>(input: T, transformer: KeyConverter): T {
  if (Array.isArray(input)) {
    return input.map((item) => convertKeys(item, transformer)) as unknown as T;
  }

  if (isPlainObject(input)) {
    const record = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      result[transformer(key)] = convertKeys(value, transformer);
    }
    return result as unknown as T;
  }

  return input;
}

export function convertKeysToCamelCase<T>(input: T): T {
  return convertKeys(input, camelCase);
}

export function convertKeysToSnakeCase<T>(input: T): T {
  return convertKeys(input, snakeCase);
}
