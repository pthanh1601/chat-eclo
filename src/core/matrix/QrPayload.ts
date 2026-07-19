import {MATRIX_TO_BASE_URL} from '../../config/matrix';

export type MatrixQrEntity = {
  kind: 'user' | 'room';
  id: string;
};

export function matrixEntityQrValue(id: string): string {
  return `${MATRIX_TO_BASE_URL}/${encodeURIComponent(id.trim())}`;
}

export function parseMatrixQrValue(rawValue: string): MatrixQrEntity | undefined {
  const value = rawValue.trim();
  if (!value) {
    return undefined;
  }

  const direct = classifyMatrixId(value);
  if (direct) {
    return direct;
  }

  if (/^eclo:\/\//i.test(value)) {
    const match = value.match(/^eclo:\/\/(user|room)\/(.+)$/i);
    if (match?.[2]) {
      return classifyMatrixId(safeDecode(match[2]));
    }
  }

  if (/^matrix:/i.test(value)) {
    const matrixUriId = value
      .replace(/^matrix:(?:u|user)\//i, '@')
      .replace(/^matrix:(?:r|roomid)\//i, '!')
      .replace(/^matrix:(?:room)\//i, '#')
      .split('?')[0];
    return classifyMatrixId(safeDecode(matrixUriId ?? ''));
  }

  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== 'matrix.to') {
      return undefined;
    }
    const fragment = url.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
    return classifyMatrixId(safeDecode(fragment));
  } catch {
    return undefined;
  }
}

function classifyMatrixId(id: string): MatrixQrEntity | undefined {
  const clean = id.trim();
  if (/^@[^:]+:.+/.test(clean)) {
    return {kind: 'user', id: clean};
  }
  if (/^[!#][^:]+:.+/.test(clean)) {
    return {kind: 'room', id: clean};
  }
  return undefined;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
