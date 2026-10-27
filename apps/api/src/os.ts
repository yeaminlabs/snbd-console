// Operating systems offered on the Reinstall page.
//  - `image`        provider image name; also the value stored in servers.os
//  - `logo`         direct .png logo URL (loaded from the internet)
//  - `fallbackLogo` bundled .png copy served by this panel, used if the remote logo fails
//  - `reinstallArgs` arguments passed to bin456789/reinstall on agent-connected servers
//  - `note`         optional honest caveat shown under the name
export interface OsImage {
  image: string;
  name: string;
  ver: string;
  brand: string;
  logo: string;
  fallbackLogo: string;
  reinstallArgs: string;
  note?: string;
}

const ICONS = 'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png';

export const OS_CATALOG: OsImage[] = [
  {
    image: 'ubuntu-24.04',
    name: 'Ubuntu',
    ver: '24.04 LTS',
    brand: 'Canonical',
    logo: `${ICONS}/ubuntu-linux.png`,
    fallbackLogo: '/os/ubuntu.png',
    reinstallArgs: 'ubuntu 24.04',
  },
  {
    image: 'ubuntu-22.04',
    name: 'Ubuntu',
    ver: '22.04 LTS',
    brand: 'Canonical',
    logo: `${ICONS}/ubuntu-linux.png`,
    fallbackLogo: '/os/ubuntu.png',
    reinstallArgs: 'ubuntu 22.04',
  },
  {
    image: 'debian-12',
    name: 'Debian',
    ver: '12 Bookworm',
    brand: 'Debian Project',
    logo: `${ICONS}/debian-linux.png`,
    fallbackLogo: '/os/debian.png',
    reinstallArgs: 'debian 12',
  },
  {
    image: 'debian-11',
    name: 'Debian',
    ver: '11 Bullseye',
    brand: 'Debian Project',
    logo: `${ICONS}/debian-linux.png`,
    fallbackLogo: '/os/debian.png',
    reinstallArgs: 'debian 11',
  },
  {
    image: 'redhat-9',
    name: 'Red Hat Enterprise Linux',
    ver: '9',
    brand: 'Red Hat',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d8/Red_Hat_logo.svg/120px-Red_Hat_logo.svg.png',
    fallbackLogo: '/os/redhat.png',
    reinstallArgs: 'rocky 9',
    note: 'RHEL needs a Red Hat subscription image, so Rocky Linux 9 (RHEL-compatible) is installed instead.',
  },
  {
    image: 'alma-9',
    name: 'AlmaLinux',
    ver: '9',
    brand: 'AlmaLinux OS',
    logo: `${ICONS}/alma-linux.png`,
    fallbackLogo: '/os/almalinux.png',
    reinstallArgs: 'almalinux 9',
  },
  {
    image: 'rocky-9',
    name: 'Rocky Linux',
    ver: '9',
    brand: 'Rocky Enterprise Software Foundation',
    logo: `${ICONS}/rocky-linux.png`,
    fallbackLogo: '/os/rocky.png',
    reinstallArgs: 'rocky 9',
  },
  {
    image: 'centos-stream-9',
    name: 'CentOS Stream',
    ver: '9',
    brand: 'CentOS Project',
    logo: `${ICONS}/centos.png`,
    fallbackLogo: '/os/centos.png',
    reinstallArgs: 'centos 9',
  },
  {
    image: 'fedora-43',
    name: 'Fedora',
    ver: '43',
    brand: 'Fedora Project',
    logo: `${ICONS}/fedora.png`,
    fallbackLogo: '/os/fedora.png',
    reinstallArgs: 'fedora 43',
  },
  {
    image: 'opensuse-leap-16.0',
    name: 'openSUSE Leap',
    ver: '16.0',
    brand: 'SUSE',
    logo: `${ICONS}/opensuse.png`,
    fallbackLogo: '/os/opensuse.png',
    reinstallArgs: 'opensuse 16.0',
  },
  {
    image: 'alpine-3.21',
    name: 'Alpine Linux',
    ver: '3.21',
    brand: 'Alpine Linux',
    logo: `${ICONS}/alpine-linux.png`,
    fallbackLogo: '/os/alpine.png',
    reinstallArgs: 'alpine 3.21',
  },
  {
    image: 'arch',
    name: 'Arch Linux',
    ver: 'Rolling',
    brand: 'Arch Linux',
    logo: `${ICONS}/arch-linux.png`,
    fallbackLogo: '/os/arch.png',
    reinstallArgs: 'arch',
  },
  {
    image: 'kali',
    name: 'Kali Linux',
    ver: 'Rolling',
    brand: 'OffSec',
    logo: `${ICONS}/kali-linux.png`,
    fallbackLogo: '/os/kali.png',
    reinstallArgs: 'kali rolling',
  },
];

export const findOs = (image: string) => OS_CATALOG.find((o) => o.image === image);
