type Listener = () => void;

export type DemoRoom = {
  roomId: string;
  name: string;
  kind: 'room' | 'dm' | 'group';
  encrypted: boolean;
};

export type DemoMessage = {
  id: string;
  roomId: string;
  sender: string;
  body: string;
  timestamp: number;
  replyTo?: string;
};

const rooms: DemoRoom[] = [
  {roomId: 'local-room-general', name: 'Trò chuyện chung', kind: 'room', encrypted: false},
];
const messages: DemoMessage[] = [
  {
    id: 'demo-message-welcome',
    roomId: 'local-room-general',
    sender: '@demo:local',
    body: 'ECLO Chat đã sẵn sàng.',
    timestamp: Date.now(),
  },
];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach(listener => listener());
}

export const demoStore = {
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  listRooms() {
    return [...rooms].sort((a, b) => {
      const lastA = messages.filter(message => message.roomId === a.roomId).at(-1)?.timestamp ?? 0;
      const lastB = messages.filter(message => message.roomId === b.roomId).at(-1)?.timestamp ?? 0;
      return lastB - lastA;
    });
  },
  getMessages(roomId: string) {
    return messages.filter(message => message.roomId === roomId);
  },
  getRoom(roomId: string) {
    return rooms.find(room => room.roomId === roomId) ?? null;
  },
  createRoom(name: string, kind: DemoRoom['kind'] = 'room', encrypted = false) {
    const room: DemoRoom = {
      roomId: `demo-${kind}-${Date.now()}`,
      name,
      kind,
      encrypted,
    };
    rooms.push(room);
    emit();
    return room.roomId;
  },
  send(roomId: string, body: string, replyTo?: string) {
    messages.push({
      id: `demo-message-${Date.now()}`,
      roomId,
      sender: '@you:local',
      body,
      timestamp: Date.now(),
      replyTo,
    });
    emit();
  },
  react(roomId: string, eventId: string, key: string) {
    messages.push({
      id: `demo-reaction-${Date.now()}`,
      roomId,
      sender: '@you:local',
      body: `${key} reaction to ${eventId}`,
      timestamp: Date.now(),
    });
    emit();
  },
  poll(roomId: string, question: string, answers: string[]) {
    messages.push({
      id: `demo-poll-${Date.now()}`,
      roomId,
      sender: '@you:local',
      body: `[Poll] ${question} (${answers.join(' / ')})`,
      timestamp: Date.now(),
    });
    emit();
  },
  loadOlder(roomId: string) {
    messages.unshift({
      id: `demo-old-${Date.now()}`,
      roomId,
      sender: '@demo:local',
      body: 'Đã tải thêm tin nhắn cũ.',
      timestamp: Date.now() - 100000,
    });
    emit();
  },
};
