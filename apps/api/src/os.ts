// Operating systems offered on the Reinstall page. `image` is the provider image name, which for
// Hetzner is the name of a system image; run `pnpm hetzner:check` to confirm each one exists.
export interface OsImage { image: string; name: string; ver: string; logo: string }

const L = (slug: string) => `https://upload.wikimedia.org/wikipedia/commons/thumb/${slug}`;

export const OS_CATALOG: OsImage[] = [
  { image: 'ubuntu-24.04', name: 'Ubuntu', ver: '24.04 LTS', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Logo-ubuntu_cof-orange-hex.svg/120px-Logo-ubuntu_cof-orange-hex.svg.png' },
  { image: 'ubuntu-22.04', name: 'Ubuntu', ver: '22.04 LTS', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Logo-ubuntu_cof-orange-hex.svg/120px-Logo-ubuntu_cof-orange-hex.svg.png' },
  { image: 'debian-12', name: 'Debian', ver: '12 Bookworm', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Debian-OpenLogo.svg/120px-Debian-OpenLogo.svg.png' },
  { image: 'alma-9', name: 'AlmaLinux', ver: '9', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/AlmaLinux_Logo.svg/120px-AlmaLinux_Logo.svg.png' },
  { image: 'rocky-9', name: 'Rocky Linux', ver: '9', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Rocky_Linux_logo.svg/120px-Rocky_Linux_logo.svg.png' },
  { image: 'fedora-41', name: 'Fedora', ver: '41', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3f/Fedora_logo.svg/120px-Fedora_logo.svg.png' },
  { image: 'centos-stream-9', name: 'CentOS Stream', ver: '9', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/91/CentOS_logo.svg/120px-CentOS_logo.svg.png' },
  { image: 'opensuse-leap-15.6', name: 'openSUSE Leap', ver: '15.6', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/22/OpenSUSE_Logo.svg/120px-OpenSUSE_Logo.svg.png' },
  { image: 'redhat-9', name: 'Red Hat Enterprise Linux', ver: '9', logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Red_Hat_logo.svg/120px-Red_Hat_logo.svg.png' },
];

export const findOs = (image: string) => OS_CATALOG.find((o) => o.image === image);
