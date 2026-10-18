# @remote-ide/relay

Versioned connector-facing relay envelope, pairing shapes, strict frame
validation, a shared channel table, and an in-memory `TestRelay` fixture
(`@remote-ide/relay/testing`) so connector tests need no private hub.

The relay wire version (`RELAY_WIRE_RANGE`) is independent of the Core protocol
version. `channel.data` carries one unmodified Core protocol message. The
fixture is a contract test aid, not a production hub.
