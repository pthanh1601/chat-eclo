import type {MatrixClient, Room} from 'matrix-js-sdk';
import {MEGOLM_ALGORITHM} from '../../config/matrix';
import {mergeContacts, type ContactRecord, type ContactRequestRecord} from './ContactService';

export type ContactRequest = ContactRequestRecord;

export type GroupRequest = {
  roomId: string;
  title: string;
  avatarUrl?: string;
  inviter?: string;
  memberCount?: number;
  direction: 'incoming';
};

export class RoomService {
  constructor(private readonly client: MatrixClient) {}

  listJoinedRooms(): Room[] {
    return this.client
      .getVisibleRooms()
      .filter(room => room.getMyMembership() === 'join')
      .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
  }

  getDirectUserId(room: Room): string | null {
    const directUserId = this.directUserIdFromAccountData(room.roomId);
    if (directUserId) {
      return directUserId;
    }
    const myUserId = this.client.getUserId();
    const members = room.getMyMembership() === 'join' ? room.getJoinedMembers() : room.currentState.getMembers();
    const other = members.find(member => member.userId !== myUserId);
    return other?.userId ?? null;
  }

  listDirectContacts(): ContactRecord[] {
    return mergeContacts(this.listJoinedRooms()
      .map((room): ContactRecord | null => {
        if (!this.directUserIdFromAccountData(room.roomId)) {
          return null;
        }
        if (this.isInactiveDirectRoom(room)) {
          return null;
        }
        const userId = this.getDirectUserId(room);
        if (!userId) {
          return null;
        }
        const member = room.getMember(userId);
        return {
          userId,
          roomId: room.roomId,
          displayName: member?.name || room.name || userId,
          avatarUrl: this.mediaUrl(member?.getMxcAvatarUrl?.() ?? member?.events.member?.getContent()?.avatar_url),
          source: 'dm' as const,
        };
      })
      .filter((contact): contact is ContactRecord => Boolean(contact)));
  }

  listContactRequests(): ContactRequest[] {
    return this.client
      .getRooms()
      .filter(room => room.getMyMembership() === 'invite' && this.isDirectInvite(room))
      .map(room => {
        const userId = this.getDirectUserId(room) ?? (room as any).getDMInviter?.() ?? room.roomId;
        const member = room.getMember(userId);
        return {
          userId,
          roomId: room.roomId,
          title: member?.name || room.name || userId,
          displayName: member?.name || userId,
          avatarUrl: this.mediaUrl(member?.getMxcAvatarUrl?.() ?? member?.events.member?.getContent()?.avatar_url),
          source: 'invite' as const,
          direction: 'incoming' as const,
        };
      });
  }

  listGroupRooms(): Room[] {
    return this.listJoinedRooms().filter(room => !this.directUserIdFromAccountData(room.roomId));
  }

  listGroupInvites(): GroupRequest[] {
    return this.client
      .getRooms()
      .filter(room => room.getMyMembership() === 'invite' && !this.isDirectInvite(room))
      .map(room => {
        const inviter = (room as any).getDMInviter?.();
        return {
          roomId: room.roomId,
          title: room.name || room.roomId,
          avatarUrl: this.mediaUrl(room.getMxcAvatarUrl?.()),
          inviter,
          memberCount: room.currentState.getMembers().length || undefined,
          direction: 'incoming' as const,
        };
      });
  }

  listSentContactRequests(): ContactRequest[] {
    return this.listJoinedRooms()
      .filter(room => this.isPendingOutgoingDirectRequest(room))
      .map(room => {
        const userId = this.getDirectUserId(room) ?? room.roomId;
        const member = room.getMember(userId);
        return {
          userId,
          roomId: room.roomId,
          title: member?.name || room.name || userId,
          displayName: member?.name || userId,
          avatarUrl: this.mediaUrl(member?.getMxcAvatarUrl?.() ?? member?.events.member?.getContent()?.avatar_url),
          source: 'invite' as const,
          direction: 'outgoing' as const,
        };
      });
  }

  async searchUsers(term: string): Promise<ContactRecord[]> {
    const response = await (this.client as any).searchUserDirectory({term, limit: 20});
    return (response.results ?? []).map((user: {user_id: string; display_name?: string; avatar_url?: string}) => ({
      userId: user.user_id,
      displayName: user.display_name,
      avatarUrl: this.mediaUrl(user.avatar_url),
      source: 'search' as const,
    }));
  }

  private mediaUrl(uri?: string | null): string | undefined {
    if (!uri) {
      return undefined;
    }
    if (/^https?:\/\//i.test(uri)) {
      return uri;
    }
    const converted = (this.client as any).mxcUrlToHttp?.(uri, 160, 160, 'crop', false, true)
      ?? (this.client as any).mxcUrlToHttp?.(uri, 160, 160, 'crop');
    return converted ?? undefined;
  }

  isPendingDirectRequest(room: Room): boolean {
    return this.isInactiveDirectRoom(room);
  }

