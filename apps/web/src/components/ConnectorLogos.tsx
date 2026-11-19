import hermesLogo from '../assets/hermes.png';
import openclawLogo from '../assets/openclaw.svg';

type LogoProps = { size?: number; className?: string };

const svg = (size: number | undefined, className: string | undefined, children: React.ReactNode) => (
  <svg
    className={className}
    width={size ?? 24}
    height={size ?? 24}
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

/* Anthropic "A" mark (Simple Icons, CC0) */
const ClaudeMark = ({ size, className }: LogoProps) =>
  svg(size, className, <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />);

/* OpenAI mark (Simple Icons, CC0) */
const OpenAIMark = ({ size, className }: LogoProps) =>
  svg(size, className, <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />);

/* Cursor mark (Simple Icons, CC0) */
const CursorMark = ({ size, className }: LogoProps) =>
  svg(size, className, <path d="M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23" />);

/* Cline mark (Simple Icons, CC0) */
const ClineMark = ({ size, className }: LogoProps) =>
  svg(size, className, <path d="m23.365 13.556-1.442-2.895V8.994c0-2.764-2.218-5.002-4.954-5.002h-2.464c.178-.367.276-.779.276-1.213A2.77 2.77 0 0 0 12.018 0a2.77 2.77 0 0 0-2.763 2.779c0 .434.098.846.276 1.213H7.067c-2.736 0-4.954 2.238-4.954 5.002v1.667L.64 13.549c-.149.29-.149.636 0 .927l1.472 2.855v1.667C2.113 21.762 4.33 24 7.067 24h9.902c2.736 0 4.954-2.238 4.954-5.002V17.33l1.44-2.865c.143-.286.143-.622.002-.91m-12.854 2.36a2.27 2.27 0 0 1-2.261 2.273 2.27 2.27 0 0 1-2.261-2.273v-4.042A2.27 2.27 0 0 1 8.249 9.6a2.267 2.267 0 0 1 2.262 2.274zm7.285 0a2.27 2.27 0 0 1-2.26 2.273 2.27 2.27 0 0 1-2.262-2.273v-4.042A2.267 2.267 0 0 1 15.535 9.6a2.27 2.27 0 0 1 2.261 2.274z" />);

/* Windsurf mark (Simple Icons, CC0) */
const WindsurfMark = ({ size, className }: LogoProps) =>
  svg(size, className, <path d="M23.55 5.067c-1.2038-.002-2.1806.973-2.1806 2.1765v4.8676c0 .972-.8035 1.7594-1.7597 1.7594-.568 0-1.1352-.286-1.4718-.7659l-4.9713-7.1003c-.4125-.5896-1.0837-.941-1.8103-.941-1.1334 0-2.1533.9635-2.1533 2.153v4.8957c0 .972-.7969 1.7594-1.7596 1.7594-.57 0-1.1363-.286-1.4728-.7658L.4076 5.1598C.2822 4.9798 0 5.0688 0 5.2882v4.2452c0 .2147.0656.4228.1884.599l5.4748 7.8183c.3234.462.8006.8052 1.3509.9298 1.3771.313 2.6446-.747 2.6446-2.0977v-4.893c0-.972.7875-1.7593 1.7596-1.7593h.003a1.798 1.798 0 0 1 1.4718.7658l4.9723 7.0994c.4135.5905 1.05.941 1.8093.941 1.1587 0 2.1515-.9645 2.1515-2.153v-4.8948c0-.972.7875-1.7594 1.7596-1.7594h.194a.22.22 0 0 0 .2204-.2202v-4.622a.22.22 0 0 0-.2203-.2203Z" />);

/* OpenCode mark — the glyph from the official favicon (sst/opencode), drawn on its
 *  own so it sits on the page without the favicon's black tile behind it. */
const OpenCodeMark = ({ size, className }: LogoProps) => (
  <svg
    className={className}
    width={size ?? 24}
    height={size ?? 24}
    viewBox="128 96 256 320"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M384 416H128V96H384V416ZM320 160H192V352H320V160Z" />
  </svg>
);

/* VS Code mark (Simple Icons, CC0) */
const VSCodeMark = ({ size, className }: LogoProps) =>
  svg(size, className, <path d="M23.15 2.587L18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />);

/* RooCode mark — official "roo" glyph from the Roo-Code repository */
const RooCodeMark = ({ size, className }: LogoProps) => (
  <svg
    className={className}
    width={size ?? 24}
    height={size ?? 24}
    viewBox="0 0 106 69"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M88.4719 2.87946L86.5306 9.89906C86.4278 10.2707 86.0399 10.4854 85.6704 10.3752L53.106 0.659112C52.8894 0.594492 52.6549 0.640312 52.4786 0.781722L20.2279 26.6445C20.1338 26.72 20.0214 26.7694 19.9021 26.7878L0.713159 29.745C0.357849 29.7998 0.10453 30.1187 0.13164 30.4772L0.21502 31.5798C0.24165 31.932 0.53052 32.2069 0.88359 32.216L23.1724 32.7922L23.4266 32.7993L39.8958 24.0019C40.1264 23.8788 40.4068 23.8968 40.6197 24.0486L52.2875 32.3659C52.4705 32.4963 52.5783 32.7078 52.5762 32.9325L52.4778 43.9686C52.4765 44.1114 52.5197 44.2511 52.6014 44.3683L69.0144 67.9188C69.1431 68.1034 69.354 68.2135 69.5791 68.2135H74.7748C75.2932 68.2135 75.6255 67.6623 75.3836 67.2039L63.6853 45.0427C63.5709 44.8259 63.5804 44.5647 63.7101 44.3568L69.8094 34.5861C69.8758 34.4797 69.97 34.3935 70.0819 34.3367L91.8879 23.2712C92.1095 23.1588 92.3744 23.1745 92.5812 23.3123L98.8125 27.4657C98.9256 27.5411 99.0584 27.5813 99.1943 27.5813H104.856C105.404 27.5813 105.732 26.9716 105.43 26.514L89.7099 2.6839C89.3844 2.19053 88.6294 2.30979 88.4719 2.87946Z" />
  </svg>
);

/* Hermes Agent — official product icon from Nous Research */
const HermesMark = ({ size, className }: LogoProps) => (
  <img className={className} src={hermesLogo} alt="" width={size ?? 24} height={size ?? 24} style={{ objectFit: 'contain' }} />
);

/* OpenClaw — official lobster mark from openclaw.ai */
const OpenClawMark = ({ size, className }: LogoProps) => (
  <img className={className} src={openclawLogo} alt="" width={size ?? 24} height={size ?? 24} style={{ objectFit: 'contain' }} />
);

export const BRAND_MARKS = {
  claude: ClaudeMark,
  openai: OpenAIMark,
  codex: OpenAIMark,
  cursor: CursorMark,
  cline: ClineMark,
  windsurf: WindsurfMark,
  opencode: OpenCodeMark,
  vscode: VSCodeMark,
  'roo-code': RooCodeMark,
  hermes: HermesMark,
  openclaw: OpenClawMark,
} satisfies Record<string, React.FC<LogoProps>>;

/** Brand colour used when the mark sits on a light background. */
export const BRAND_COLORS: Record<string, string> = {
  claude: '#d97757',
  openai: '#10a37f',
  codex: '#10a37f',
  cursor: '#111827',
  cline: '#4b5563',
  windsurf: '#0e9cb0',
  opencode: '#111827',
  vscode: '#0f76c4',
  'roo-code': '#8bc53f',
  hermes: '#f97316',
  openclaw: '#e11d48',
};

/** A connector's logo on its own — the mark sits directly on the background,
 *  with no tile, border or coloured box wrapped around it. */
export function BrandMark({ brand, size = 30, onDark = false }: { brand: string; size?: number; onDark?: boolean }) {
  const Mark = BRAND_MARKS[brand as keyof typeof BRAND_MARKS];
  if (!Mark) return null;
  return (
    <span className="mcp-logo" style={{ color: onDark ? '#fff' : BRAND_COLORS[brand], width: size, height: size }}>
      <Mark size={size} />
    </span>
  );
}
