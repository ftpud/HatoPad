

export type ConnectionStatus = "idle" | "connecting" | "connected" | "failed" | "disconnected" | "workspace-error";

export function ConnectionScreen(props: { host: string; port: string; status: ConnectionStatus; statusMessage: string; setHost(value: string): void; setPort(value: string): void; connect(): Promise<void> }) {
  const connecting = props.status === "connecting";
  return <main className="connection-screen"><form className="connection-form" onSubmit={(event) => { event.preventDefault(); void props.connect(); }}>
    <h1>HatoPad</h1><p>Connect to a core backend</p>
    <label>Host<input autoFocus value={props.host} onChange={(event) => props.setHost(event.target.value)} placeholder="192.168.1.50" required /></label>
    <label>Port<input value={props.port} onChange={(event) => props.setPort(event.target.value)} type="number" min="1" max="65535" required /></label>
    {props.statusMessage && <div role="status" aria-live="polite" className={`connection-message ${props.status}`}>{props.statusMessage}</div>}
    <button className="primary" disabled={connecting}>{connecting ? "Connecting..." : "Connect"}</button>
  </form></main>;
}
