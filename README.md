# IKKR Dynasty Wars

A mobile-first browser strategy game: conquer a world of rival kingdoms with heroes who lead squads that evolve as they survive battles.

**Play:** https://dianteclark.github.io/IKKR-DW/

- Turn-based campaign map across every HAS biome, with many kingdoms (several of the same race competing).
- Real-time battles seen from above: squads march in formation between posts; capture the main post to take the territory.
- Units rank up and evolve to their upgraded form; fallen soldiers are replaced with fresh recruits.
- Capture enemy heroes: execute, release (they become vagabonds or start uprisings), or recruit.
- Two-player peer-to-peer campaigns with room codes (PeerJS).

Built for phones in landscape. Plain JavaScript + canvas, no build step: open `index.html` through any static server.

## How to play
- **Campaign:** tap your town, then give each hero an order: Attack a neighbour, Move, Rest (heal + morale), Drill (morale + troop XP) or Recruit (refill the squad with fresh stage-1 soldiers). Develop towns for more income. Hire wandering heroes found in your lands. End the turn when ready.
- **Battles:** tap a squad, then tap a post to march there or an enemy squad to attack it. Change formation from the bar at the bottom. ★ appears on a hero when their special is charged. Attackers win by taking the main post; defenders win by routing the attackers or holding out until the timer ends.
- **Formations:** Wedge beats Line, Line beats Square, Square beats Wedge. Loose is fast and takes less damage from arrows.
- **Prisoners:** recruit, release (they wander, may join others or start an uprising) or execute.
- **Multiplayer:** one player taps Multiplayer → Host and shares the 5-letter code; the other enters it and taps Join. Both pick a people and 2–3 heroes. Each player taps End Turn; the host's device runs the AI and the battles. Needs an internet connection (PeerJS broker).

## Project layout
- `js/game/` campaign rules, world generation, AI, items, save
- `js/battle/` battlefield generation and the real-time simulation
- `js/scenes/` title, setup, campaign, battle, multiplayer lobby
- `js/net/net.js` PeerJS link (host-authoritative)
- `tools/` scripts that read the sprite sheets and generate `js/data/*.js`

## Run locally
```
python3 -m http.server 8000
```
then open http://localhost:8000

## Credits
Art: **Aleksandr Makarov (IKnowKingRabbit)** — HAS asset packs. https://www.patreon.com/iknowkingrabbit
