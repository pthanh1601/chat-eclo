export function matrixErrorMessage(error: unknown): string {
  const candidate = error as {errcode?: string; data?: {errcode?: string; error?: string}; message?: string};
  const errcode = candidate.data?.errcode ?? candidate.errcode;
  const message = candidate.data?.error ?? candidate.message;

  if (errcode === 'M_FORBIDDEN' && message?.toLowerCase().includes('registration')) {
    return 'Tạm thời chưa thể tạo tài khoản mới.';
  }
  if (errcode === 'M_FORBIDDEN' || message?.toLowerCase().includes('invalid username or password')) {
    return 'Tên đăng nhập hoặc mật khẩu không đúng.';
  }
  return sanitizeUserFacingError(message ?? 'Có lỗi xảy ra.');
}

function sanitizeUserFacingError(message: string): string {
  if (/invalidattachmentdata/i.test(message)) {
    return 'Không đọc được tệp đã chọn.';
  }
  if (/room not found/i.test(message)) {
    return 'Không tìm thấy cuộc trò chuyện.';
  }
  const sanitized = message
    .replace(/([@#!][^\s:]+):(?:matrix\.)?5hpc\.com/gi, '$1')
    .replace(/https?:\/\/(?:matrix\.)?5hpc\.com\/?/gi, 'dịch vụ')
    .replace(/(?:matrix\.)?5hpc\.com/gi, 'dịch vụ')
    .replace(/\b(matrix|api|sdk|native|runtime|e2ee|homeserver|server|timeline|endpoint|backend)\b/gi, 'dịch vụ')
    .replace(/\bHTTP\s*\d+\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return sanitized && !/^[A-Z0-9_.:-]+$/.test(sanitized) ? sanitized : 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
}
