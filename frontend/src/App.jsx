import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:5000");

function App() {
  const [username, setUsername] = useState("");
  const [roomId, setRoomId] = useState("");
  const [joined, setJoined] = useState(false);
  const [participants, setParticipants] = useState({});
  const [myRole, setMyRole] = useState(null);
  const [mySocketId, setMySocketId] = useState(null);
  const [videoId, setVideoId] = useState(null);

  const playerRef = useRef(null);
  const mySocketIdRef = useRef(null);

  const canControl = myRole === "Host" || myRole === "Moderator";

  // Track socket id
  useEffect(() => {
    socket.on("connect", () => {
      setMySocketId(socket.id);
      mySocketIdRef.current = socket.id;
    });
  }, []);

  // Load YouTube API once
  useEffect(() => {
    if (window.YT) return;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.body.appendChild(tag);

    window.onYouTubeIframeAPIReady = () => {
      if (videoId) initPlayer(videoId);
    };
  }, []);

  const initPlayer = (vid) => {
    if (!playerRef.current && window.YT) {
      playerRef.current = new window.YT.Player("player", {
        height: "390",
        width: "640",
        videoId: vid,
      });
    }
  };

  // Socket listeners
 // After socket connection
useEffect(() => {
  socket.on("connect", () => {
    setMySocketId(socket.id);
    mySocketIdRef.current = socket.id;
  });
}, []);

// Socket listeners
useEffect(() => {
  const updateParticipants = (data) => {
    setParticipants(data.participants);
    const me = data.participants[mySocketIdRef.current || socket.id];
    if (me) setMyRole(me.role);
  };

  socket.on("user_joined", updateParticipants);
  socket.on("role_updated", updateParticipants);
  socket.on("user_left", updateParticipants);
  socket.on("removed", () => {
    alert("You were removed by the Host");
    setJoined(false);
    setParticipants({});
    setMyRole(null);
    setVideoId(null);
    if (playerRef.current) playerRef.current.destroy();
    playerRef.current = null;
  });

  socket.on("sync_state", ({ videoId, currentTime, playState }) => {
    setVideoId(videoId);

    const loadVideo = () => {
      if (!playerRef.current && window.YT) {
        playerRef.current = new window.YT.Player("player", {
          height: "390",
          width: "640",
          videoId,
          events: {
            onReady: (event) => {
              event.target.seekTo(currentTime, true);
              playState === "playing"
                ? event.target.playVideo()
                : event.target.pauseVideo();
            },
          },
        });
      } else if (playerRef.current) {
        const currentVid = playerRef.current.getVideoData().video_id;
        if (currentVid !== videoId) {
          playerRef.current.loadVideoById(videoId);
        }
        playerRef.current.seekTo(currentTime, true);
        playState === "playing"
          ? playerRef.current.playVideo()
          : playerRef.current.pauseVideo();
      }
    };

    if (window.YT) loadVideo();
    else {
      window.onYouTubeIframeAPIReady = loadVideo;
    }
  });

  socket.on("play", () => playerRef.current?.playVideo());
  socket.on("pause", () => playerRef.current?.pauseVideo());
   socket.on("seek", ({ time }) => {
    if (playerRef.current) playerRef.current.seekTo(time, true);
  });

  socket.on("change_video", ({ videoId, currentTime }) => {
    setVideoId(videoId);
    if (playerRef.current) {
      playerRef.current.loadVideoById(videoId, currentTime || 0);
    }
  });


  return () => socket.removeAllListeners();
}, []);

  // Join room
  const joinRoom = () => {
  if (!roomId || !username) return;

  // Emit join
  socket.emit("join_room", { roomId, username });
  setJoined(true);

  // Listen for participants after joining
  socket.once("user_joined", (data) => {
    setParticipants(data.participants);
    const me = data.participants[socket.id];
    if (me) setMyRole(me.role); // set role immediately
  });

  // Listen for sync_state for video
  socket.once("sync_state", ({ videoId, currentTime, playState }) => {
    setVideoId(videoId);

    if (!playerRef.current && window.YT) {
      playerRef.current = new window.YT.Player("player", {
        height: "390",
        width: "640",
        videoId,
        events: {
          onReady: (event) => {
            event.target.seekTo(currentTime, true);
            playState === "playing" ? event.target.playVideo() : event.target.pauseVideo();
          },
        },
      });
    }
  });
};

  // Controls
  const handlePlay = () => {
    if (!canControl) return;
    const currentTime = playerRef.current?.getCurrentTime();
    socket.emit("play", { roomId, currentTime });
    playerRef.current?.playVideo();
  };

  const handlePause = () => {
    if (!canControl) return;
    const currentTime = playerRef.current?.getCurrentTime();
    socket.emit("pause", { roomId, currentTime });
    playerRef.current?.pauseVideo();
  };

  const handleSeek = () => {
  if (!canControl) return;
  const time = playerRef.current?.getCurrentTime();
  socket.emit("seek", { roomId, time });
};

const handleChangeVideo = (vid) => {
  if (!canControl) return;
  setVideoId(vid);
  socket.emit("change_video", { roomId, videoId: vid });
};

  const assignRole = (userId, role) => socket.emit("assign_role", { roomId, userId, role });
  const removeUser = (userId) => socket.emit("remove_participant", { roomId, userId });

  if (!joined) {
    return (
      <div className="p-6 max-w-md mx-auto">
        <h2 className="text-2xl font-bold mb-4">Create / Join Watch Party</h2>
        <input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="border rounded px-3 py-2 mb-4 w-full"
        />
        <input
          placeholder="Room ID"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          className="border rounded px-3 py-2 mb-4 w-full"
        />
        <button
          onClick={joinRoom}
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
        >
          Enter Room
        </button>
      </div>
    );
  }

  return (
    <div className="flex p-6 max-w-6xl mx-auto gap-6">
      {/* Left side - video + controls */}
      <div className="flex-1">
        <h2 className="text-xl font-semibold mb-2">Room: {roomId}</h2>
        <h3 className="text-lg mb-4">Your Role: {myRole || "Loading..."}</h3>

        <div id="player" className="mb-4">
          {!videoId && <p>Loading video...</p>}
        </div>

        <div className="mb-6 space-x-2">
          <button
            onClick={handlePlay}
            className={`px-3 py-1 rounded ${canControl ? "bg-green-500 hover:bg-green-600 text-white" : "bg-gray-300 text-gray-600 cursor-not-allowed"}`}
            disabled={!canControl}
          >
            Play
          </button>
          <button
            onClick={handlePause}
            className={`px-3 py-1 rounded ${canControl ? "bg-red-500 hover:bg-red-600 text-white" : "bg-gray-300 text-gray-600 cursor-not-allowed"}`}
            disabled={!canControl}
          >
            Pause
          </button>
          <button
            onClick={handleSeek}
            className={`px-3 py-1 rounded ${canControl ? "bg-yellow-500 hover:bg-yellow-600 text-white" : "bg-gray-300 text-gray-600 cursor-not-allowed"}`}
            disabled={!canControl}
          >
            Sync Seek
          </button>

          <input
            placeholder="New YouTube Video ID"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleChangeVideo(e.target.value);
            }}
            className="border rounded px-2 py-1 ml-2"
          />
        </div>
      </div>

      {/* Right side - participants */}
      <div className="w-1/3 border p-3 rounded h-fit">
        <h3 className="text-lg font-semibold mb-2">Participants</h3>
        <ul className="space-y-2">
          {Object.entries(participants).map(([id, user]) => (
            <li
              key={id}
              className="border p-2 rounded flex items-center justify-between"
            >
              <span>
                {user.username} — {user.role}
              </span>

              {myRole === "Host" && id !== mySocketId && (
                <div className="flex items-center space-x-2">
                  <select
                    defaultValue={user.role}
                    onChange={(e) => assignRole(id, e.target.value)}
                    className="border rounded px-2 py-1"
                  >
                    <option value="Participant">Participant</option>
                    <option value="Moderator">Moderator</option>
                  </select>

                  <button
                    onClick={() => removeUser(id)}
                    className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600"
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;