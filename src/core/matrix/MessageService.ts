import type {MatrixClient, MatrixEvent} from 'matrix-js-sdk';
import {ECLO_EVENT} from '../../config/matrix';
import {CryptoBackupService} from './CryptoBackupService';

export class MessageService {
  private readonly crypto: CryptoBackupService;

  constructor(private readonly client: MatrixClient) {
    this.crypto = new CryptoBackupService(client);
  }

  async sendText(roomId: string, body: string, extraContent: Record<string, unknown> = {}): Promise<void> {
    if (this.isRoomEncrypted(roomId)) {
      await this.crypto.prepareRoom(roomId);
    }
    await this.client.sendMessage(roomId, {
      msgtype: 'm.text',
      body,
      ...extraContent,
    } as any);
  }

  async sendFormattedText(roomId: string, body: string, htmlBody: string, replyTo?: string): Promise<void> {
    await this.sendText(roomId, body, {
      format: 'org.matrix.custom.html',
      formatted_body: htmlBody,
      ...(replyTo ? {
        'm.relates_to': {
          'm.in_reply_to': {event_id: replyTo},
        },
      } : {}),
    });
  }

  async sendReply(roomId: string, body: string, eventId: string): Promise<void> {
    await this.sendText(roomId, body, {
      'm.relates_to': {
        'm.in_reply_to': {event_id: eventId},
      },
    });
  }

  async forwardMessage(roomId: string, content: Record<string, unknown>): Promise<void> {
    const clone = {...content};
    delete clone['m.relates_to'];
    clone[ECLO_EVENT.forwarded] = true;
    await this.sendRoomEvent(roomId, 'm.room.message', clone);
  }

