export const SECTIONS = ['education', 'experience', 'certificates'];

// Retain a saved order while safely incorporating newly added or removed entries.
export function orderedKeys(order, available) {
  const allowed = new Set(available);
  return [...new Set([...(Array.isArray(order) ? order : []), ...available])].filter(key => allowed.has(key));
}

export function migrateState(state) {
  let changed = false;
  if ((state.contentVersion || 1) < 2) {
    let general = state.categories.find(c => c.name === 'General');
    if (!general) {
      let id = 'general';
      while (state.categories.some(c => c.id === id)) id += '-new';
      general = { id, name: 'General' };
      state.categories.unshift(general);
    }
    for (const data of Object.values(state.languages)) {
      for (const e of data.experiences) {
        for (const b of e.bullets) if (!b.categories.length) b.categories.push(general.id);
      }
    }
    state.contentVersion = 2;
    changed = true;
  }
  return changed;
}
