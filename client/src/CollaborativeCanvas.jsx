import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { 
  Pencil, 
  Highlighter,
  Paintbrush,
  Square, 
  Circle, 
  Minus, 
  Eraser, 
  Type,
  StickyNote,
  Sparkles,
  Undo2, 
  Redo2, 
  Trash2, 
  Download, 
  Users,
  Copy,
  Check,
  Wifi,
  WifiOff
} from 'lucide-react';

const PALETTE = [
  '#0f172a', '#dc2626', '#ea580c', '#d97706', '#16a34a',
  '#0284c7', '#4f46e5', '#9333ea', '#db2777', '#64748b'
];

const PEN_WIDTHS = [2, 4, 8, 14];
const ERASER_SIZES = [
  { label: 'S', size: 12 },
  { label: 'M', size: 26 },
  { label: 'L', size: 48 },
  { label: 'XL', size: 75 }
];

export default function CollaborativeCanvas() {
  const canvasRef = useRef(null);
  
  const [tool, setTool] = useState('pen');
  const [strokeColor, setStrokeColor] = useState('#0f172a');
  const [fillMode, setFillMode] = useState('none');
  const [lineWidth, setLineWidth] = useState(3);
  const [eraserSize, setEraserSize] = useState(26);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const startPointRef = useRef(null);
  const currentPathRef = useRef([]);
  
  const [remoteCursors, setRemoteCursors] = useState({});
  const [collaborators, setCollaborators] = useState([]);
  const [status, setStatus] = useState('Connecting...');
  const [isOfflineSynced, setIsOfflineSynced] = useState(false);
  const [copied, setCopied] = useState(false);

  // Spring Follower Cursor State
  const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 });
  const [followerPos, setFollowerPos] = useState({ x: -100, y: -100 });
  const [isHovered, setIsHovered] = useState(false);

  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  const roomId = useMemo(() => {
    return window.location.hash.replace('#', '') || 'main-room';
  }, []);

  const myProfile = useMemo(() => {
    const avatarColors = ['#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
    return {
      id: Math.random().toString(36).substring(2, 7),
      name: `Peer-${Math.floor(100 + Math.random() * 900)}`,
      color: avatarColors[Math.floor(Math.random() * avatarColors.length)],
    };
  }, []);

  const providerRef = useRef(null);
  const yShapesRef = useRef(null);
  const undoManagerRef = useRef(null);

  const getTranslucentColor = (hex, alpha = 0.25) => {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
  };

  // Cursor Spring Physics Loop
  useEffect(() => {
    let animId;
    const follow = () => {
      setFollowerPos((prev) => ({
        x: prev.x + (cursorPos.x - prev.x) * 0.22,
        y: prev.y + (cursorPos.y - prev.y) * 0.22,
      }));
      animId = requestAnimationFrame(follow);
    };
    animId = requestAnimationFrame(follow);
    return () => cancelAnimationFrame(animId);
  }, [cursorPos]);

  // Dedicated Render Engine
  const renderAll = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !yShapesRef.current) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Render all committed shapes from CRDT
    yShapesRef.current.toArray().forEach((shape) => {
      ctx.save();
      ctx.strokeStyle = shape.color;
      ctx.fillStyle = shape.color;
      ctx.lineWidth = shape.width || 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (shape.type === 'dashed') ctx.setLineDash([8, 8]);
      if (shape.type === 'highlighter') ctx.globalAlpha = 0.35;
      if (shape.type === 'brush') {
        ctx.lineWidth = (shape.width || 3) * 2.2;
        ctx.globalAlpha = 0.85;
      }

      if (['pen', 'brush', 'highlighter', 'dashed', 'eraser'].includes(shape.type)) {
        if (!shape.points || shape.points.length < 2) {
          ctx.restore();
          return;
        }
        ctx.beginPath();
        ctx.moveTo(shape.points[0].x, shape.points[0].y);
        for (let i = 1; i < shape.points.length; i++) {
          ctx.lineTo(shape.points[i].x, shape.points[i].y);
        }
        ctx.stroke();
      } else if (shape.type === 'rect') {
        if (shape.fillMode === 'solid') {
          ctx.fillStyle = shape.color;
          ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
        } else if (shape.fillMode === 'translucent') {
          ctx.fillStyle = getTranslucentColor(shape.color, 0.25);
          ctx.fillRect(shape.x, shape.y, shape.w, shape.h);
        }
        ctx.strokeRect(shape.x, shape.y, shape.w, shape.h);
      } else if (shape.type === 'circle') {
        ctx.beginPath();
        const r = Math.sqrt(Math.pow(shape.w, 2) + Math.pow(shape.h, 2));
        ctx.arc(shape.x, shape.y, r, 0, 2 * Math.PI);
        if (shape.fillMode === 'solid') {
          ctx.fillStyle = shape.color;
          ctx.fill();
        } else if (shape.fillMode === 'translucent') {
          ctx.fillStyle = getTranslucentColor(shape.color, 0.25);
          ctx.fill();
        }
        ctx.stroke();
      } else if (shape.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(shape.x, shape.y);
        ctx.lineTo(shape.x + shape.w, shape.y + shape.h);
        ctx.stroke();
      } else if (shape.type === 'sticky') {
        ctx.fillStyle = shape.bgColor || '#fef08a';
        ctx.shadowColor = 'rgba(0,0,0,0.1)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetY = 4;
        ctx.fillRect(shape.x, shape.y, shape.w || 150, shape.h || 120);
        ctx.shadowColor = 'transparent';
        
        ctx.fillStyle = '#0f172a';
        ctx.font = '500 13px Inter, sans-serif';
        const lines = (shape.text || '').split('\n');
        lines.forEach((line, index) => {
          ctx.fillText(line, shape.x + 12, shape.y + 24 + (index * 18), shape.w - 24);
        });
      } else if (shape.type === 'text') {
        ctx.font = '600 15px Inter, sans-serif';
        ctx.fillText(shape.text || '', shape.x, shape.y);
      }

      ctx.restore();
    });

    // 2. Render live local active stroke
    if (currentPathRef.current.length > 1) {
      const activePts = currentPathRef.current;
      ctx.save();
      ctx.strokeStyle = tool === 'eraser' ? '#f8fafc' : strokeColor;
      let calcWidth = lineWidth;
      if (tool === 'eraser') calcWidth = eraserSize;
      else if (tool === 'highlighter') calcWidth = lineWidth * 2.5;
      else if (tool === 'brush') calcWidth = lineWidth * 2.2;

      ctx.lineWidth = calcWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (tool === 'dashed') ctx.setLineDash([8, 8]);
      if (tool === 'highlighter') ctx.globalAlpha = 0.35;
      if (tool === 'brush') ctx.globalAlpha = 0.85;

      ctx.beginPath();
      ctx.moveTo(activePts[0].x, activePts[0].y);
      for (let i = 1; i < activePts.length; i++) {
        ctx.lineTo(activePts[i].x, activePts[i].y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }, [tool, strokeColor, lineWidth, eraserSize]);

  useEffect(() => {
    const ydoc = new Y.Doc();
    
    const idbPersistence = new IndexeddbPersistence(`canvas-store-${roomId}`, ydoc);
    idbPersistence.on('synced', () => {
      setIsOfflineSynced(true);
      renderAll();
    });

    const provider = new WebsocketProvider('ws://localhost:1234', roomId, ydoc);
    const yShapes = ydoc.getArray('elements');
    const undoManager = new Y.UndoManager(yShapes);

    providerRef.current = provider;
    yShapesRef.current = yShapes;
    undoManagerRef.current = undoManager;

    yShapes.observe(() => {
      renderAll();
    });

    provider.on('status', (e) => setStatus(e.status));

    const awareness = provider.awareness;
    awareness.setLocalStateField('user', myProfile);

    const updatePresence = () => {
      const states = awareness.getStates();
      const cursors = {};
      const activeUsers = [];

      states.forEach((state, clientID) => {
        if (state.user) {
          activeUsers.push(state.user);
          if (clientID !== awareness.clientID && state.cursor) {
            cursors[clientID] = { ...state.cursor, ...state.user };
          }
        }
      });

      setRemoteCursors(cursors);
      setCollaborators(activeUsers);
    };

    awareness.on('change', updatePresence);

    return () => {
      yShapes.unobserve(renderAll);
      awareness.off('change', updatePresence);
      provider.destroy();
      idbPersistence.destroy();
      ydoc.destroy();
    };
  }, [roomId, myProfile, renderAll]);

  useEffect(() => {
    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
        renderAll();
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [renderAll]);

  const handlePointerDown = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (tool === 'text') {
      const text = prompt('Enter your text:');
      if (text && text.trim() && yShapesRef.current) {
        yShapesRef.current.push([{
          type: 'text',
          text: text.trim(),
          x: pt.x,
          y: pt.y,
          color: strokeColor,
          width: lineWidth
        }]);
      }
      return;
    }

    if (tool === 'sticky') {
      const noteText = prompt('Sticky Note message:');
      if (noteText && noteText.trim() && yShapesRef.current) {
        yShapesRef.current.push([{
          type: 'sticky',
          text: noteText.trim(),
          x: pt.x,
          y: pt.y,
          w: 160,
          h: 110,
          bgColor: '#fef08a',
          color: '#0f172a'
        }]);
      }
      return;
    }

    setIsDrawing(true);
    startPointRef.current = pt;

    if (['pen', 'brush', 'highlighter', 'dashed', 'eraser'].includes(tool)) {
      currentPathRef.current = [pt, { x: pt.x + 0.1, y: pt.y + 0.1 }];
      renderAll();
    }
  };

  const handlePointerMove = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    // Update dynamic follower cursor
    setCursorPos({ x: pt.x, y: pt.y });
    setIsHovered(true);

    if (providerRef.current) {
      providerRef.current.awareness.setLocalStateField('cursor', pt);
    }

    if (!isDrawing) return;

    if (['pen', 'brush', 'highlighter', 'dashed', 'eraser'].includes(tool)) {
      currentPathRef.current.push(pt);
      renderAll();
    } else {
      renderAll();
      const ctx = canvas.getContext('2d');
      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      const startPt = startPointRef.current;
      if (!startPt) return;
      const w = pt.x - startPt.x;
      const h = pt.y - startPt.y;

      if (tool === 'rect') {
        if (fillMode === 'solid') {
          ctx.fillStyle = strokeColor;
          ctx.fillRect(startPt.x, startPt.y, w, h);
        } else if (fillMode === 'translucent') {
          ctx.fillStyle = getTranslucentColor(strokeColor, 0.25);
          ctx.fillRect(startPt.x, startPt.y, w, h);
        }
        ctx.strokeRect(startPt.x, startPt.y, w, h);
      } else if (tool === 'circle') {
        ctx.beginPath();
        const r = Math.sqrt(Math.pow(w, 2) + Math.pow(h, 2));
        ctx.arc(startPt.x, startPt.y, r, 0, 2 * Math.PI);
        if (fillMode === 'solid') {
          ctx.fillStyle = strokeColor;
          ctx.fill();
        } else if (fillMode === 'translucent') {
          ctx.fillStyle = getTranslucentColor(strokeColor, 0.25);
          ctx.fill();
        }
        ctx.stroke();
      } else if (tool === 'line') {
        ctx.beginPath();
        ctx.moveTo(startPt.x, startPt.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  const handlePointerUp = (e) => {
    if (!isDrawing) return;
    setIsDrawing(false);

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };

    if (!yShapesRef.current) return;

    if (['pen', 'brush', 'highlighter', 'dashed', 'eraser'].includes(tool)) {
      const pts = [...currentPathRef.current];
      currentPathRef.current = [];
      if (pts.length >= 2) {
        let finalWidth = lineWidth;
        if (tool === 'eraser') finalWidth = eraserSize;
        else if (tool === 'highlighter') finalWidth = lineWidth * 2.5;
        else if (tool === 'brush') finalWidth = lineWidth * 2.2;

        yShapesRef.current.push([{
          type: tool,
          points: pts,
          color: tool === 'eraser' ? '#f8fafc' : strokeColor,
          width: finalWidth,
        }]);
      }
    } else if (startPointRef.current) {
      const startPt = startPointRef.current;
      const w = pt.x - startPt.x;
      const h = pt.y - startPt.y;
      if (Math.abs(w) > 3 || Math.abs(h) > 3) {
        yShapesRef.current.push([{
          type: tool,
          x: startPt.x,
          y: startPt.y,
          w,
          h,
          color: strokeColor,
          width: lineWidth,
          fillMode: fillMode,
        }]);
      }
      startPointRef.current = null;
    }
    renderAll();
  };

  const handleGenerateAiDiagram = () => {
    if (!aiPrompt.trim()) return;
    setIsGeneratingAi(true);

    setTimeout(() => {
      const text = aiPrompt.toLowerCase();
      const generated = [];

      if (text.includes('database') || text.includes('sql') || text.includes('redis') || text.includes('cache')) {
        generated.push(
          { type: 'rect', x: 180, y: 160, w: 140, h: 60, color: '#0284c7', width: 2, fillMode: 'translucent' },
          { type: 'text', text: 'App Backend', x: 205, y: 195, color: '#0f172a', width: 2 },
          { type: 'line', x: 320, y: 190, w: 90, h: -40, color: '#64748b', width: 2 },
          { type: 'line', x: 320, y: 190, w: 90, h: 40, color: '#64748b', width: 2 },
          { type: 'rect', x: 410, y: 120, w: 160, h: 55, color: '#dc2626', width: 2, fillMode: 'translucent' },
          { type: 'text', text: 'Redis (Cache Layer)', x: 420, y: 155, color: '#0f172a', width: 2 },
          { type: 'rect', x: 410, y: 205, w: 160, h: 55, color: '#16a34a', width: 2, fillMode: 'translucent' },
          { type: 'text', text: 'PostgreSQL (Primary)', x: 420, y: 240, color: '#0f172a', width: 2 },
          { type: 'sticky', text: 'Data Architecture:\nCache-Aside with Read Replicas', x: 610, y: 140, w: 170, h: 100, bgColor: '#fef08a' }
        );
      } else if (text.includes('pipeline') || text.includes('ci/cd') || text.includes('devops')) {
        const stages = ['GitHub Push', 'CI Test/Lint', 'Docker Build', 'Prod Deploy'];
        const colors = ['#4f46e5', '#0284c7', '#d97706', '#16a34a'];
        stages.forEach((stage, i) => {
          const x = 120 + i * 170;
          generated.push(
            { type: 'rect', x, y: 180, w: 130, h: 60, color: colors[i], width: 2, fillMode: 'translucent' },
            { type: 'text', text: stage, x: x + 15, y: 215, color: '#0f172a', width: 2 }
          );
          if (i < stages.length - 1) {
            generated.push({ type: 'line', x: x + 130, y: 210, w: 40, h: 0, color: '#94a3b8', width: 2 });
          }
        });
        generated.push({ type: 'sticky', text: 'Pipeline Specs:\nAutomated Verification & Release', x: 800, y: 160, w: 160, h: 90, bgColor: '#fef08a' });
      } else {
        const tokens = aiPrompt.trim().split(/\s+/).filter(w => w.length > 2).slice(0, 4);
        const labels = tokens.length > 0 ? tokens : ['Client App', 'Processor', 'Storage'];
        
        labels.forEach((label, idx) => {
          const x = 160 + idx * 190;
          const colorPalette = ['#0284c7', '#16a34a', '#ea580c', '#9333ea'];
          generated.push(
            { type: 'rect', x, y: 180, w: 140, h: 60, color: colorPalette[idx % colorPalette.length], width: 2, fillMode: 'translucent' },
            { type: 'text', text: label.toUpperCase(), x: x + 18, y: 215, color: '#0f172a', width: 2 }
          );
          if (idx < labels.length - 1) {
            generated.push({ type: 'line', x: x + 140, y: 210, w: 50, h: 0, color: '#94a3b8', width: 2 });
          }
        });

        generated.push({
          type: 'sticky',
          text: `Custom Workflow:\n"${aiPrompt.slice(0, 40)}"`,
          x: 160 + labels.length * 190,
          y: 165,
          w: 160,
          h: 90,
          bgColor: '#fef08a'
        });
      }

      if (yShapesRef.current) {
        yShapesRef.current.push(generated);
      }

      setIsGeneratingAi(false);
      setIsAiModalOpen(false);
      setAiPrompt('');
    }, 600);
  };

  const undo = () => undoManagerRef.current && undoManagerRef.current.undo();
  const redo = () => undoManagerRef.current && undoManagerRef.current.redo();
  const clearBoard = () => yShapesRef.current && yShapesRef.current.delete(0, yShapesRef.current.length);

  const copyRoomInvite = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportCanvas = () => {
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.download = `whiteboard-${roomId}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#f8fafc' }}>
      
      {/* Top Header */}
      <div style={{
        position: 'absolute',
        top: 16,
        left: 20,
        right: 20,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 20,
        pointerEvents: 'none'
      }}>
        <div style={{
          pointerEvents: 'auto',
          background: 'rgba(255, 255, 255, 0.88)',
          backdropFilter: 'blur(16px)',
          border: '1px solid #e2e8f0',
          padding: '8px 18px',
          borderRadius: '14px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              width: '9px',
              height: '9px',
              borderRadius: '50%',
              background: '#4f46e5'
            }} />
            <span style={{ fontWeight: 800, fontSize: '15px', color: '#0f172a' }}>CollabSpace Pro</span>
          </div>
          <span style={{ height: '14px', width: '1px', background: '#cbd5e1' }} />
          <span style={{ fontSize: '13px', color: '#64748b' }}>Room: <strong style={{ color: '#0f172a' }}>#{roomId}</strong></span>
          <button
            onClick={copyRoomInvite}
            style={{
              background: '#f1f5f9',
              border: 'none',
              padding: '5px 9px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              fontWeight: 600,
              color: '#334155'
            }}
          >
            {copied ? <Check size={13} color="#16a34a" /> : <Copy size={13} color="#475569" />}
            {copied ? 'Copied' : 'Invite'}
          </button>
          <span style={{
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            color: status === 'connected' ? '#16a34a' : '#d97706',
            fontWeight: 600
          }}>
            {status === 'connected' ? <Wifi size={13} color="#16a34a" /> : <WifiOff size={13} color="#d97706" />}
            {status}
          </span>
          {isOfflineSynced && (
            <span style={{
              fontSize: '11px',
              background: '#e0f2fe',
              color: '#0284c7',
              padding: '3px 7px',
              borderRadius: '6px',
              fontWeight: 600
            }}>
              IndexedDB Cached
            </span>
          )}
        </div>

        <div style={{ pointerEvents: 'auto', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={() => setIsAiModalOpen(true)}
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
              color: '#ffffff',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              fontWeight: 600,
              boxShadow: '0 4px 14px rgba(99,102,241,0.3)'
            }}
          >
            <Sparkles size={15} />
            AI Diagram
          </button>

          <div style={{
            background: 'rgba(255, 255, 255, 0.88)',
            backdropFilter: 'blur(16px)',
            border: '1px solid #e2e8f0',
            padding: '6px 14px',
            borderRadius: '12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Users size={16} color="#64748b" />
            <div style={{ display: 'flex', marginLeft: '4px' }}>
              {collaborators.map((user, idx) => (
                <div
                  key={idx}
                  title={user.name}
                  style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: '50%',
                    backgroundColor: user.color,
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: idx === 0 ? '0' : '-8px',
                    border: '2px solid #fff'
                  }}
                >
                  {user.name.charAt(0)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Floating Center Control Dock */}
      <div style={{
        position: 'absolute',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(16px)',
        border: '1px solid #e2e8f0',
        padding: '8px 16px',
        borderRadius: '16px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        zIndex: 20
      }}>
        {/* Variety Tools */}
        <div style={{ display: 'flex', gap: '3px' }}>
          {[
            { id: 'pen', icon: <Pencil size={17} />, label: 'Fine Gel Pen' },
            { id: 'brush', icon: <Paintbrush size={17} />, label: 'Calligraphy Brush' },
            { id: 'highlighter', icon: <Highlighter size={17} />, label: 'Soft Highlighter' },
            { id: 'dashed', icon: <Minus size={17} style={{ strokeDasharray: '4,4' }} />, label: 'Dashed Flow Pen' },
            { id: 'line', icon: <Minus size={17} />, label: 'Line' },
            { id: 'rect', icon: <Square size={17} />, label: 'Rectangle' },
            { id: 'circle', icon: <Circle size={17} />, label: 'Circle' },
            { id: 'text', icon: <Type size={17} />, label: 'Text' },
            { id: 'sticky', icon: <StickyNote size={17} />, label: 'Sticky Note' },
            { id: 'eraser', icon: <Eraser size={17} />, label: 'Dynamic Eraser' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTool(item.id)}
              title={item.label}
              style={{
                background: tool === item.id ? '#0f172a' : 'transparent',
                color: tool === item.id ? '#ffffff' : '#475569',
                border: 'none',
                padding: '8px',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'all 0.15s ease'
              }}
            >
              {item.icon}
            </button>
          ))}
        </div>

        {/* Fill Mode Switcher for Shapes */}
        {(tool === 'rect' || tool === 'circle') && (
          <>
            <span style={{ height: '22px', width: '1px', background: '#e2e8f0' }} />
            <div style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
              {['none', 'translucent', 'solid'].map((m) => (
                <button
                  key={m}
                  onClick={() => setFillMode(m)}
                  style={{
                    background: fillMode === m ? '#e2e8f0' : 'transparent',
                    border: 'none',
                    padding: '5px 8px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    color: fillMode === m ? '#0f172a' : '#64748b'
                  }}
                >
                  {m === 'none' ? 'Outline' : (m === 'translucent' ? 'Soft Fill' : 'Solid')}
                </button>
              ))}
            </div>
          </>
        )}

        <span style={{ height: '22px', width: '1px', background: '#e2e8f0' }} />

        {/* Eraser Sizing OR Palette */}
        {tool === 'eraser' ? (
          <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600, marginRight: '4px' }}>Eraser:</span>
            {ERASER_SIZES.map((item) => (
              <button
                key={item.label}
                onClick={() => setEraserSize(item.size)}
                style={{
                  background: eraserSize === item.size ? '#0f172a' : '#f1f5f9',
                  color: eraserSize === item.size ? '#ffffff' : '#334155',
                  border: 'none',
                  padding: '4px 9px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '11px',
                  fontWeight: 700
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setStrokeColor(c)}
                style={{
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  backgroundColor: c,
                  border: strokeColor === c ? '2px solid #0f172a' : '2px solid transparent',
                  cursor: 'pointer',
                  padding: 0
                }}
              />
            ))}
            <input
              type="color"
              value={strokeColor}
              onChange={(e) => setStrokeColor(e.target.value)}
              title="Custom Hex Picker"
              style={{
                width: '20px',
                height: '20px',
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                padding: 0
              }}
            />
          </div>
        )}

        <span style={{ height: '22px', width: '1px', background: '#e2e8f0' }} />

        {/* Stroke Thickness */}
        {tool !== 'eraser' && (
          <>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              {PEN_WIDTHS.map((w) => (
                <button
                  key={w}
                  onClick={() => setLineWidth(w)}
                  style={{
                    background: lineWidth === w ? '#e2e8f0' : 'transparent',
                    border: 'none',
                    width: '24px',
                    height: '24px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <span style={{ width: `${w + 2}px`, height: `${w + 2}px`, borderRadius: '50%', background: '#334155' }} />
                </button>
              ))}
            </div>
            <span style={{ height: '22px', width: '1px', background: '#e2e8f0' }} />
          </>
        )}

        {/* Utility Actions */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={undo} title="Undo" style={actionBtnStyle}><Undo2 size={16} /></button>
          <button onClick={redo} title="Redo" style={actionBtnStyle}><Redo2 size={16} /></button>
          <button onClick={clearBoard} title="Clear Board" style={actionBtnStyle}><Trash2 size={16} color="#ef4444" /></button>
          <button onClick={exportCanvas} title="Export PNG" style={actionBtnStyle}><Download size={16} color="#0284c7" /></button>
        </div>
      </div>

      {/* AI Modal */}
      {isAiModalOpen && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: '#ffffff',
          padding: '24px',
          borderRadius: '16px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
          border: '1px solid #cbd5e1',
          zIndex: 50,
          width: '420px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={20} color="#6366f1" />
            <h3 style={{ margin: 0, fontSize: '17px', color: '#0f172a' }}>AI Canvas Assistant</h3>
          </div>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b', lineHeight: 1.4 }}>
            Describe any system or workflow (e.g. <em>"Pipeline"</em>, <em>"Database"</em>, or custom architecture):
          </p>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Type your prompt..."
            rows={3}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              fontFamily: 'inherit',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              onClick={() => setIsAiModalOpen(false)}
              style={{ background: '#f1f5f9', border: 'none', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 600 }}
            >
              Cancel
            </button>
            <button
              onClick={handleGenerateAiDiagram}
              disabled={isGeneratingAi}
              style={{
                background: '#6366f1',
                color: '#fff',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 600
              }}
            >
              {isGeneratingAi ? 'Synthesizing...' : 'Generate on Board'}
            </button>
          </div>
        </div>
      )}

      {/* Main Fullscreen Canvas */}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          backgroundImage: 'radial-gradient(#cbd5e1 1.2px, transparent 1.2px)',
          backgroundSize: '24px 24px',
          cursor: 'none'
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          setIsHovered(false);
          if (providerRef.current) {
            providerRef.current.awareness.setLocalStateField('cursor', null);
          }
        }}
      />

      {/* Elegant Spring Follower Cursor */}
      {isHovered && (
        <div style={{ pointerEvents: 'none', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 30 }}>
          {/* Inner Precision Dot */}
          <div
            style={{
              position: 'absolute',
              left: cursorPos.x,
              top: cursorPos.y,
              width: '4px',
              height: '4px',
              borderRadius: '50%',
              backgroundColor: tool === 'eraser' ? '#ef4444' : strokeColor,
              transform: 'translate(-50%, -50%)',
            }}
          />

          {/* Outer Smooth Spring Ring */}
          <div
            style={{
              position: 'absolute',
              left: followerPos.x,
              top: followerPos.y,
              width: isDrawing ? '22px' : (tool === 'eraser' ? `${eraserSize}px` : '30px'),
              height: isDrawing ? '22px' : (tool === 'eraser' ? `${eraserSize}px` : '30px'),
              borderRadius: '50%',
              border: `1.5px solid ${tool === 'eraser' ? 'rgba(239, 68, 68, 0.6)' : strokeColor + '66'}`,
              backgroundColor: isDrawing ? (tool === 'eraser' ? 'rgba(239,68,68,0.12)' : strokeColor + '18') : 'transparent',
              transform: 'translate(-50%, -50%)',
              transition: 'width 0.18s cubic-bezier(0.16, 1, 0.3, 1), height 0.18s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.15s ease',
            }}
          />
        </div>
      )}

      {/* Remote Multiplayer Cursors */}
      {Object.entries(remoteCursors).map(([id, cursor]) => (
        <div
          key={id}
          style={{
            position: 'absolute',
            left: cursor.x,
            top: cursor.y,
            pointerEvents: 'none',
            transform: 'translate(-2px, -2px)',
            transition: 'all 0.04s linear',
            zIndex: 12,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill={cursor.color}>
            <path d="M3 3l7 18 3-7 7-3L3 3z" />
          </svg>
          <span
            style={{
              backgroundColor: cursor.color,
              color: '#ffffff',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '6px',
              marginLeft: '4px',
              fontWeight: '600',
              boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
              whiteSpace: 'nowrap'
            }}
          >
            {cursor.name}
          </span>
        </div>
      ))}
    </div>
  );
}

const actionBtnStyle = {
  background: 'transparent',
  border: 'none',
  padding: '7px',
  borderRadius: '8px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  color: '#475569'
};