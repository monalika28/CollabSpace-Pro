# CollabSpace Pro 🎨⚡

> A high-performance, real-time collaborative canvas built with React, Node.js WebSockets, and Yjs CRDTs. Features sub-50ms peer synchronization, offline-first IndexedDB persistence, scoped multi-user undo/redo, and AI-driven diagram synthesis.

[![React](https://img.shields.io/badge/React-18-blue?logo=react)](https://react.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green?logo=node.js)](https://nodejs.org/)
[![WebSockets](https://img.shields.io/badge/Protocol-WebSockets-orange)](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)
[![CRDTs](https://img.shields.io/badge/State_Sync-Yjs_CRDTs-red)](https://github.com/yjs/yjs)
[![IndexedDB](https://img.shields.io/badge/Storage-IndexedDB_Offline-purple)](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)
[![License](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)

---

## 🌟 Key Engineering Features

- **Conflict-Free Replicated Data Types (CRDTs):** Employs **Yjs** state vectors over binary WebSockets to eliminate edit conflicts, race conditions, and distributed server locks.
- **Dual-Layer Persistence:**
  - **Client-Side:** Offline-first caching via `y-indexeddb` for instant load and disconnect recovery.
  - **Server-Side:** Debounced binary disk snapshots ensuring zero state loss on server restarts.
- **Scoped Multi-User Undo/Redo:** Utilizes `Y.UndoManager` isolated to the local user's operation history—peers can undo/redo their own actions without affecting collaborators.
- **Sub-50ms Multiplayer Presence:** Real-time peer cursors, identity badges, and dynamic room isolation built on the Yjs Awareness protocol.
- **AI Diagram Synthesis Engine:** Natural language prompt parser that translates architectural queries (e.g., *Kafka pipelines*, *Cache replication*, *CI/CD flows*) into structured vector canvas elements.
- **Rich Creative Tooling:**
  - Standard Pen, Calligraphy Brush, Soft Highlighter, and Dashed Flow lines.
  - Shapes (Rectangle, Circle, Straight Lines) with Outline, Translucent Soft Fill, and Solid Fill modes.
  - Dynamic multi-size Eraser (S/M/L/XL), Text elements, and Miro-style Sticky Notes.
  - Spring-interpolated magnetic follower cursor and PNG board export.

---

## 📐 System Architecture

```text
[ Browser Client A ]       [ Browser Client B ]
   (IndexedDB Cache)          (IndexedDB Cache)
          \                         /
           \-- Binary WebSocket ---/
                       |
               [ Node.js Server ]
            (Yjs Room Orchestrator)
                       |
             [ Disk Persistence ]
            (Debounced Binary Store)
