type LogoProps = { size?: number };

const Wrap = ({ bg, children }: { bg: string; children: React.ReactNode }) => (
  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="44" height="44" rx="10" fill={bg} />
    {children}
  </svg>
);

// Claude Code — Anthropic orange-brown with asterisk mark
const ClaudeLogo = (_p: LogoProps) => (
  <Wrap bg="#D97757">
    <g stroke="white" strokeWidth="2.8" strokeLinecap="round">
      <line x1="22" y1="9" x2="22" y2="35" />
      <line x1="9.5" y1="16" x2="34.5" y2="28" />
      <line x1="9.5" y1="28" x2="34.5" y2="16" />
    </g>
  </Wrap>
);

// Docker — blue whale with container stacks
const DockerLogo = (_p: LogoProps) => (
  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="44" height="44" rx="10" fill="#2496ED" />
    {/* container boxes */}
    <rect x="9" y="13" width="6" height="5" rx="1" fill="white" />
    <rect x="17" y="13" width="6" height="5" rx="1" fill="white" />
    <rect x="25" y="13" width="6" height="5" rx="1" fill="white" />
    <rect x="17" y="20" width="6" height="5" rx="1" fill="white" />
    <rect x="25" y="20" width="6" height="5" rx="1" fill="white" />
    {/* wave / water line */}
    <path d="M6 29 Q10 27 14 29 Q18 31 22 29 Q26 27 30 29 Q34 31 38 29" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" />
    {/* whale body */}
    <path d="M7 32 C8 28 13 27 18 28 L33 28 C37 28 38 31 37 33 C36 35 34 35 31 35 L14 35 C10 35 7 34 7 32Z" fill="white" />
    {/* tail */}
    <path d="M34 29 C37 27 41 25 40 22 C39 20 37 22 36 24 C35 26 34 28 34 29Z" fill="white" />
    {/* eye */}
    <circle cx="13" cy="31" r="1.4" fill="#2496ED" />
  </svg>
);

// Node.js — green hexagon with N
const NodeLogo = (_p: LogoProps) => (
  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="44" height="44" rx="10" fill="#339933" />
    <polygon points="22,6 36,14 36,30 22,38 8,30 8,14" fill="#66BB66" />
    <polygon points="22,6 36,14 36,30 22,38 8,30 8,14" fill="none" stroke="#1E7A1E" strokeWidth="1.5" />
    <text x="22" y="29" textAnchor="middle" fill="white" fontSize="20" fontWeight="700" fontFamily="'Inter',system-ui,sans-serif">N</text>
  </svg>
);

// n8n — dark background with brand orange
const N8nLogo = (_p: LogoProps) => (
  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="44" height="44" rx="10" fill="#1C1C2E" />
    <rect x="6" y="14" width="32" height="16" rx="4" fill="#EA4B71" opacity="0.15" />
    <text x="22" y="26.5" textAnchor="middle" fill="#EA4B71" fontSize="13" fontWeight="800" fontFamily="'JetBrains Mono',ui-monospace,monospace" letterSpacing="0.5">n8n</text>
    {/* two connecting dots like n8n logo */}
    <circle cx="12" cy="32" r="2.5" fill="#EA4B71" />
    <circle cx="32" cy="12" r="2.5" fill="#EA4B71" />
    <line x1="12" y1="32" x2="32" y2="12" stroke="#EA4B71" strokeWidth="1.2" opacity="0.4" />
  </svg>
);

// Ollama — dark with llama silhouette
const OllamaLogo = (_p: LogoProps) => (
  <svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="44" height="44" rx="10" fill="#111111" />
    {/* llama head */}
    <ellipse cx="22" cy="16" rx="7" ry="8" fill="white" />
    {/* ears */}
    <ellipse cx="16" cy="9" rx="2.2" ry="4" transform="rotate(-12 16 9)" fill="white" />
    <ellipse cx="28" cy="9" rx="2.2" ry="4" transform="rotate(12 28 9)" fill="white" />
    {/* neck & body */}
    <rect x="17" y="22" width="10" height="11" rx="5" fill="white" />
    {/* eyes */}
    <circle cx="19.5" cy="15" r="1.4" fill="#111111" />
    <circle cx="24.5" cy="15" r="1.4" fill="#111111" />
    {/* nose */}
    <path d="M20 20 Q22 21.5 24 20" stroke="#111111" strokeWidth="1.1" strokeLinecap="round" fill="none" />
  </svg>
);

// Hermes Agent — indigo/purple with wing motif
const HermesLogo = (_p: LogoProps) => (
  <Wrap bg="#6D28D9">
    {/* left wing */}
    <path d="M8 22 Q5 16 9 13 Q14 11 16 18 L12 20Z" fill="white" opacity="0.9" />
    {/* right wing */}
    <path d="M36 22 Q39 16 35 13 Q30 11 28 18 L32 20Z" fill="white" opacity="0.9" />
    {/* H letter */}
    <text x="22" y="30" textAnchor="middle" fill="white" fontSize="20" fontWeight="800" fontFamily="'Inter',system-ui,sans-serif">H</text>
  </Wrap>
);

// OpenClaw — teal with paw print
const OpenClawLogo = (_p: LogoProps) => (
  <Wrap bg="#0D9488">
    {/* main pad */}
    <ellipse cx="22" cy="30" rx="6" ry="5" fill="white" />
    {/* toe pads */}
    <ellipse cx="14.5" cy="25" rx="2.8" ry="2.3" fill="white" />
    <ellipse cx="22" cy="22" rx="2.8" ry="2.3" fill="white" />
    <ellipse cx="29.5" cy="25" rx="2.8" ry="2.3" fill="white" />
    {/* claws */}
    <path d="M12.5 22.5 Q10 18 11 14" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    <path d="M22 19.5 Q22 15 22 12" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    <path d="M31.5 22.5 Q34 18 33 14" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" />
  </Wrap>
);

const logoMap: Record<string, React.FC> = {
  claude: ClaudeLogo,
  docker: DockerLogo,
  node: NodeLogo,
  n8n: N8nLogo,
  ollama: OllamaLogo,
  hermes: HermesLogo,
  openclaw: OpenClawLogo,
};

export function AppLogo({ id, name }: { id: string; name: string }) {
  const Logo = logoMap[id];
  if (Logo) return <Logo />;
  // fallback: first letter
  return <span style={{ fontWeight: 800, color: 'var(--red)', fontSize: 18 }}>{name.charAt(0)}</span>;
}
