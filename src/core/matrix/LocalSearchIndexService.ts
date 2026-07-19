import AsyncStorage from '@react-native-async-storage/async-storage';
import type {TimelineItem} from './MessageService';

const ENABLED_PREFIX = 'eclo.local-search.enabled.';
const INDEX_PREFIX = 'eclo.local-search.messages.';
const MAX_MESSAGES_PER_ROOM = 1500;

type IndexedMessage = Pick<TimelineItem, 'id' | 'type' | 'sender' | 'senderName' | 'timestamp' | 'body' | 'messageKind' | 'mediaFileName'>;

class LocalSearchIndexService {
  private enabledCache = new Map<string, boolean>();

  async isEnabled(userId: string): Promise<boolean> {
    const cached = this.enabledCache.get(userId);
    if (cached !== undefined) {
      return cached;
    }
    const value = await AsyncStorage.getItem(`${ENABLED_PREFIX}${userId}`).catch(() => null);
    const enabled = value !== 'false';
    this.enabledCache.set(userId, enabled);
    return enabled;
  }

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    this.enabledCache.set(userId, enabled);
    await AsyncStorage.setItem(`${ENABLED_PREFIX}${userId}`, String(enabled));
    if (!enabled) {
      await this.clear(userId);
    }
  }

  async indexTimeline(userId: string, roomId: string, items: TimelineItem[]): Promise<void> {
    if (!await this.isEnabled(userId)) {
      return;
    }
    const key = this.roomKey(userId, roomId);
    const existing = await this.read(key);
    const byId = new Map(existing.map(item => [item.id, item]));
    for (const item of items) {
      if (!item.id || item.messageKind === 'reaction' || item.messageKind === 'encrypted') {
        continue;
      }
      byId.set(item.id, {
        id: item.id,
        type: item.type,
        sender: item.sender,
        senderName: item.senderName,
        timestamp: item.timestamp,
        body: item.body,
        messageKind: item.messageKind,
        mediaFileName: item.mediaFileName,
      });
    }
    const next = [...byId.values()]
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-MAX_MESSAGES_PER_ROOM);
    await AsyncStorage.setItem(key, JSON.stringify(next));
  }

  async search(userId: string, roomId: string, query: string): Promise<TimelineItem[]> {
    if (!await this.isEnabled(userId)) {
      return [];
    }
    const needle = query.trim().toLocaleLowerCase('vi');
    if (!needle) {
      return [];
    }
    const items = await this.read(this.roomKey(userId, roomId));
    return items
      .filter(item => `${item.senderName ?? ''} ${item.body} ${item.mediaFileName ?? ''}`.toLocaleLowerCase('vi').includes(needle))
      .map(item => ({...item, raw: {}}));
  }

  async clear(userId: string): Promise<void> {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = `${INDEX_PREFIX}${userId}.`;
    const owned = keys.filter(key => key.startsWith(prefix));
    await Promise.all(owned.map(key => AsyncStorage.removeItem(key)));
  }

  private async read(key: string): Promise<IndexedMessage[]> {
    const raw = await AsyncStorage.getItem(key).catch(() => null);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed as IndexedMessage[] : [];
    } catch {
      return [];
    }
  }

  private roomKey(userId: string, roomId: string): string {
    return `${INDEX_PREFIX}${userId}.${roomId}`;
  }
}

export const localSearchIndexService = new LocalSearchIndexService();
