import { base32Encode } from './utils/base32'; // Need to add this if it exists

function startDirectCall(roomId: string | undefined, mediaType: CallMediaType): void {
  if (!roomId) {
    Alert.alert('Chưa thể gọi', 'Hãy gửi tin nhắn đầu tiên để tạo hội thoại trước khi gọi.');
    return;
  }

  let actionClient: any = null;
  try {
    actionClient = matrixClientService.currentClient;
  } catch (err) {
    // Native mode fallback
  }
  const room = actionClient?.getRoom(roomId);

  let isGroup = false;
  if (room) {
    const jCount = room.getJoinedMemberCount() || 0;
    const iCount = room.getInvitedMemberCount() || 0;
    isGroup = (jCount + iCount) > 2;
  } else {
    const nativeRooms = nativeMatrixService.getCachedRooms();
    const nativeRoom = nativeRooms.find((r: any) => r.roomId === roomId);
    if (nativeRoom && !nativeRoom.isDirect) {
      isGroup = true;
    }
  }

  if (isGroup && mediaType === 'video') {
    const userId = actionClient?.getUserId() || nativeMatrixService.currentUserId || '';
    const jitsiDomain = "jitsi.5hpc.com";
    // Basic conference ID generation (or use base32 if we have the util)
    const conferenceID = roomId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() + Date.now().toString().slice(-4);

    const sendFallbackMessage = async () => {
      try {
        const jitsiCallEvent = {
          id: "jitsi_" + Date.now(),
          type: "video",
          url: `https://${jitsiDomain}/${conferenceID}`,
          roomName: conferenceID,
          domain: jitsiDomain,
          creator: userId,
          roomId: roomId,
          ts: Date.now()
        };
        
        if (actionClient) {
          await actionClient.sendEvent(roomId, "m.room.message", {
            msgtype: "m.text",
            body: "📹 Cuộc gọi video nhóm",
            "org.eclo.jitsi": jitsiCallEvent
          });
        } else {
          const auth = nativeMatrixService.currentAccessToken;
          const baseUrl = nativeMatrixService.currentBaseUrl;
          if (auth && baseUrl) {
            await fetch(`${baseUrl.replace(/\/$/, '')}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${Date.now()}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${auth}`
              },
              body: JSON.stringify({
                msgtype: "m.text",
                body: "📹 Cuộc gọi video nhóm",
                "org.eclo.jitsi": jitsiCallEvent
              })
            });
          }
        }
      } catch (err) {
        console.error("Failed to send fallback message", err);
      }
    };

    sendFallbackMessage().then(() => {
        DeviceEventEmitter.emit('OPEN_JITSI_MODAL', { conferenceId: conferenceID, domain: jitsiDomain });
    });
    return;
  }

  callService.placeCall(roomId, mediaType).catch(error => {
    const message = error instanceof Error ? error.message : 'Không thể thực hiện cuộc gọi.';
    Alert.alert(mediaType === 'video' ? 'Lỗi gọi video' : 'Lỗi gọi thoại', message);
  });
}
