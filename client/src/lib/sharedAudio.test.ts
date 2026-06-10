import { describe, it, expect, vi, beforeEach } from "vitest";

const resume = vi.fn().mockResolvedValue(undefined);
class FakeAudioContext {
  state = "suspended";
  resume = resume;
}
vi.stubGlobal("AudioContext", FakeAudioContext);

import { getSharedAudioContext, unlockAudioOnGesture } from "./sharedAudio";

describe("sharedAudio singleton", () => {
  beforeEach(() => resume.mockClear());

  it("returns the same context across calls", () => {
    expect(getSharedAudioContext()).toBe(getSharedAudioContext());
    expect(getSharedAudioContext()).not.toBeNull();
  });

  it("unlockAudioOnGesture resumes a suspended context", () => {
    unlockAudioOnGesture();
    expect(resume).toHaveBeenCalled();
  });
});
