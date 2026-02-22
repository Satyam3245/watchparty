const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const cors = require("cors");
const pool = require("./db/db")
const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
  },
});


io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join_room", async ({ roomId, username }) => {
    if (!roomId || !username) return;

    try {
      const roomCheck = await pool.query(
        "SELECT * FROM rooms WHERE id = $1",
        [roomId]
      );
      let isFirstUser = false;
      if (roomCheck.rows.length === 0) {
        await pool.query(
          "INSERT INTO rooms (id) VALUES ($1)",
          [roomId]
        );
        isFirstUser = true;
      }

      const role = isFirstUser ? "Host" : "Participant";

      await pool.query(
        "INSERT INTO participants (socket_id, room_id, username, role) VALUES ($1, $2, $3, $4)",
        [socket.id, roomId, username, role]
      );
      socket.join(roomId);
      socket.roomId = roomId;

      const participantsResult = await pool.query(
        "SELECT socket_id, username, role FROM participants WHERE room_id = $1",
        [roomId]
      );

      const participants = {};
      participantsResult.rows.forEach((p) => {
        participants[p.socket_id] = {
          username: p.username,
          role: p.role,
        };
      });

      io.to(roomId).emit("user_joined", { participants });

      const roomState = await pool.query(
        "SELECT video_id, current_time, is_playing FROM rooms WHERE id = $1",
        [roomId]
      );

      const room = roomState.rows[0];

      socket.emit("sync_state", {
        videoId: room.video_id,
        currentTime: room.current_time,
        playState: room.is_playing ? "playing" : "paused",
      });
    } catch (err) {
      console.error("Join Room Error:", err);
    }
  });

  socket.on("play", async ({ roomId }) => {
    try {
      const user = await pool.query(
        "SELECT role FROM participants WHERE socket_id = $1",
        [socket.id]
      );

      if (!user.rows.length) return;

      const role = user.rows[0].role;
      if (role !== "Host" && role !== "Moderator") return;

      await pool.query(
        "UPDATE rooms SET is_playing = true WHERE id = $1",
        [roomId]
      );

      io.to(roomId).emit("play");
    } catch (err) {
      console.error("Play Error:", err);
    }
  });

  socket.on("pause", async ({ roomId }) => {
    try {
      const user = await pool.query(
        "SELECT role FROM participants WHERE socket_id = $1",
        [socket.id]
      );

      if (!user.rows.length) return;

      const role = user.rows[0].role;
      if (role !== "Host" && role !== "Moderator") return;

      await pool.query(
        "UPDATE rooms SET is_playing = false WHERE id = $1",
        [roomId]
      );

      io.to(roomId).emit("pause");
    } catch (err) {
      console.error("Pause Error:", err);
    }
  });

  socket.on("seek", async ({ roomId, time }) => {
    try {
      const user = await pool.query(
        "SELECT role FROM participants WHERE socket_id = $1",
        [socket.id]
      );

      if (!user.rows.length) return;

      const role = user.rows[0].role;
      if (role !== "Host" && role !== "Moderator") return;

      await pool.query(
        "UPDATE rooms SET current_time = $1 WHERE id = $2",
        [time, roomId]
      );

      io.to(roomId).emit("seek", { time });
    } catch (err) {
      console.error("Seek Error:", err);
    }
  });

  socket.on("change_video", async ({ roomId, videoId }) => {
    try {
      const user = await pool.query(
        "SELECT role FROM participants WHERE socket_id = $1",
        [socket.id]
      );

      if (!user.rows.length) return;

      const role = user.rows[0].role;
      if (role !== "Host" && role !== "Moderator") return;

      await pool.query(
        "UPDATE rooms SET video_id = $1, current_time = 0, is_playing = false WHERE id = $2",
        [videoId, roomId]
      );

      io.to(roomId).emit("change_video", { videoId , currentTime:0});
    } catch (err) {
      console.error("Change Video Error:", err);
    }
  });

  socket.on("assign_role", async ({ roomId, userId, role }) => {
    try {
      const requester = await pool.query(
        "SELECT role FROM participants WHERE socket_id = $1",
        [socket.id]
      );

      if (!requester.rows.length) return;
      if (requester.rows[0].role !== "Host") return;

      await pool.query(
        "UPDATE participants SET role = $1 WHERE socket_id = $2",
        [role, userId]
      );

      const participantsResult = await pool.query(
        "SELECT socket_id, username, role FROM participants WHERE room_id = $1",
        [roomId]
      );

      const participants = {};
      participantsResult.rows.forEach((p) => {
        participants[p.socket_id] = {
          username: p.username,
          role: p.role,
        };
      });

      io.to(roomId).emit("role_updated", { participants });
    } catch (err) {
      console.error("Assign Role Error:", err);
    }
  });

  socket.on("remove_participant", async ({ roomId, userId }) => {
    try {
      const requester = await pool.query(
        "SELECT role FROM participants WHERE socket_id = $1",
        [socket.id]
      );

      if (!requester.rows.length) return;
      if (requester.rows[0].role !== "Host") return;

      await pool.query(
        "DELETE FROM participants WHERE socket_id = $1",
        [userId]
      );

      io.to(userId).emit("removed");

      const participantsResult = await pool.query(
        "SELECT socket_id, username, role FROM participants WHERE room_id = $1",
        [roomId]
      );

      const participants = {};
      participantsResult.rows.forEach((p) => {
        participants[p.socket_id] = {
          username: p.username,
          role: p.role,
        };
      });

      io.to(roomId).emit("user_left", { participants });
    } catch (err) {
      console.error("Remove Error:", err);
    }
  });

  socket.on("disconnect", async () => {
    try {
      const participant = await pool.query(
        "SELECT room_id, role FROM participants WHERE socket_id = $1",
        [socket.id]
      );

      if (!participant.rows.length) return;

      const roomId = participant.rows[0].room_id;

      await pool.query(
        "DELETE FROM participants WHERE socket_id = $1",
        [socket.id]
      );

      const remaining = await pool.query(
        "SELECT socket_id, role FROM participants WHERE room_id = $1",
        [roomId]
      );

      if (!remaining.rows.length) {
        await pool.query(
          "DELETE FROM rooms WHERE id = $1",
          [roomId]
        );
        return;
      }

      const hasHost = remaining.rows.some(
        (p) => p.role === "Host"
      );

      if (!hasHost) {
        const newHost = remaining.rows[0].socket_id;
        await pool.query(
          "UPDATE participants SET role = 'Host' WHERE socket_id = $1",
          [newHost]
        );
      }

      const participants = {};
      remaining.rows.forEach((p) => {
        participants[p.socket_id] = { role: p.role };
      });

      io.to(roomId).emit("user_left", { participants });
    } catch (err) {
      console.error("Disconnect Error:", err);
    }
  });
});

server.listen(5000, () => {
  console.log("Server running on port 5000");
});