  async sendReaction(roomId: string, eventId: string, key: string): Promise<void> {
    await this.sendRoomEvent(roomId, 'm.reaction', {
      [ECLO_EVENT.reactionKey]: key,
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: eventId,
        key: `${key}${Date.now()}`,
      },
    });
  }

  async sendPoll(roomId: string, question: string, answers: string[]): Promise<void> {
    const cleanAnswers = answers.map(answer => answer.trim()).filter(Boolean).slice(0, 8);
    if (!question.trim() || cleanAnswers.length < 2) {
      throw new Error('Poll cần câu hỏi và ít nhất 2 lựa chọn.');
    }

    await this.sendRoomEvent(roomId, 'm.poll.start', {
      'm.text': question.trim(),
      'm.poll.start': {
        question: {'m.text': question.trim()},
        kind: 'm.poll.disclosed',
        max_selections: 1,
        answers: cleanAnswers.map((answer, index) => ({
          id: `answer-${index + 1}`,
          'm.text': answer,
        })),
      },
    });
  }

  async sendPollResponse(roomId: string, pollEventId: string, answerId: string): Promise<void> {
    await this.sendRoomEvent(roomId, 'm.poll.response', {
      'm.relates_to': {
        rel_type: 'm.reference',
        event_id: pollEventId,
      },
      'm.poll.response': {
        answers: [answerId],
      },
    });
  }

  async redactMessage(roomId: string, eventId: string, reason = 'Removed'): Promise<void> {
    await (this.client as any).redactEvent(roomId, eventId, undefined, {reason});
  }

  async redactVisibleTimeline(roomId: string, reason = 'Clear conversation'): Promise<number> {
    const room = this.client.getRoom(roomId);
    if (!room) {
      throw new Error('Không tìm thấy cuộc trò chuyện.');
    }
    const redactionTypes = new Set([
      'm.room.message',
      'm.room.encrypted',
      'm.poll.start',
      'm.poll.response',
      'm.reaction',
      'm.sticker',
    ]);
    let count = 0;
    for (const event of room.timeline) {
      const eventId = event.getId();
      if (!eventId || event.isRedacted() || !redactionTypes.has(event.getType())) {
        continue;
      }
      await this.redactMessage(roomId, eventId, reason);
      count += 1;
    }
    return count;
  }

  async loadMore(roomId: string, limit = 30): Promise<void> {
    const room = this.client.getRoom(roomId);
    if (!room) {
      throw new Error('Không tìm thấy cuộc trò chuyện.');
    }
    await this.client.scrollback(room, limit);
  }

  isRoomEncrypted(roomId: string): boolean {
    const room = this.client.getRoom(roomId);
    const encryption = room?.currentState.getStateEvents('m.room.encryption', '');
    return Boolean(encryption?.getContent()?.algorithm);
  }

  mapTimelineEvent(event: MatrixEvent): TimelineItem | null {
    if (event.isRedacted()) {
      return null;
    }
    const clear = event.getClearContent?.() ?? event.getContent();
    const type = event.getType();
    const eventId = event.getId();
    if (!eventId || !clear) {
      return null;
    }
    const sender = event.getSender() ?? '';
    const room = this.client.getRoom(event.getRoomId() ?? '');
    const member = sender ? room?.getMember(sender) : undefined;
    const senderName = member?.name || compactUserId(sender);
    const targetUserId = event.getStateKey?.() ?? '';
    const targetMember = targetUserId ? room?.getMember(targetUserId) : undefined;
    const targetName = targetMember?.name
      || (typeof clear.displayname === 'string' ? clear.displayname : '')
      || compactUserId(targetUserId);
    return {
      id: eventId,
      type,
      sender,
      senderName,
      senderAvatarUrl: this.mediaUrl(member?.getMxcAvatarUrl?.() ?? member?.events.member?.getContent()?.avatar_url),
      timestamp: event.getTs(),
      body: this.eventBody(type, clear, {event, sender, senderName, targetUserId, targetName}),
      formattedBody: typeof clear.formatted_body === 'string' ? clear.formatted_body : undefined,
      messageKind: this.messageKind(type, clear),
      mediaUrl: this.mediaEventUrl(clear),
      mediaHeaders: this.mediaHeaders(),
      mediaBatchId: this.mediaBatchId(clear),
      mediaSourceJson: this.mediaSourceJson(clear),
      mediaFileName: this.mediaFileName(clear),
      mediaMimeType: this.mediaMimeType(clear),
      poll: this.pollSummary(type, clear),
      replyTo: ((clear['m.relates_to'] as {'m.in_reply_to'?: {event_id?: string}} | undefined)?.['m.in_reply_to']?.event_id),
      reactionTargetId: this.reactionTargetId(type, clear),
      reactionKey: this.reactionKey(type, clear),
      raw: clear,
    };
  }

  private async sendRoomEvent(roomId: string, type: string, content: Record<string, unknown>): Promise<void> {
    if (this.isRoomEncrypted(roomId)) {
      await this.crypto.prepareRoom(roomId);
    }
    await (this.client as any).sendEvent(roomId, null, type, content);
  }

  private eventBody(
    type: string,
    content: Record<string, unknown>,
    context?: {event: MatrixEvent; sender: string; senderName: string; targetUserId: string; targetName: string},
  ): string {
    if (type === 'm.room.encrypted') {
      return 'Tin nhắn chưa thể hiển thị.';
    }
    if (type === 'm.room.pinned_events') {
      return `${context?.senderName || 'Một thành viên'} đã cập nhật tin nhắn ghim`;
    }
    if (type === 'm.room.name') {
      const name = typeof content.name === 'string' ? content.name.trim() : '';
      return name
        ? `${context?.senderName || 'Một thành viên'} đã đổi tên nhóm thành “${name}”`
        : `${context?.senderName || 'Một thành viên'} đã xóa tên nhóm`;
    }
    if (type === 'm.room.avatar') {
      return content.url
        ? `${context?.senderName || 'Một thành viên'} đã thay ảnh nhóm`
        : `${context?.senderName || 'Một thành viên'} đã xóa ảnh nhóm`;
    }
    if (type === 'm.room.topic') {
      return content.topic
        ? `${context?.senderName || 'Một thành viên'} đã cập nhật mô tả nhóm`
        : `${context?.senderName || 'Một thành viên'} đã xóa mô tả nhóm`;
    }
    if (type === 'm.room.member') {
      const membership = typeof content.membership === 'string' ? content.membership : '';
      const previous = context?.event.getPrevContent?.();
      const previousMembership = typeof previous?.membership === 'string' ? previous.membership : '';
      return memberActivityLabel({
        actorId: context?.sender ?? '',
        actorName: context?.senderName || 'Một thành viên',
        targetId: context?.targetUserId ?? '',
        targetName: context?.targetName || compactUserId(context?.targetUserId ?? ''),
        change: membershipChangeName(membership, previousMembership, context?.sender ?? '', context?.targetUserId ?? ''),
      });
    }
    if (type === 'm.room.power_levels') {
      const previous = context?.event.getPrevContent?.();
      const changedUserId = changedPowerLevelUser(content.users, previous?.users);
      if (changedUserId) {
        const room = this.client.getRoom(context?.event.getRoomId?.() ?? '');
        const changedName = room?.getMember(changedUserId)?.name || compactUserId(changedUserId);
        const level = numberValue((content.users as Record<string, unknown> | undefined)?.[changedUserId], 0);
        return `${context?.senderName || 'Một thành viên'} đã đổi quyền của ${changedName} thành ${roleLabelFromPowerLevel(level)}`;
      }
      return `${context?.senderName || 'Một thành viên'} đã cập nhật quyền thành viên`;
    }
    if (type === 'm.room.create') {
      return `${context?.senderName || 'Một thành viên'} đã tạo nhóm`;
    }
    if (type === 'm.room.join_rules') {
      return `${context?.senderName || 'Một thành viên'} đã cập nhật quyền tham gia nhóm`;
    }
    if (type === 'm.room.redaction') {
      return `${context?.senderName || 'Một thành viên'} đã xóa một nội dung`;
    }
    if (type !== 'm.room.message' && type !== 'm.poll.start' && type !== 'm.poll.response' && type !== 'm.reaction' && type !== 'm.sticker') {
      return `${context?.senderName || 'Một thành viên'} đã cập nhật nhóm`;
    }
    if (type === 'm.poll.start') {
      const poll = content['m.poll.start'] as {question?: {'m.text'?: string}} | undefined;
      return `[Poll] ${poll?.question?.['m.text'] ?? content['m.text'] ?? ''}`;
    }
    if (type === 'm.poll.response') {
      return '[Poll vote]';
    }
    if (type === 'm.reaction') {
      return String(content[ECLO_EVENT.reactionKey] ?? '[Reaction]');
    }
    if (type === 'm.sticker') {
      return '[Sticker]';
    }
    return String(content.body ?? content['m.text'] ?? '');
  }

  private messageKind(type: string, content: Record<string, unknown>): TimelineItem['messageKind'] {
    const msgtype = String(content.msgtype ?? '');
    if (type === 'm.poll.start') {
      return 'poll';
    }
    if (type === 'm.reaction') {
      return 'reaction';
    }
    if (type === 'm.sticker') {
      return 'sticker';
    }
    if (type === 'm.room.encrypted') {
      return 'encrypted';
    }
    if (type !== 'm.room.message') {
      return 'system';
    }
    if (msgtype === 'm.image') {
      return content[ECLO_EVENT.stickerMedia] ? 'sticker' : 'image';
    }
    if (msgtype === 'm.audio') {
      return 'audio';
    }
    if (msgtype === 'm.video') {
      return 'video';
    }
    if (msgtype === 'm.file') {
      return this.coerceMediaKind('file', content);
    }
    return 'text';
  }

  private pollSummary(type: string, content: Record<string, unknown>): TimelinePoll | undefined {
    if (type !== 'm.poll.start') {
      return undefined;
    }
    const poll = content['m.poll.start'] as {question?: {'m.text'?: string}; answers?: Array<{id: string; 'm.text'?: string}>} | undefined;
    return {
      question: poll?.question?.['m.text'] ?? String(content['m.text'] ?? ''),
      answers: poll?.answers?.map(answer => ({id: answer.id, text: answer['m.text'] ?? answer.id})) ?? [],
    };
  }

  private mediaEventUrl(content: Record<string, unknown>): string | undefined {
    const file = isRecord(content.file) ? content.file as {url?: string} : undefined;
    const info = content.info as {thumbnail_url?: string; thumbnail_file?: {url?: string}} | undefined;
    const directUrl = typeof content.url === 'string' ? content.url : undefined;
    const url = String(directUrl ?? file?.url ?? info?.thumbnail_url ?? info?.thumbnail_file?.url ?? '');
    const useThumbnail = content.msgtype === 'm.image' && !file;
    return this.mediaUrl(url, useThumbnail);
  }

  private mediaSourceJson(content: Record<string, unknown>): string | undefined {
    if (isRecord(content.file)) {
      return JSON.stringify(content.file);
    }
    if (typeof content.url === 'string' && content.url.trim()) {
      return content.url.trim();
    }
    return undefined;
  }

  private mediaFileName(content: Record<string, unknown>): string | undefined {
    const value = content.filename ?? content.body;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private mediaMimeType(content: Record<string, unknown>): string | undefined {
    const info = content.info as {mimetype?: string; mimeType?: string} | undefined;
    const file = isRecord(content.file) ? content.file as {mimetype?: string; mimeType?: string} : undefined;
    return info?.mimetype ?? info?.mimeType ?? file?.mimetype ?? file?.mimeType;
  }

  private coerceMediaKind(kind: TimelineItem['messageKind'], content: Record<string, unknown>): TimelineItem['messageKind'] {
    const mime = (this.mediaMimeType(content) ?? '').toLowerCase();
    const fileName = (this.mediaFileName(content) ?? '').toLowerCase();
    if (kind === 'file') {
      if (mime.startsWith('image/') || /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i.test(fileName)) {
        return 'image';
      }
      if (mime.startsWith('video/') || /\.(mov|m4v|mp4|webm)$/i.test(fileName)) {
        return 'video';
      }
      if (mime.startsWith('audio/') || /\.(aac|m4a|mp3|ogg|wav)$/i.test(fileName)) {
        return 'audio';
      }
    }
    return kind;
  }

  private reactionTargetId(type: string, content: Record<string, unknown>): string | undefined {
    if (type !== 'm.reaction') {
      return undefined;
    }
    const relatesTo = content['m.relates_to'] as {event_id?: string} | undefined;
    return relatesTo?.event_id;
  }

  private reactionKey(type: string, content: Record<string, unknown>): string | undefined {
    if (type !== 'm.reaction') {
      return undefined;
    }
    const relatesTo = content['m.relates_to'] as {key?: string} | undefined;
    return normalizeReactionKey(String(content[ECLO_EVENT.reactionKey] ?? relatesTo?.key ?? '')) || undefined;
  }

  private mediaBatchId(content: Record<string, unknown>): string | undefined {
    return String(content[ECLO_EVENT.mediaBatchId] ?? '').trim() || undefined;
  }

  private mediaHeaders(): Record<string, string> | undefined {
    const accessToken = (this.client as any).getAccessToken?.();
    return accessToken ? {Authorization: `Bearer ${accessToken}`} : undefined;
  }

  private mediaUrl(uri?: string | null, useThumbnail = true): string | undefined {
    if (!uri) {
      return undefined;
    }
    if (/^https?:\/\//i.test(uri)) {
      return uri;
    }
    const width = useThumbnail ? 800 : undefined;
    const height = useThumbnail ? 800 : undefined;
    const method = useThumbnail ? 'scale' : undefined;
    return (this.client as any).mxcUrlToHttp?.(uri, width, height, method, false, true, true)
      ?? (this.client as any).mxcUrlToHttp?.(uri, width, height, method)
      ?? undefined;
  }
}

