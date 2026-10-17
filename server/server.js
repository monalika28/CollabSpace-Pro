const http = require('http');
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 1234;
const STORAGE_DIR = path.join(__dirname, 'storage');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'Persistent Yjs Engine' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const messageSync = 0;
const messageAwareness = 1;
const rooms = new Map();

function getOrCreateRoom(docName) {
  let room = rooms.get(docName);
  if (!room) {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const conns = new Set();
    const filePath = path.join(STORAGE_DIR, `${docName}.bin`);

    // Load persisted state from disk
    if (fs.existsSync(filePath)) {
      try {
        const persistedData = fs.readFileSync(filePath);
        Y.applyUpdate(doc, persistedData);
      } catch (e) {
        console.error('Persistence load error:', e);
      }
    }

    // Persist updates to disk debounced
    let saveTimeout = null;
    doc.on('update', (update, origin) => {
      // Broadcast to other peers
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      conns.forEach((conn) => {
        if (conn !== origin && conn.readyState === 1) {
          conn.send(message);
        }
      });

      // Debounced write
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        try {
          const snapshot = Y.encodeStateAsUpdate(doc);
          fs.writeFileSync(filePath, Buffer.from(snapshot));
        } catch (e) {
          console.error('Persistence save error:', e);
        }
      }, 500);
    });

    awareness.on('update', ({ added, updated, removed }, origin) => {
      const changedClients = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
      );
      const buff = encoding.toUint8Array(encoder);

      conns.forEach((conn) => {
        if (conn !== origin && conn.readyState === 1) {
          conn.send(buff);
        }
      });
    });

    room = { doc, awareness, conns };
    rooms.set(docName, room);
  }
  return room;
}

wss.on('connection', (conn, req) => {
  const docName = req.url.slice(1).split('?')[0] || 'global-canvas';
  const room = getOrCreateRoom(docName);
  room.conns.add(conn);

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  conn.send(encoding.toUint8Array(encoder));

  const awarenessStates = room.awareness.getStates();
  if (awarenessStates.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, messageAwareness);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(
        room.awareness,
        Array.from(awarenessStates.keys())
      )
    );
    conn.send(encoding.toUint8Array(awarenessEncoder));
  }

  conn.on('message', (message) => {
    try {
      const uint8Msg = new Uint8Array(message);
      const decoder = decoding.createDecoder(uint8Msg);
      const messageType = decoding.readVarUint(decoder);

      if (messageType === messageSync) {
        const replyEncoder = encoding.createEncoder();
        encoding.writeVarUint(replyEncoder, messageSync);
        syncProtocol.readSyncMessage(decoder, replyEncoder, room.doc, conn);

        if (encoding.length(replyEncoder) > 1) {
          conn.send(encoding.toUint8Array(replyEncoder));
        }
      } else if (messageType === messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          conn
        );
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  });

  conn.on('close', () => {
    room.conns.delete(conn);
    if (room.conns.size === 0) {
      room.awareness.destroy();
      rooms.delete(docName);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Persistent Sync Server running on port: ${PORT}`);
});