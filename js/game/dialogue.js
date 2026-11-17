// Short lines for captures, defeats and the fate of prisoners, flavoured by each hero's trait.
const L = {
  defeat: {
    proud: ['This is not over!', 'You got lucky.', 'Remember my name...'],
    loyal: ['Forgive me, my lord...', 'I held as long as I could.'],
    cunning: ['A tactical retreat, nothing more.', 'Clever. Very clever.'],
    honorable: ['Well fought. I yield.', 'An honest defeat.'],
    greedy: ['Wait! I can pay!', 'My gold... my beautiful gold...'],
    fierce: ['Gah! Cut me loose and fight me again!', 'I am not finished!'],
    calm: ['So be it.', 'The wind has turned.'],
    ambitious: ['My time will come.', 'This changes nothing.'],
  },
  capture: [
    'Bind them. They are worth more alive.', 'Take this one to the dungeons.', 'Your lord cannot save you now.', 'A fine prize for our cause.', 'Lay down your blade.',
  ],
  captiveReply: {
    proud: ['Do your worst.', 'I will not beg.'], loyal: ['My lord will come for me.', 'I serve only one banner.'],
    cunning: ['Perhaps we can come to an arrangement.', 'Let us talk, you and I.'], honorable: ['I accept my fate.', 'Treat my soldiers well.'],
    greedy: ['Everyone has a price. Even me.', 'What do you offer?'], fierce: ['Untie me and see what happens.', 'Coward.'],
    calm: ['...', 'I am listening.'], ambitious: ['You could use someone like me.', 'Your realm needs talent. I have it.'],
  },
  recruitYes: {
    proud: ['Fine. But I lead from the front.'], loyal: ['My old lord is gone. I will serve you as faithfully.'], cunning: ['A wise offer. I accept.'],
    honorable: ['You have shown mercy. My sword is yours.'], greedy: ['For good pay? Gladly.'], fierce: ['Point me at the enemy.'],
    calm: ['Very well.'], ambitious: ['Together we will go far.'],
  },
  recruitNo: {
    proud: ['Never. Not to you.'], loyal: ['I would rather die.'], cunning: ['Not today. Ask me again.'], honorable: ['My oath forbids it.'],
    greedy: ['Not for that pittance.'], fierce: ['I spit on your banner!'], calm: ['No.'], ambitious: ['I serve no one forever.'],
  },
  release: {
    proud: ['You will regret this mercy.'], loyal: ['I will remember this kindness.'], cunning: ['Interesting choice...'], honorable: ['I owe you a debt.'],
    greedy: ['Free! Now where is my purse?'], fierce: ['Next time I will not lose.'], calm: ['Farewell.'], ambitious: ['The world is wide. I will find my place.'],
  },
  execute: {
    proud: ['History will remember me, not you!'], loyal: ['Long live my lord!'], cunning: ['You are making a mistake...'], honorable: ['I die with honor.'],
    greedy: ['Wait, wait! I have gold hidden in—'], fierce: ['Make it quick!'], calm: ['...'], ambitious: ['So close...'],
  },
  ruler: {
    recruit: ['Join us, and your skill will be rewarded.', 'Serve me, and you will want for nothing.', 'Kneel, and rise as one of us.'],
    release: ['Go. Tell your lord of our mercy.', 'You are free. Do not cross us again.'],
    execute: ['Your war ends here.', 'Let this be a warning to all.', 'Justice is served.'],
  },
  treachery: ['My true lord calls! Turn on them!', 'I have waited for this moment.', 'Your reign is over!'],
  victory: ['The day is ours!', 'For the realm!', 'They break! After them!'],
  heroDown: ['Fall back... fall back...', 'I am hit!', 'Avenge me!'],
};

const pick = (arr, seed) => arr[Math.abs(Math.floor(seed)) % arr.length];

export function line(kind, hero, seed = 0) {
  const pool = L[kind];
  if (!pool) return '';
  if (Array.isArray(pool)) return pick(pool, seed);
  return pick(pool[hero && hero.trait] || Object.values(pool)[0], seed + (hero ? hero.id : 0));
}
export function rulerLine(kind, seed = 0) { return pick(L.ruler[kind] || [''], seed); }

// a short scripted exchange for the capture screen
export function captureScene(captor, captive, seed = 0) {
  return [
    { hero: captive, text: line('defeat', captive, seed) },
    { hero: captor, text: line('capture', null, seed + 3) },
    { hero: captive, text: line('captiveReply', captive, seed + 5) },
  ];
}
export function decisionScene(ruler, captive, decision, outcome, seed = 0) {
  const out = [{ hero: ruler, text: rulerLine(decision === 'recruit' ? 'recruit' : decision, seed) }];
  if (decision === 'recruit') out.push({ hero: captive, text: line(outcome === 'joined' ? 'recruitYes' : 'recruitNo', captive, seed) });
  else out.push({ hero: captive, text: line(decision, captive, seed) });
  return out;
}

// nemeses trade words when they meet again
const NEMESIS = {
  challenger: ['We meet again, {foe}. This time you fall.', '{foe}! I have waited seasons for this.', 'You took everything from me, {foe}. Today I take it back.', 'Remember me, {foe}? I remember you.'],
  victor: ['Back for another beating, {foe}?', 'I spared you once, {foe}. Not twice.', '{foe}... still breathing? Let us fix that.', 'Run home, {foe}. It worked last time.'],
};
export function nemesisLine(hero, foe, role = 'challenger', seed = 0) {
  return pick(NEMESIS[role], seed + (hero ? hero.id : 0)).replace('{foe}', foe ? foe.name.split(' ')[0] : 'you');
}
