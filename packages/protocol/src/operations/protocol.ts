import type { ProtocolOperations } from "./index.js";
import type { ProtocolCompatibility, CoreCapability } from "../types/transport.js";

export type ProtocolSessionOperations = {
  "protocol.keepAlive": { payload: Record<string, never>; result: Record<string, never> };
  "protocol.maintenance": ProtocolOperations["protocol.handshake"];
  "protocol.handshake": {
    /** `sessionMessageLimit` (0..100) bounds messages in every AiSession returned on this connection (capability `session.responseLimit`); omitted messages are counted in `omittedMessages`. */ payload: {
      compatibility: ProtocolCompatibility;
      clientVersion?: string;
      token?: string;
      /** Claims a one-use transfer ticket and switches this socket to JSON transfer frames. */
      remoteTransferToken?: string;
      sessionMessageLimit?: number;
    };
    result: {
      maintenance?: boolean;
      compatible: boolean;
      compatibility: ProtocolCompatibility;
      message?: string;
      capabilities?: CoreCapability[];
    };
  };
};
