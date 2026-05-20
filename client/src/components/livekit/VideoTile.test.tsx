import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VideoTile } from "./VideoTile";

function makeParticipant(overrides: Record<string, unknown> = {}) {
  return {
    identity: "user_42",
    name: "Alice",
    isLocal: false,
    videoTrackPublications: new Map(),
    audioTrackPublications: new Map(),
    isSpeaking: false,
    ...overrides,
  } as any;
}

describe("VideoTile", () => {
  it("renders the participant name", () => {
    render(<VideoTile participant={makeParticipant({ name: "Alice" })} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows a 'You' badge for the local participant", () => {
    render(<VideoTile participant={makeParticipant({ isLocal: true })} />);
    expect(screen.getByText(/you/i)).toBeInTheDocument();
  });

  it("falls back to identity when name is missing", () => {
    render(
      <VideoTile participant={makeParticipant({ name: undefined, identity: "user_7" })} />,
    );
    expect(screen.getByText("user_7")).toBeInTheDocument();
  });
});
