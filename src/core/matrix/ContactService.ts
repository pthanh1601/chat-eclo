import AsyncStorage from '@react-native-async-storage/async-storage';

export type ContactRecord = {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  roomId?: string;
  source?: 'local' | 'dm' | 'invite' | 'search';
  addedAt?: number;
};

export type ContactRequestRecord = ContactRecord & {
  roomId: string;
  title: string;
  direction: 'incoming' | 'outgoing';
};

const PREFIX = 'eclo:contacts:';

export function normalizeContactId(input: string, fallbackServer?: string): string {
  const value = input.trim();
  if (!value) {
    return '';
  }
  if (value.startsWith('@')) {
    return value;
  }
  const server = fallbackServer?.replace(/^matrix\./, '');
  return server ? `@${value}:${server}` : value;
}

export function displayNameForContact(contact: ContactRecord): string {
  return contact.displayName?.trim() || contact.userId.split(':')[0]?.replace('@', '') || contact.userId;
}

export function shortContactId(userId: string): string {
  return userId.startsWith('@') ? userId.replace(/:.+$/, '') : userId;
}

export function contactInitial(contact: ContactRecord): string {
  return displayNameForContact(contact).trim().charAt(0).toUpperCase() || '#';
}

export function contactSection(contact: ContactRecord): string {
  const letter = contactInitial(contact);
  return /[A-Z]/.test(letter) ? letter : '#';
}

export function mergeContacts(...groups: ContactRecord[][]): ContactRecord[] {
  const merged = new Map<string, ContactRecord>();
  for (const group of groups) {
    for (const contact of group) {
      const userId = contact.userId.trim();
      if (!userId) {
        continue;
      }
      const existing = merged.get(userId);
      merged.set(userId, {
        ...existing,
        ...contact,
        displayName: contact.displayName ?? existing?.displayName,
        avatarUrl: contact.avatarUrl ?? existing?.avatarUrl,
        roomId: contact.roomId ?? existing?.roomId,
        addedAt: existing?.addedAt ?? contact.addedAt,
      });
    }
  }
  return [...merged.values()].sort((a, b) => displayNameForContact(a).localeCompare(displayNameForContact(b)));
}

export async function loadLocalContacts(ownerId: string): Promise<ContactRecord[]> {
  const raw = await AsyncStorage.getItem(storageKey(ownerId)).catch(() => null);
  if (!raw) {
    return [];
  }
  try {
    const contacts = JSON.parse(raw) as ContactRecord[];
    return contacts.filter(contact => Boolean(contact.userId));
  } catch {
    return [];
  }
}

export async function saveLocalContact(ownerId: string, contact: ContactRecord): Promise<ContactRecord[]> {
  const current = await loadLocalContacts(ownerId);
  const next = mergeContacts(current, [{...contact, source: 'local', addedAt: contact.addedAt ?? Date.now()}])
    .filter(item => item.source !== 'dm');
  await AsyncStorage.setItem(storageKey(ownerId), JSON.stringify(next));
  return next;
}

export async function removeLocalContact(ownerId: string, userId: string): Promise<ContactRecord[]> {
  const current = await loadLocalContacts(ownerId);
  const next = current.filter(contact => contact.userId !== userId);
  await AsyncStorage.setItem(storageKey(ownerId), JSON.stringify(next));
  return next;
}

function storageKey(ownerId: string): string {
  return `${PREFIX}${encodeURIComponent(ownerId)}`;
}
