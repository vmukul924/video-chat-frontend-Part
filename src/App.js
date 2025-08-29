import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

// Backend URL (Render)
const SOCKET_URL = "https://video-chat-back-m6lk.onrender.com"; // Replace with your Render backend URL

const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"],
  withCredentials: true,
});

export default function App() {
  const [status, setStatus] = useState("Not connected");
  const [roomId, setRoomId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const messagesRef = useRef(null);

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = e => {
      if (e.candidate) socket.emit("signal", { candidate: e.candidate, roomId });
    };

    pc.ontrack = e => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0];
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));
    }

    return pc;
  };

  useEffect(() => {
    socket.on("connect", () => setStatus("Connected to server"));
    socket.on("disconnect", () => setStatus("Disconnected"));

    socket.on("partner_found", async ({ roomId: rid, initiator }) => {
      setRoomId(rid);
      setStatus("Partner found 🎉");
      setMessages([]);
      peerRef.current = createPeerConnection();

      if (initiator) {
        const offer = await peerRef.current.createOffer();
        await peerRef.current.setLocalDescription(offer);
        socket.emit("signal", { sdp: offer, roomId: rid });
      }
    });

    socket.on("signal", async ({ sdp, candidate }) => {
      if (sdp) {
        if (!peerRef.current) peerRef.current = createPeerConnection();
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
        if (sdp.type === "offer") {
          const answer = await peerRef.current.createAnswer();
          await peerRef.current.setLocalDescription(answer);
          socket.emit("signal", { sdp: answer, roomId });
        }
      } else if (candidate) {
        try {
          await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {}
      }
    });

    socket.on("receive_message", m => setMessages(p => [...p, m]));
    socket.on("partner_left", () => {
      setStatus("Partner left 😢");
      cleanup();
      setTimeout(findPartner, 1500);
    });

    return () => {
      socket.off("connect");
      socket.off("disconnect");
      socket.off("partner_found");
      socket.off("signal");
      socket.off("receive_message");
      socket.off("partner_left");
    };
  }, []);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [messages]);

  const findPartner = async () => {
    setStatus("Searching for partner…");
    setMessages([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      socket.emit("find_partner");
    } catch {
      setStatus("Media access denied.");
    }
  };

  const sendMessage = () => {
    if (!text.trim() || !roomId) return;
    socket.emit("send_message", { text: text.trim(), roomId });
    setMessages(p => [...p, { from: socket.id, text: text.trim(), createdAt: new Date().toISOString() }]);
    setText("");
  };

  const endChat = () => {
    socket.emit("leave_room", { roomId });
    setStatus("Chat ended ❌");
    cleanup();
  };

  const cleanup = () => {
    setRoomId(null);
    if (peerRef.current) { peerRef.current.close(); peerRef.current = null; }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (localStreamRef.current) { localStreamRef.current.getTracks().forEach(t => t.stop()); localStreamRef.current = null; }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Video Chat Clone</h1>
        <div className="status">{status}</div>
      </header>

      <main className="main">
        <section className="video-panel">
          <div className="video-wrap">
            <div className="video-label">You</div>
            <video ref={localVideoRef} autoPlay playsInline muted className="video-el" />
          </div>
          <div className="video-wrap">
            <div className="video-label">Partner</div>
            <video ref={remoteVideoRef} autoPlay playsInline className="video-el" />
          </div>
        </section>

        <section className="controls">
          {!roomId ? (
            <button className="btn primary" onClick={findPartner}>
              🔍 Find Partner
            </button>
          ) : (
            <div className="controls-row">
              <div className="room-id">Room: <span>{roomId}</span></div>
              <button className="btn danger" onClick={endChat}>❌ End Chat</button>
            </div>
          )}
        </section>

        <section className="chat-panel">
          <div className="messages" ref={messagesRef}>
            {messages.length === 0 ? (
              <div className="empty">No messages yet — say hi 👋</div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`msg ${m.from === socket.id ? "msg-sent" : "msg-recv"}`}>
                  <div className="msg-text">{m.text}</div>
                  <div className="msg-time">{new Date(m.createdAt).toLocaleTimeString()}</div>
                </div>
              ))
            )}
          </div>
          <div className="chat-input">
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendMessage()}
              placeholder={roomId ? "Type a message..." : "Find partner first"}
              disabled={!roomId}
            />
            <button className="btn" onClick={sendMessage} disabled={!roomId || !text.trim()}>
              Send
            </button>
          </div>
        </section>
      </main>

      <footer className="footer">
        <small>Built with WebRTC & Socket.IO</small>
      </footer>
    </div>
  );
}
