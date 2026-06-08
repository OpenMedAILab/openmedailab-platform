export function latestRelease(release) {
  return release?.latest || null;
}

export function releaseHistory(release) {
  return Array.isArray(release?.history) ? release.history : [];
}

export function sectionEntries(sections = {}) {
  return Object.entries(sections).filter(([, items]) => Array.isArray(items) && items.length > 0);
}
