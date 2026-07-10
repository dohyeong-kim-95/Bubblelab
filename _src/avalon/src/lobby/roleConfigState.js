import { TEAM_COMPOSITION } from '../config/gameConfig.js';

const EVIL_SPECIAL_ROLES = ['morgana', 'mordred', 'oberon'];

export function normalizeRoleConfig(playerCount, roleConfig = {}) {
  const evilSlots = TEAM_COMPOSITION[playerCount]?.evil || 2;
  const maxSelectedEvilSpecials = Math.max(0, evilSlots - 1);

  const normalized = {
    merlin: true,
    percival: !!roleConfig.percival,
    morgana: !!roleConfig.morgana,
    mordred: !!roleConfig.mordred,
    oberon: !!roleConfig.oberon,
  };

  const selectedEvilSpecials = EVIL_SPECIAL_ROLES.filter((role) => normalized[role]);
  const allowedSelections = new Set(selectedEvilSpecials.slice(0, maxSelectedEvilSpecials));

  for (const role of EVIL_SPECIAL_ROLES) {
    normalized[role] = allowedSelections.has(role);
  }

  return normalized;
}

export function getMaxSelectedEvilSpecials(playerCount) {
  const evilSlots = TEAM_COMPOSITION[playerCount]?.evil || 2;
  return Math.max(0, evilSlots - 1);
}

export function getSelectedEvilSpecialCount(roleConfig = {}) {
  return EVIL_SPECIAL_ROLES.filter((role) => !!roleConfig[role]).length;
}