function compactUserId(userId: string): string {
  return userId.replace(/^@/, '').split(':')[0] || userId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function memberActivityLabel({
  actorId,
  actorName,
  change,
  targetId,
  targetName,
}: {
  actorId: string;
  actorName: string;
  change: string;
  targetId: string;
  targetName: string;
}): string {
  const actor = actorName || compactUserId(actorId) || 'Một thành viên';
  const target = targetName || compactUserId(targetId) || 'một thành viên';
  const selfAction = Boolean(actorId && targetId && actorId === targetId);
  switch (change.toLowerCase()) {
    case 'invited':
      return `${actor} đã mời ${target} vào nhóm`;
    case 'joined':
    case 'invitationaccepted':
      return selfAction ? `${target} đã tham gia nhóm` : `${actor} đã thêm ${target} vào nhóm`;
    case 'left':
      return selfAction ? `${target} đã rời nhóm` : `${actor} đã xóa ${target} khỏi nhóm`;
    case 'kicked':
      return `${actor} đã xóa ${target} khỏi nhóm`;
    case 'banned':
    case 'kickedandbanned':
      return `${actor} đã chặn ${target} khỏi nhóm`;
    case 'unbanned':
      return `${actor} đã bỏ chặn ${target}`;
    case 'invitationrejected':
      return `${target} đã từ chối lời mời vào nhóm`;
    case 'invitationrevoked':
      return `${actor} đã thu hồi lời mời của ${target}`;
    case 'knocked':
      return `${target} đã gửi yêu cầu tham gia nhóm`;
    case 'knockaccepted':
      return `${actor} đã chấp nhận ${target} vào nhóm`;
    case 'knockretracted':
      return `${target} đã hủy yêu cầu tham gia nhóm`;
    case 'knockdenied':
      return `${actor} đã từ chối yêu cầu của ${target}`;
    default:
      return `${actor} đã cập nhật thành viên ${target}`;
  }
}

export function roleLabelFromPowerLevel(powerLevel: number): string {
  if (powerLevel >= 100) return 'Trưởng nhóm';
  if (powerLevel >= 50) return 'Phó nhóm';
  return 'Thành viên';
}

function membershipChangeName(current: string, previous: string, actorId: string, targetId: string): string {
  if (current === 'invite') return 'Invited';
  if (current === 'join' && previous === 'invite') return 'InvitationAccepted';
  if (current === 'join') return 'Joined';
  if (current === 'ban') return previous === 'ban' ? 'None' : 'Banned';
  if (current === 'leave' && previous === 'ban') return 'Unbanned';
  if (current === 'leave' && previous === 'invite') return actorId === targetId ? 'InvitationRejected' : 'InvitationRevoked';
  if (current === 'leave' && previous === 'join') return actorId === targetId ? 'Left' : 'Kicked';
  if (current === 'knock') return 'Knocked';
  return 'None';
}

function changedPowerLevelUser(current: unknown, previous: unknown): string | undefined {
  const currentUsers = isRecord(current) ? current : {};
  const previousUsers = isRecord(previous) ? previous : {};
  return [...new Set([...Object.keys(currentUsers), ...Object.keys(previousUsers)])]
    .find(userId => numberValue(currentUsers[userId], 0) !== numberValue(previousUsers[userId], 0));
}

function numberValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeReactionKey(key: string): string {
  const clean = key.trim();
  const known = ['👍', '❤️', '❤', '😂', '😮', '😢', '🙏'].find(reaction => clean.startsWith(reaction));
  return known ?? clean.replace(/\d+$/u, '');
}

export type TimelinePoll = {
  question: string;
  answers: Array<{id: string; text: string; count?: number; voters?: string[]; selected?: boolean}>;
  totalVotes?: number;
};

export type TimelineItem = {
  id: string;
  type: string;
  sender: string;
  senderName?: string;
  senderAvatarUrl?: string;
  timestamp: number;
  body: string;
  formattedBody?: string;
  messageKind?: 'text' | 'image' | 'audio' | 'video' | 'file' | 'poll' | 'reaction' | 'sticker' | 'encrypted' | 'system';
  mediaUrl?: string;
  mediaHeaders?: Record<string, string>;
  mediaBatchId?: string;
  mediaSourceJson?: string;
  mediaFileName?: string;
  mediaMimeType?: string;
  mediaItems?: TimelineMediaItem[];
  poll?: TimelinePoll;
  reactions?: TimelineReaction[];
  reactionTargetId?: string;
  reactionKey?: string;
  raw: Record<string, unknown>;
  replyTo?: string;
};

export type TimelineMediaItem = {
  id: string;
  kind: 'image' | 'audio' | 'video' | 'file' | 'sticker';
  mediaUrl?: string;
  mediaHeaders?: Record<string, string>;
  mediaSourceJson?: string;
  mediaFileName?: string;
  mediaMimeType?: string;
};

export type TimelineReaction = {
  key: string;
  count: number;
  senders: string[];
};

export function roomListPreviewFromContent(type: string | undefined, content: Record<string, unknown> | undefined, fallback = ''): string {
  const value = content ?? {};
  const msgtype = String(value.msgtype ?? '');
  const mimeType = String((value.info as {mimetype?: string} | undefined)?.mimetype ?? '');
  if (type === 'm.sticker' || value[ECLO_EVENT.stickerMedia] || msgtype === 'm.sticker') {
    return 'Sticker';
  }
  if (type === 'm.poll.start' || type === 'm.poll.response' || value['m.poll.start'] || value['m.poll.response']) {
    return 'Bình chọn';
  }
  if (msgtype === 'm.image' || mimeType.startsWith('image/')) {
    return 'Hình ảnh';
  }
  if (msgtype === 'm.video' || mimeType.startsWith('video/')) {
    return 'Video';
  }
  if (msgtype === 'm.audio' || mimeType.startsWith('audio/')) {
    return 'Tin nhắn thoại';
  }
  const body = typeof value.body === 'string' ? value.body : fallback;
  return normalizeRoomListPreview(body);
}

export function normalizeRoomListPreview(value?: string): string {
  const clean = (value ?? '').trim();
  if (!clean) {
    return '';
  }
  if (clean === 'Tin nhắn mã hóa' || clean.startsWith('Không giải mã được tin nhắn')) {
    return 'Tin nhắn chưa hiển thị';
  }
  if (/^\[?poll(?: vote)?\]?/i.test(clean) || /^bình chọn$/i.test(clean)) {
    return 'Bình chọn';
  }
  if (/^\[?sticker\]?$/i.test(clean) || /^sticker[-_. ]/i.test(clean)) {
    return 'Sticker';
  }
  if (/^(?:https?:\/\/|mxc:\/\/|file:\/\/).*\.(?:avif|gif|heic|heif|jpe?g|png|webp)(?:\?.*)?$/i.test(clean)
    || /^[^/\\\n]+\.(?:avif|gif|heic|heif|jpe?g|png|webp)$/i.test(clean)
    || /^(?:image|img|photo|ảnh|hình ảnh)[-_. ].*\.(?:avif|gif|heic|heif|jpe?g|png|webp)$/i.test(clean)) {
    return 'Hình ảnh';
  }
  if (/^(?:https?:\/\/|mxc:\/\/|file:\/\/).*\.(?:aac|amr|caf|flac|m4a|mp3|oga|ogg|opus|wav)(?:\?.*)?$/i.test(clean)
    || /^[^/\\\n]+\.(?:aac|amr|caf|flac|m4a|mp3|oga|ogg|opus|wav)$/i.test(clean)
    || /^(?:audio|voice|recording|ghi[-_. ]?am)[-_. ].*\.(?:aac|amr|caf|flac|m4a|mp3|oga|ogg|opus|wav)$/i.test(clean)) {
    return 'Tin nhắn thoại';
  }
  return clean;
}
