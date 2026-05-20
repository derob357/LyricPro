/**
 * React hook that manages a LiveKit Room connection lifecycle.
 *
 * Usage:
 *   const { room, participants, status, error } = useLiveKitRoom({
 *     livekitUrl: "wss://...",
 *     token: "eyJ...",
 *     autoConnect: true,
 *   });
 *
 * Status transitions: idle -> connecting -> connected -> (reconnecting|disconnected)
 *
 * The hook does NOT auto-publish tracks — callers explicitly call
 * room.localParticipant.setMicrophoneEnabled(true) / setCameraEnabled(true)
 * when ready. This matches the PermissionGate flow (Task 6).
 */
import { useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  type RemoteParticipant,
  type LocalParticipant,
  ConnectionState,
} from "livekit-client";

export type RoomStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface UseLiveKitRoomOptions {
  livekitUrl: string;
  token: string;
  autoConnect?: boolean;
}

export interface UseLiveKitRoomResult {
  room: Room | null;
  participants: (RemoteParticipant | LocalParticipant)[];
  status: RoomStatus;
  error: Error | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

export function useLiveKitRoom(
  opts: UseLiveKitRoomOptions,
): UseLiveKitRoomResult {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState<RoomStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [participants, setParticipants] = useState<
    (RemoteParticipant | LocalParticipant)[]
  >([]);

  const refreshParticipants = (room: Room) => {
    setParticipants([
      room.localParticipant,
      ...Array.from(room.remoteParticipants.values()),
    ]);
  };

  const connect = async () => {
    if (roomRef.current) return;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    room
      .on(RoomEvent.ParticipantConnected, () => refreshParticipants(room))
      .on(RoomEvent.ParticipantDisconnected, () => refreshParticipants(room))
      .on(RoomEvent.TrackSubscribed, () => refreshParticipants(room))
      .on(RoomEvent.TrackUnsubscribed, () => refreshParticipants(room))
      .on(RoomEvent.LocalTrackPublished, () => refreshParticipants(room))
      .on(RoomEvent.LocalTrackUnpublished, () => refreshParticipants(room))
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Connected) setStatus("connected");
        else if (state === ConnectionState.Connecting) setStatus("connecting");
        else if (state === ConnectionState.Reconnecting)
          setStatus("reconnecting");
        else if (state === ConnectionState.Disconnected)
          setStatus("disconnected");
      })
      .on(RoomEvent.Disconnected, () => {
        refreshParticipants(room);
      });

    try {
      setStatus("connecting");
      await room.connect(opts.livekitUrl, opts.token);
      refreshParticipants(room);
    } catch (err) {
      setError(err as Error);
      setStatus("error");
      roomRef.current = null;
    }
  };

  const disconnect = async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
      setParticipants([]);
      setStatus("disconnected");
    }
  };

  useEffect(() => {
    if (opts.autoConnect) {
      void connect();
    }
    return () => {
      void disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.livekitUrl, opts.token]);

  return {
    room: roomRef.current,
    participants,
    status,
    error,
    connect,
    disconnect,
  };
}
