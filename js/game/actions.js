// Every player-made change to the campaign goes through here, so the host can replay a peer's actions.
import { setOrder, develop, hireVagabond, equip, unequip, decideCaptive, changeUnit, hero } from './world.js';

export function applyAction(state, playerIdx, a) {
  const kid = state.players[playerIdx].kingdom;
  const own = (id) => { const x = hero(state, id); return x && x.kingdom === kid && x.status === 'active'; };
  switch (a.type) {
    case 'order': return own(a.hero) && setOrder(state, a.hero, a.order);
    case 'develop': return develop(state, kid, a.tid);
    case 'hire': return hireVagabond(state, kid, a.hero);
    case 'equip': return own(a.hero) && (equip(state, kid, a.hero, a.item), true);
    case 'unequip': return own(a.hero) && (unequip(state, kid, a.hero, a.slot), true);
    case 'formation': { const x = hero(state, a.hero); if (own(a.hero)) x.formation = a.formation; return true; }
    case 'unit': return own(a.hero) && (changeUnit(state, a.hero, a.unit), true);
    case 'captive': { const x = hero(state, a.hero); if (x && x.captor === kid) return decideCaptive(state, a.hero, a.decision); return false; }
    case 'rename': { state.kingdoms[kid].name = String(a.name).slice(0, 40); return true; }
  }
  return false;
}
