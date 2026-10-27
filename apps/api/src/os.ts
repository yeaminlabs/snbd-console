// Operating systems offered on the Reinstall page. `image` is the provider image name, which for
// Hetzner is the name of a system image; run `pnpm hetzner:check` to confirm each one exists.
export interface OsImage { image: string; name: string; ver: string; logo: string }

export const OS_CATALOG: OsImage[] = [
  { image: 'ubuntu-24.04', name: 'Ubuntu', ver: '24.04 LTS', logo: 'https://cdn.simpleicons.org/ubuntu' },
  { image: 'ubuntu-22.04', name: 'Ubuntu', ver: '22.04 LTS', logo: 'https://cdn.simpleicons.org/ubuntu' },
  { image: 'debian-12', name: 'Debian', ver: '12 Bookworm', logo: 'https://cdn.simpleicons.org/debian' },
  { image: 'alma-9', name: 'AlmaLinux', ver: '9', logo: 'https://cdn.simpleicons.org/almalinux' },
  { image: 'rocky-9', name: 'Rocky Linux', ver: '9', logo: 'https://cdn.simpleicons.org/rockylinux' },
  { image: 'fedora-41', name: 'Fedora', ver: '41', logo: 'https://cdn.simpleicons.org/fedora' },
  { image: 'centos-stream-9', name: 'CentOS Stream', ver: '9', logo: 'https://cdn.simpleicons.org/centos' },
  { image: 'opensuse-leap-15.6', name: 'openSUSE Leap', ver: '15.6', logo: 'https://cdn.simpleicons.org/opensuse' },
  { image: 'redhat-9', name: 'Red Hat Enterprise Linux', ver: '9', logo: 'https://cdn.simpleicons.org/redhat' },
];

export const findOs = (image: string) => OS_CATALOG.find((o) => o.image === image);
