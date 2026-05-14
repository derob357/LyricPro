// server/ip-utils.test.ts
import { describe, it, expect } from "vitest";
import { truncateIp } from "./_core/ip-utils";

describe("truncateIp", () => {
  it("truncates IPv4 to /24", () => {
    expect(truncateIp("192.168.1.42")).toBe("192.168.1.0/24");
  });
  it("truncates IPv6 to /48", () => {
    expect(truncateIp("2001:db8:abcd:1234::1")).toBe("2001:db8:abcd::/48");
  });
  it("returns null for undefined", () => {
    expect(truncateIp(undefined)).toBeNull();
  });
  it("returns null for malformed", () => {
    expect(truncateIp("not-an-ip")).toBeNull();
  });
  it("handles IPv4 with leading zeros", () => {
    expect(truncateIp("010.000.001.042")).toBe("10.0.1.0/24");
  });
});
