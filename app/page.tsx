export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "3rem 1.25rem" }}>
      <p style={{ color: "#7dd3fc", letterSpacing: "0.08em", fontSize: 12 }}>
        ARC MICROGRANT · x402 · CIRCLE FACILITATOR SERVICE
      </p>
      <h1 style={{ fontSize: "1.75rem", lineHeight: 1.25 }}>
        arc-x402-door
      </h1>
      <p style={{ color: "#b6c2de", lineHeight: 1.6 }}>
        Unpaid requests to <code>/api/paid</code> return{" "}
        <strong>HTTP 402</strong> with x402 payment requirements for USDC on Arc
        Mainnet. After Circle Facilitator Service settles an EIP-3009
        authorization, the door returns JSON evidence that{" "}
        <em>settlement ≠ purpose / agent-authority verification</em>.
      </p>
      <pre
        style={{
          background: "#111827",
          padding: "1rem",
          borderRadius: 8,
          overflow: "auto",
          fontSize: 13,
        }}
      >
        {`curl -i http://localhost:3000/api/paid`}
      </pre>
      <p style={{ color: "#94a3b8", fontSize: 14 }}>
        See README.md and EVIDENCE.md. Out of scope: Mandato AR, Base Sepolia,
        wallet funding, X publish, live spend.
      </p>
    </main>
  );
}
