import React, { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";
import "./App.css";

const SOCKET_URL =
  process.env.NODE_ENV === "production"
    ? "https://video-chat-back-m6lk.onrender.com"
    : "http://localhost:4000";

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
  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("signal", { candidate: e.candidate, roomId });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("Connection state:", pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE state:", pc.iceConnectionState);
    };

    // --- Remote track ---
    pc.ontrack = (e) => {
      console.log("Remote track received:", e.streams);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
        remoteVideoRef.current.muted = false;
        console.log("✅ Remote stream attached to video element");
      }
    };

    // --- Add local tracks if already acquired ---
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => {
        pc.addTrack(t, localStreamRef.current);
      });
    }

    return pc;
  }, [roomId]);

  // --- Socket handlers ---
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
      if (!peerRef.current) peerRef.current = createPeerConnection();

      if (sdp) {
        if (sdp.type === "offer") {
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
          console.error("ICE add error:", e);
        }
      }
    });

    socket.on("receive_message", (m) => setMessages((p) => [...p, m]));

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
  }, [createPeerConnection, roomId]);

  // Autoscroll chat
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
      console.error("Media access denied:", e);
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
      peerRef.current.close();
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
        <h1>Video Chat Clone — Video + Chat</h1>
        <div className="status">{status}</div>
      </header>

      <main className="main">
        {/* Video Panel */}
        <section className="video-panel" style={{ display: "flex", gap: "10px" }}>
          <div className="video-wrap" style={{ flex: 1 }}>
            <div className="video-label">You</div>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="video-el local"
              style={{ width: "100%", borderRadius: "10px", background: "#000" }}
            />
          </div>
          <div className="video-wrap" style={{ flex: 1 }}>
            <div className="video-label">Partner</div>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              muted={false}
              className="video-el remote"
              style={{ width: "100%", borderRadius: "10px", background: "#000" }}
              onLoadedMetadata={() => {
                try {
                  remoteVideoRef.current?.play();
                  console.log("▶️ Remote video playback started");
                } catch (err) {
                  console.warn("⚠️ Remote video autoplay blocked:", err);
                }
              }}
            />
          </div>
        </section>

        {/* Controls */}
        <section className="controls">
          {!roomId ? (
            <button className="btn primary" onClick={findPartner}>
              🔍 Find Partner
            </button>
          ) : (
            <div className="controls-row">
              <div className="room-id">
                Room: <span>{roomId}</span>
              </div>
              <button className="btn danger" onClick={endChat}>
                ❌ End Chat
              </button>
            </div>
          )}
        </section>

        {/* Chat */}
        <section className="chat-panel">
          <div className="messages" ref={messagesRef}>
            {messages.length === 0 ? (
              <div className="empty">No messages yet — say hi 👋</div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  className={`msg ${m.from === socket.id ? "msg-sent" : "msg-recv"}`}
                >
                  <div className="msg-text">{m.text}</div>
                  <div className="msg-time">{new Date(m.createdAt).toLocaleTimeString()}</div>
                </div>
              ))
            )}
          </div>
          <div className="chat-input">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
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
