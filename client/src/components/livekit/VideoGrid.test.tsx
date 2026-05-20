import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VideoGrid } from "./VideoGrid";

function makeParticipant(name: string) {
  return {
    identity: `user_${name}`,
    name,
    isLocal: false,
    videoTrackPublications: new Map(),
    audioTrackPublications: new Map(),
    isSpeaking: false,
  } as any;
}

describe("VideoGrid", () => {
  it("renders one tile per participant", () => {
    render(
      <VideoGrid
        participants={[
          makeParticipant("Alice"),
          makeParticipant("Bob"),
          makeParticipant("Carol"),
        ]}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Carol")).toBeInTheDocument();
  });

  it("renders an empty state when no participants", () => {
    render(<VideoGrid participants={[]} />);
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });
});
