import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";

// ✅ Backend URL (Render deployment)
const SOCKET_URL = "https://video-chat-back-m6lk.onrender.com";

// ✅ Socket config with CORS + transports
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

  // --- Peer helper ---
  const createPeerConnection = () => {
    console.log("⚡ Creating new RTCPeerConnection...");
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log("📡 Sending ICE candidate:", e.candidate);
        socket.emit("signal", { candidate: e.candidate, roomId });
      }
    };

    // ✅ Remote video fix
    pc.ontrack = (e) => {
      console.log("🎬 Remote track received:", e.streams);
      if (remoteVideoRef.current) {
        if (e.streams && e.streams[0]) {
          remoteVideoRef.current.srcObject = e.streams[0];
        } else {
          const inboundStream = new MediaStream();
          inboundStream.addTrack(e.track);
          remoteVideoRef.current.srcObject = inboundStream;
        }
      }
    };

    if (localStreamRef.current) {
      console.log("🎥 Adding local tracks to PeerConnection...");
      localStreamRef.current.getTracks().forEach((t) => {
        pc.addTrack(t, localStreamRef.current);
      });
    }

    return pc;
  };

  // --- Socket handlers ---
  useEffect(() => {
    socket.on("connect", () => {
      console.log("✅ Socket connected:", socket.id);
      setStatus("Connected to server");
    });

    socket.on("disconnect", () => {
      console.log("❌ Socket disconnected");
      setStatus("Disconnected");
    });

    socket.on("partner_found", async ({ roomId: rid, initiator }) => {
      console.log("🎉 Partner found, room:", rid, "initiator:", initiator);
      setRoomId(rid);
      setStatus("Partner found 🎉");
      setMessages([]);

      peerRef.current = createPeerConnection();

      if (initiator) {
        console.log("📡 Creating Offer...");
        const offer = await peerRef.current.createOffer();
        await peerRef.current.setLocalDescription(offer);
        socket.emit("signal", { sdp: offer, roomId: rid });
      }
    });

    socket.on("signal", async ({ sdp, candidate }) => {
      if (sdp) {
        console.log("📩 Received SDP:", sdp.type);
        if (sdp.type === "offer") {
          if (!peerRef.current) peerRef.current = createPeerConnection();
          await peerRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
          const answer = await peerRef.current.createAnswer();
          await peerRef.current.setLocalDescription(answer);
          socket.emit("signal", { sdp: answer, roomId });
        } else if (sdp.type === "answer") {
          await peerRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
        }
      } else if (candidate) {
        try {
          await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
          console.error("ICE add error", e);
        }
      }
    });

    socket.on("receive_message", (m) => {
      setMessages((p) => [...p, m]);
    });

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

  // --- Auto scroll chat ---
  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, [messages]);

  // --- Actions ---
  const findPartner = async () => {
    setStatus("Searching for partner…");
    setMessages([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      socket.emit("find_partner");
    } catch (e) {
      setStatus("Media access denied.");
    }
  };

  const sendMessage = () => {
    if (!text.trim() || !roomId) return;
    const payload = { text: text.trim(), roomId };
    socket.emit("send_message", payload);
    setMessages((p) => [
      ...p,
      { from: socket.id, text: text.trim(), createdAt: new Date().toISOString() },
    ]);
    setText("");
  };

  const endChat = () => {
    socket.emit("leave_room", { roomId });
    setStatus("Chat ended ❌");
    cleanup();
  };

  const cleanup = () => {
    setRoomId(null);
    if (peerRef.current) {
      try { peerRef.current.close(); } catch {}
      peerRef.current = null;
    }
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Video chat Clone — Video + Chat</h1>
        <div className="status">{status}</div>
      </header>

      <main className="main">
        <section className="video-panel" style={{ display: "flex", gap: "10px" }}>
          <div className="video-wrap" style={{ flex: 1 }}>
            <div className="video-label">You</div>
            <video ref={localVideoRef} className="video-el local" autoPlay playsInline muted style={{ width: "100%", borderRadius: "10px" }} />
          </div>
          <div className="video-wrap" style={{ flex: 1 }}>
            <div className="video-label">Partner</div>
            <video ref={remoteVideoRef} className="video-el remote" autoPlay playsInline style={{ width: "100%", borderRadius: "10px" }} />
          </div>
        </section>

        <section className="controls">
          {!roomId ? (
            <button className="btn primary" onClick={findPartner}>🔍 Find Partner</button>
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
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder={roomId ? "Type a message..." : "Find partner first"} disabled={!roomId} />
            <button className="btn" onClick={sendMessage} disabled={!roomId || !text.trim()}>Send</button>
          </div>
        </section>
      </main>

      <footer className="footer">
        <small>Built with WebRTC & Socket.IO</small>
      </footer>
    </div>
  );
}