  private isPendingOutgoingDirectRequest(room: Room): boolean {
    if (!this.directUserIdFromAccountData(room.roomId)) {
      return false;
    }
    const myUserId = this.client.getUserId();
    const otherMembers = room.currentState.getMembers().filter(member => member.userId !== myUserId);
    const hasInvitedMember = otherMembers.some(member => member.membership === 'invite');
    const hasJoinedPeer = room.getJoinedMembers().some(member => member.userId !== myUserId);
    return hasInvitedMember && !hasJoinedPeer && !this.hasUserMessage(room);
  }

  private isInactiveDirectRoom(room: Room): boolean {
    if (!this.directUserIdFromAccountData(room.roomId)) {
      return false;
    }
    const myUserId = this.client.getUserId();
    const hasJoinedPeer = room.getJoinedMembers().some(member => member.userId !== myUserId);
    return !hasJoinedPeer && !this.hasUserMessage(room);
  }

  isEncrypted(room: Room): boolean {
    return Boolean(room.currentState.getStateEvents('m.room.encryption', '')?.getContent()?.algorithm);
  }

  async createOrOpenDirectChat(targetUserId: string): Promise<string> {
    const existing = this.client
      .getRooms()
      .find(room => {
        if (!['join', 'invite'].includes(room.getMyMembership()) || this.getDirectUserId(room) !== targetUserId) {
          return false;
        }
        return !this.isInactiveDirectRoom(room) || this.isPendingOutgoingDirectRequest(room);
      });
    if (existing) {
      return existing.roomId;
    }

    const response = await (this.client as any).createRoom({
      visibility: 'private',
      preset: 'private_chat',
      invite: [targetUserId],
      is_direct: true,
      initial_state: [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: {algorithm: MEGOLM_ALGORITHM},
        },
        {
          type: 'm.room.history_visibility',
          state_key: '',
          content: {history_visibility: 'shared'},
        },
      ],
    });

    await this.markDirectRoom(targetUserId, response.room_id);
    return response.room_id;
  }

  getOpenDirectRoomId(targetUserId: string): string | null {
    const room = this.listJoinedRooms().find(item => {
      if (this.getDirectUserId(item) !== targetUserId) {
        return false;
      }
      return !this.isPendingDirectRequest(item);
    });
    return room?.roomId ?? null;
  }

  async createGroupChat(name: string, invite: string[]): Promise<string> {
    const response = await (this.client as any).createRoom({
      visibility: 'private',
      preset: 'private_chat',
      name,
      invite,
      initial_state: [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: {algorithm: MEGOLM_ALGORITHM},
        },
      ],
    });
    return response.room_id;
  }

  async createPlainRoom(name: string): Promise<string> {
    const response = await (this.client as any).createRoom({
      visibility: 'private',
      preset: 'private_chat',
      name,
    });
    return response.room_id;
  }

  async joinRoom(roomAliasOrId: string): Promise<string> {
    const response = await (this.client as any).joinRoom(roomAliasOrId);
    return response.room_id ?? roomAliasOrId;
  }

  async acceptInvite(roomId: string, directUserId?: string): Promise<string> {
    const joinedRoomId = await this.joinRoom(roomId);
    if (directUserId) {
      await this.markDirectRoom(directUserId, joinedRoomId);
    }
    return joinedRoomId;
  }

  async leaveRoom(roomId: string): Promise<void> {
    const directUserId = this.directUserIdFromAccountData(roomId);
    await this.client.leave(roomId);
    await (this.client as any).forget?.(roomId, true)?.catch?.(() => undefined);
    if (directUserId) {
      await this.unmarkDirectRoom(directUserId, roomId);
    }
  }

  private async markDirectRoom(userId: string, roomId: string): Promise<void> {
    const direct = (((await (this.client as any).getAccountDataFromServer('m.direct')) ?? {}) as Record<string, string[]>);
    const rooms = new Set(direct[userId] ?? []);
    rooms.add(roomId);
    await (this.client as any).setAccountData('m.direct', {...direct, [userId]: [...rooms]});
  }

  private async unmarkDirectRoom(userId: string, roomId: string): Promise<void> {
    const serverDirect = await (this.client as any).getAccountDataFromServer?.('m.direct')?.catch?.(() => undefined);
    const localDirect = (this.client as any).getAccountData?.('m.direct')?.getContent?.();
    const direct = {...(localDirect ?? {}), ...(serverDirect ?? {})} as Record<string, string[]>;
    const nextRooms = (direct[userId] ?? []).filter(item => item !== roomId);
    const next = {...direct};
    if (nextRooms.length) {
      next[userId] = nextRooms;
    } else {
      delete next[userId];
    }
    await (this.client as any).setAccountData('m.direct', next).catch?.(() => undefined);
  }

  private directUserIdFromAccountData(roomId: string): string | null {
    const content = ((this.client as any).getAccountData?.('m.direct')?.getContent?.() ?? {}) as Record<string, string[]>;
    return Object.entries(content).find(([, roomIds]) => roomIds.includes(roomId))?.[0] ?? null;
  }

  private isDirectInvite(room: Room): boolean {
    return Boolean((room as any).getDMInviter?.() || this.directUserIdFromAccountData(room.roomId));
  }

  private hasUserMessage(room: Room): boolean {
    return room.timeline.some(event => ['m.room.message', 'm.room.encrypted'].includes(event.getType()));
  }
}
