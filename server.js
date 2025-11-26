// andy-call / server.js
// WebSocket signaling + chat + host control for ANDY LIVE

const WebSocket = require("ws");

const PORT = process.env.PORT || 3000;

// rooms: { roomName: Map(clientId -> ws) }
const rooms = new Map();
let nextClientId = 1;

const wss = new WebSocket.Server({ port: PORT }, () => {
  console.log(`[ANDY-CALL] Signaling server running on port ${PORT}`);
});

wss.on("connection", (ws) => {
  const clientId = nextClientId++;
  let roomName = null;

  console.log(`[ANDY-CALL] Client connected: ${clientId}`);

  ws.on("message", (message) => {
    let data;
    try {
      data = JSON.parse(message.toString());
    } catch (e) {
      console.error("Invalid JSON:", message.toString());
      return;
    }

    if (!data.type) return;

    switch (data.type) {
      case "join": {
        // data: { type: 'join', room: 'ROOM_NAME', name: 'ANDY' }
        roomName = (data.room || "").trim();
        if (!roomName) {
          ws.send(JSON.stringify({ type: "error", message: "Room name required" }));
          return;
        }

        if (!rooms.has(roomName)) {
          rooms.set(roomName, new Map());
        }

        const room = rooms.get(roomName);
        room.set(clientId, ws);

        console.log(`[ANDY-CALL] Client ${clientId} joined room ${roomName}`);

        const otherIds = Array.from(room.keys()).filter((id) => id !== clientId);
        ws.send(
          JSON.stringify({
            type: "joined",
            id: clientId,
            room: roomName,
            peers: otherIds,
          })
        );

        broadcastToRoom(
          roomName,
          {
            type: "peer-joined",
            id: clientId,
          },
          clientId
        );

        break;
      }

      case "signal": {
        // data: { type: 'signal', targetId, payload }
        if (!roomName) return;
        const targetId = data.targetId;
        const payload = data.payload;
        const room = rooms.get(roomName);
        if (!room) return;
        const targetSocket = room.get(targetId);
        if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) return;

        targetSocket.send(
          JSON.stringify({
            type: "signal",
            fromId: clientId,
            payload,
          })
        );
        break;
      }

      case "chat": {
        // data: { type: 'chat', name, text }
        if (!roomName) return;
        const text = (data.text || "").toString().slice(0, 500);
        const name = (data.name || "Guest").toString().slice(0, 40);
        if (!text.trim()) return;

        broadcastToRoom(roomName, {
          type: "chat",
          fromId: clientId,
          name,
          text,
        });
        break;
      }

      case "control": {
        // host control: { type: 'control', targetId, action }
        // action: 'mute-audio','unmute-audio','mute-video','unmute-video'
        if (!roomName) return;
        const room = rooms.get(roomName);
        if (!room) return;
        const targetId = data.targetId;
        const targetSocket = room.get(targetId);
        if (!targetSocket || targetSocket.readyState !== WebSocket.OPEN) return;

        targetSocket.send(
          JSON.stringify({
            type: "control",
            fromId: clientId,
            targetId,
            action: data.action,
          })
        );
        break;
      }

      default:
        break;
    }
  });

  ws.on("close", () => {
    console.log(`[ANDY-CALL] Client disconnected: ${clientId}`);
    if (roomName && rooms.has(roomName)) {
      const room = rooms.get(roomName);
      room.delete(clientId);

      broadcastToRoom(
        roomName,
        {
          type: "peer-left",
          id: clientId,
        },
        clientId
      );

      if (room.size === 0) {
        rooms.delete(roomName);
        console.log(`[ANDY-CALL] Room ${roomName} removed (empty)`);
      }
    }
  });

  ws.on("error", (err) => {
    console.error("[ANDY-CALL] WS error:", err);
  });
});

function broadcastToRoom(roomName, msgObj, excludeId = null) {
  const room = rooms.get(roomName);
  if (!room) return;
  const message = JSON.stringify(msgObj);
  room.forEach((clientWs, id) => {
    if (id === excludeId) return;
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(message);
    }
  });
}
