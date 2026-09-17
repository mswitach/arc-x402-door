import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "arc-x402-door — settle ≠ purpose",
  description:
    "HTTP paid door on Arc Mainnet via Circle Facilitator Service. Settlement is not purpose or agent-authority verification.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          margin: 0,
          background: "#0b1220",
          color: "#e8eefc",
        }}
      >
        {children}
      </body>
    </html>
  );
}
