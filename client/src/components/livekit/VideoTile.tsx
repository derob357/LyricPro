import { useEffect, useRef } from "react";
import {
  Track,
  type Participant,
} from "livekit-client";

interface VideoTileProps {
  participant: Participant;
}

/**
 * Renders a single participant's camera tile.
 *
 * - Attaches the camera <video> element to the participant's video track if
 *   one is published; falls back to a placeholder with their initials.
 * - Shows a "You" badge for the local participant.
 * - Speaking ring (lightweight border highlight) when isSpeaking.
 */
export function VideoTile({ participant }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const videoPub = Array.from(participant.videoTrackPublications.values()).find(
      (p) => p.source === Track.Source.Camera,
    );
    const track = videoPub?.track;
    const el = videoRef.current;
    if (track && el) {
      track.attach(el);
      return () => {
        track.detach(el);
      };
    }
  }, [participant]);

  const displayName = participant.name || participant.identity;
  const hasVideo = Array.from(participant.videoTrackPublications.values()).some(
    (p) => p.track && !p.isMuted && p.source === Track.Source.Camera,
  );

  return (
    <div
      data-testid="video-tile"
      className={`relative aspect-video rounded-lg overflow-hidden bg-slate-800 border-2 ${
        participant.isSpeaking ? "border-emerald-400" : "border-transparent"
      }`}
    >
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={participant.isLocal}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-slate-400 text-2xl font-bold">
          {displayName.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="absolute bottom-1 left-1 px-2 py-0.5 text-xs bg-black/60 rounded text-white">
        {displayName}
        {participant.isLocal && (
          <span className="ml-1 text-emerald-400">(You)</span>
        )}
      </div>
    </div>
  );
}
