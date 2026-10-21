// Operating systems offered on the Reinstall page. `image` is the provider image name, which for
// Hetzner is the name of a system image; run `pnpm hetzner:check` to confirm each one exists.
export interface OsImage { image: string; name: string; ver: string }

export const OS_CATALOG: OsImage[] = [
  { image: 'ubuntu-24.04', name: 'Ubuntu', ver: '24.04 LTS' },
  { image: 'ubuntu-22.04', name: 'Ubuntu', ver: '22.04 LTS' },
  { image: 'debian-12', name: 'Debian', ver: '12 Bookworm' },
  { image: 'alma-9', name: 'AlmaLinux', ver: '9' },
  { image: 'rocky-9', name: 'Rocky Linux', ver: '9' },
  { image: 'fedora-41', name: 'Fedora', ver: '41' },
];

export const findOs = (image: string) => OS_CATALOG.find((o) => o.image === image);
