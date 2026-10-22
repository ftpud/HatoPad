import { describe, expect, it } from "vitest";
import { parseHttpRequests } from "./editor-helpers";

describe("parseHttpRequests bodies", () => {
  it("keeps whitespace in a request body, consuming only the header separator", () => {
    const [request] = parseHttpRequests("POST http://x/echo\nContent-Type: text/plain\n\n\n  payload  \n");
    expect(request?.body).toBe("\n  payload  \n");
  });

  it("does not include blank lines that only space requests apart", () => {
    const requests = parseHttpRequests(
      'POST http://x/a\nContent-Type: application/json\n\n{"a":1}\n\n### next\nGET http://x/b\n',
    );
    expect(requests[0]?.body).toBe('{"a":1}');
    expect(requests[1]).toMatchObject({ method: "GET", url: "http://x/b" });
    expect(requests[1]?.body).toBeUndefined();
  });
});
