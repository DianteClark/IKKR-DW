import { resolveChoice } from './choices.js';
import { scoutLand } from './intel.js';
// Every player-made change to the campaign goes through here, so the host can replay a peer's actions.
import { wed, nameChild } from './family.js';
import { claimGoal, hideGoals } from '../campaign/goals.js';
import { ROLES, ROLE_LEVEL } from './rules.js';
import { setOrder, hireVagabond, equip, unequip, decideCaptive, changeUnit, hero, promoteElite } from './world.js';
import { setPolicy, issueEdict, promoteRealm, build, setLoadout } from './kingdom.js';
import { propose, respondProposal, breakTreaty, lendHero, recallHero, offerPeace } from './diplomacy.js';
import { developCost } from './rules.js';

export function applyAction(state, playerIdx, a) {
  const kid = state.players[playerIdx].kingdom;
  const k = state.kingdoms[kid];
  const own = (id) => { const x = hero(state, id); return x && x.kingdom === kid && x.status === 'active'; };
  switch (a.type) {
    case 'order': return own(a.hero) && setOrder(state, a.hero, a.order);
    case 'develop': {
      const t = state.territories[a.tid];
      if (t.owner !== kid || t.level >= 3 || k.gold < developCost(t)) return false;
      k.gold -= developCost(t); t.level++; t.ruined = 0; return true;
    }
    case 'hire': return hireVagabond(state, kid, a.hero);
    case 'equip': return own(a.hero) && (equip(state, kid, a.hero, a.item), true);
    case 'unequip': return own(a.hero) && (unequip(state, kid, a.hero, a.slot), true);
    case 'formation': { const x = hero(state, a.hero); if (own(a.hero)) x.formation = a.formation; return true; }
    case 'unit': return own(a.hero) && changeUnit(state, a.hero, a.ufid, a.unit);
    case 'nameChild': return nameChild(state, kid, a.bid, a.gender, a.name);
    case 'goal': return claimGoal(state, kid, a.id);
    case 'hideGoals': return hideGoals(state, kid, a.hidden !== false);
    case 'wed': return own(a.a) && own(a.b) && wed(state, hero(state, a.a), hero(state, a.b));
    case 'role': { const x = hero(state, a.hero); if (!own(a.hero) || x.role || x.level < ROLE_LEVEL || !ROLES[a.role]) return false; x.role = a.role; delete x.pendingRole; return true; }
    case 'promoteElite': return own(a.hero) && !!promoteElite(state, kid, a.hero, a.idx);
    case 'captive': { const x = hero(state, a.hero); if (x && x.captor === kid) return decideCaptive(state, a.hero, a.decision); return false; }
    case 'rename': { k.name = String(a.name).slice(0, 40); return true; }
    case 'policy': return setPolicy(state, kid, a.kind, a.value);
    case 'edict': return issueEdict(state, kid, a.edict);
    case 'promoteRealm': return promoteRealm(state, kid);
    case 'build': return build(state, kid, a.building);
    case 'loadout': return setLoadout(state, kid, a.ids);
    case 'propose': return propose(state, kid, a.to, a.kind);
    case 'choose': return resolveChoice(state, kid, a.opt | 0);
    case 'scout': return !!scoutLand(state, kid, a.tid);
    case 'peace': return offerPeace(state, kid, a.to, Math.max(0, a.gold | 0));
    case 'respond': { const p = state.proposals.find((x) => x.id === a.id); if (!p || p.to !== kid) return false; return respondProposal(state, a.id, a.accept); }
    case 'break': return breakTreaty(state, kid, a.other);
    case 'lend': return lendHero(state, kid, a.hero, a.ally, a.turns || 3);
    case 'recall': return recallHero(state, kid, a.hero);
  }
  return false;
}
